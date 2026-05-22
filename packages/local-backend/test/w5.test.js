import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  LocalBackendStore,
  MAX_PIN_ATTEMPTS,
  createUploadFingerprint,
  getPreferredLanOrigin,
  hashFile,
  hashFileHead,
} from '../src/store.js';

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'dropbeam-w5-'));
  const store = new LocalBackendStore({ dataDir: dir, emit: () => {} });
  await store.init();
  return { store, dir };
}

test('MAX_PIN_ATTEMPTS is exported and stable', () => {
  assert.equal(MAX_PIN_ATTEMPTS, 3);
});

test('getPreferredLanOrigin returns shape { host, score, interface, origin }', () => {
  const result = getPreferredLanOrigin();
  assert.ok(typeof result.host === 'string' && result.host.length > 0);
  assert.ok(typeof result.score === 'number');
  assert.ok('interface' in result);
  assert.ok(result.origin.startsWith('http://'));
});

test('hashFile streams a 1MB file and matches openssl sha256', async () => {
  const { dir } = await makeStore();
  try {
    const path = join(dir, 'one-mb.bin');
    const bytes = randomBytes(1024 * 1024);
    await writeFile(path, bytes);

    const ours = await hashFile(path);
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(ours, expected);

    try {
      const opensslOut = execFileSync('openssl', ['dgst', '-sha256', path], { encoding: 'utf8' });
      const opensslHex = opensslOut.trim().split(/\s+/).pop();
      assert.equal(ours, opensslHex);
    } catch {
      // openssl not available — already verified via createHash.
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('hashFileHead matches first 256KB only, ignoring tail bytes', async () => {
  const { dir } = await makeStore();
  try {
    const head = randomBytes(256 * 1024);
    const tailA = randomBytes(64 * 1024);
    const tailB = randomBytes(64 * 1024);
    const a = join(dir, 'a.bin');
    const b = join(dir, 'b.bin');
    await writeFile(a, Buffer.concat([head, tailA]));
    await writeFile(b, Buffer.concat([head, tailB]));
    assert.equal(await hashFileHead(a), await hashFileHead(b));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('createUploadFingerprint is stable across different sessionIds', () => {
  const base = {
    direction: 'phone-to-desktop',
    fileHashFirst256KB: 'abc123',
    name: 'photo.jpg',
    relativePath: 'DCIM/photo.jpg',
    size: 1024 * 1024,
    sourceDeviceFingerprint: 'ios:my-iphone',
  };
  // Adding sessionId should NOT affect the fingerprint (it's not consumed).
  const fpA = createUploadFingerprint({ ...base, sessionId: 'session-A' });
  const fpB = createUploadFingerprint({ ...base, sessionId: 'session-B' });
  assert.equal(fpA, fpB, 'fingerprint must be stable across sessions');
  // Changing a real input must change the fingerprint.
  const fpDifferentName = createUploadFingerprint({ ...base, name: 'other.jpg' });
  assert.notEqual(fpA, fpDifferentName);
  const fpDifferentHead = createUploadFingerprint({ ...base, fileHashFirst256KB: 'xyz' });
  assert.notEqual(fpA, fpDifferentHead);
});

test('incrementGuestUse increments once per token-load, not per file download', async () => {
  const { store, dir } = await makeStore();
  try {
    const share = await store.createGuestShare({ maxUses: 3, ttlMs: 60_000 });

    // Simulate 3 token-loads (HTML page renders), each calls incrementGuestUse once.
    await store.incrementGuestUse(share.token);
    await store.incrementGuestUse(share.token);
    await store.incrementGuestUse(share.token);

    const internal = store.guestShares.get(share.token);
    assert.equal(internal.uses, 3, 'each render bumps uses');

    // After hitting maxUses the share becomes unavailable to getGuestShare.
    assert.equal(store.getGuestShare(share.token), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
