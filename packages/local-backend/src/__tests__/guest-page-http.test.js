/*
 * HTTP-level integration test for /guest/:token — boots the actual backend, creates
 * a fixture share via the store, fetches the rendered page, asserts no loopback URLs
 * leak through. Cleans up the spawned server + temp data dir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { LocalBackendStore } from '../store.js';

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

test('GET /guest/:token serves polished HTML with no loopback URLs', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'db-guest-e2e-'));

  // Seed a share directly via the store so we don't need an auth round-trip.
  const seed = new LocalBackendStore({ dataDir, emit: () => {} });
  await seed.init();
  const share = await seed.createGuestShare({
    ttlMs: 5 * 60 * 1000,
    maxUses: 2,
    sharerName: 'Test Device',
  });
  // Inject a fake file record directly into the persisted state so we don't have to
  // upload bytes through the HTTP layer. The page renderer never opens the file —
  // it only embeds the metadata.
  share.files.push({
    id: 'file-1',
    name: 'big-movie.mkv',
    size: 600 * 1024 * 1024,
    mimeType: 'video/x-matroska',
    storagePath: 'guest/file-1.bin',
    addedAt: new Date().toISOString(),
  });
  share.files.push({
    id: 'file-2',
    name: 'photo.jpg',
    size: 3 * 1024 * 1024,
    mimeType: 'image/jpeg',
    storagePath: 'guest/file-2.bin',
    addedAt: new Date().toISOString(),
  });
  await seed.persist();

  const port = await freePort();
  const host = '127.0.0.1';
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      DROPBEAM_DATA_DIR: dataDir,
      DROPBEAM_BACKEND_HOST: host,
      DROPBEAM_BACKEND_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let ready = false;
  child.stdout.on('data', (b) => {
    if (b.toString().includes('listening')) ready = true;
  });
  child.stderr.on('data', () => {});

  // Wait up to 5s for the server to come up.
  for (let i = 0; i < 50 && !ready; i++) await sleep(100);
  assert.ok(ready, 'backend did not start');

  try {
    const res = await fetch(`http://${host}:${port}/guest/${encodeURIComponent(share.token)}`);
    assert.equal(res.status, 200);
    const html = await res.text();

    // The rendered page itself must not contain the loopback host.
    assert.ok(!html.includes('127.0.0.1'), 'expected no 127.0.0.1 in served HTML');
    assert.ok(!html.includes('localhost'), 'expected no localhost in served HTML');

    // Real content from the share record.
    assert.match(html, /Test Device/);
    assert.match(html, /big-movie\.mkv/);
    assert.match(html, /photo\.jpg/);
    assert.match(html, /Large file/); // 600 MB triggers the warning
    assert.match(html, /Download all \(2\)/);
    assert.match(html, /Uses left[\s\S]*?2 of 2/);

    // Security / hygiene headers from the backend route.
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

    // Expired link path returns a tidy 404.
    const expired = await fetch(`http://${host}:${port}/guest/does-not-exist`);
    assert.equal(expired.status, 404);
    const expiredBody = await expired.text();
    assert.match(expiredBody, /Link expired/);
    assert.ok(!expiredBody.includes('127.0.0.1'));
  } finally {
    child.kill('SIGTERM');
    await sleep(50);
    await rm(dataDir, { recursive: true, force: true });
  }
});
