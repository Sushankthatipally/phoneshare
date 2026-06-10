import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

import { LocalBackendStore } from '../store.js';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

async function spawnStore(prefix) {
  const dataDir = await mkdtemp(join(tmpdir(), `dropbeam-w4-${prefix}-`));
  const events = [];
  const store = new LocalBackendStore({
    dataDir,
    emit: (type, payload) => events.push({ type, payload }),
  });
  await store.init();
  return { store, dataDir, events };
}

async function generatePeerPublicKey() {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  let binary = '';
  for (let i = 0; i < raw.length; i += 1) binary += String.fromCharCode(raw[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// ─── New PIN-less contract tests ──────────────────────────────────────────────

test('requestConnect with valid X25519 publicKey pairs immediately (state=paired, encrypted=true)', async (t) => {
  const { store, dataDir } = await spawnStore('paired');
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const session = await store.createSession({ deviceName: 'TestDesktop' });
  const remotePublicKey = await generatePeerPublicKey();

  const result = await store.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'android',
    remotePublicKey,
  });

  assert.equal(result.state, 'paired', 'session must be paired immediately');
  assert.equal(result.pairing.encrypted, true, 'AEAD encryption must be enabled');
  assert.ok(store.sessionSecrets.has(session.id), 'AEAD session secret must exist in store');
});

test('verifyPin on a paired session rejects with 409 "not awaiting PIN verification"', async (t) => {
  const { store, dataDir } = await spawnStore('vpin-reject');
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const session = await store.createSession({ deviceName: 'TestDesktop' });
  const remotePublicKey = await generatePeerPublicKey();

  await store.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'android',
    remotePublicKey,
  });

  // PIN flow was removed — verifyPin must reject for any session state.
  await assert.rejects(
    () => store.verifyPin(session.id, { pin: '123456', deviceFingerprint: 'android:testphone' }),
    (err) => {
      assert.equal(err.status, 409);
      assert.ok(
        /not awaiting PIN verification/i.test(err.message),
        `unexpected message: ${err.message}`,
      );
      return true;
    },
  );
});

test('verifyPin on a fresh (pairing) session also rejects with 409', async (t) => {
  const { store, dataDir } = await spawnStore('vpin-fresh');
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const session = await store.createSession({ deviceName: 'TestDesktop' });

  // No requestConnect — session is still in 'pairing' state.
  await assert.rejects(
    () => store.verifyPin(session.id, { pin: '000000', deviceFingerprint: 'android:x' }),
    (err) => {
      assert.equal(err.status, 409);
      return true;
    },
  );
});

// ─── Persistence test (rewritten for PIN-less flow) ───────────────────────────

test('pairingKeys persist across store restart — requestConnect on restored session pairs with encryption', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dropbeam-w4-persist-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  // Boot store1, create a session (this generates & persists the pairing keypair).
  const events1 = [];
  const store1 = new LocalBackendStore({
    dataDir,
    emit: (type, payload) => events1.push({ type, payload }),
  });
  await store1.init();
  const session = await store1.createSession({ deviceName: 'TestDesktop' });

  // Verify the pairing key was written to disk by store1.
  assert.ok(store1.pairingKeys.has(session.id), 'pairing key must exist in store1 memory');

  // Spin up a fresh store backed by the same data dir — simulates a sidecar restart.
  const events2 = [];
  const store2 = new LocalBackendStore({
    dataDir,
    emit: (type, payload) => events2.push({ type, payload }),
  });
  await store2.init();

  // The pairing private key must have survived the restart.
  const restoredEntry = store2.pairingKeys.get(session.id);
  assert.ok(restoredEntry?.privateKey, 'pairing private key must be restored from state.json');
  assert.ok(restoredEntry.publicKey && restoredEntry.publicKey.length > 0, 'public key must be restored');

  // requestConnect on the restored session must pair successfully with encryption,
  // proving the private key is functional (ECDH derivation succeeds).
  const remotePublicKey = await generatePeerPublicKey();
  const result = await store2.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'android',
    remotePublicKey,
  });
  assert.equal(result.state, 'paired', 'session must pair after restart');
  assert.equal(result.pairing.encrypted, true, 'AEAD encryption must be active post-restart');
  assert.ok(store2.sessionSecrets.has(session.id), 'AEAD session secret must be derived post-restart');
});

// ─── TTL eviction test (unchanged — was passing before) ──────────────────────

test('pairingKeys older than TTL are dropped on boot', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dropbeam-w4-ttl-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const store1 = new LocalBackendStore({ dataDir, emit: () => {} });
  await store1.init();
  const session = await store1.createSession({ deviceName: 'TestDesktop' });

  // Forge an expired entry on disk: read, mutate, write back.
  const { readFile, writeFile } = await import('node:fs/promises');
  const statePath = join(dataDir, 'state.json');
  const raw = JSON.parse(await readFile(statePath, 'utf8'));
  raw.pairingKeys[session.id].createdAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  raw.pairingKeys[session.id].expiresAt = new Date(Date.now() - 60 * 1000).toISOString();
  await writeFile(statePath, JSON.stringify(raw, null, 2));

  const store2 = new LocalBackendStore({ dataDir, emit: () => {} });
  await store2.init();
  assert.ok(!store2.pairingKeys.has(session.id), 'expired pairing key dropped');
});
