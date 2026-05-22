import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalBackendStore } from '../store.js';
import {
  createPairingTicket,
  deriveSharedSecret,
  derivePinCode,
} from '../crypto.js';

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

async function setupPeer(store, session) {
  // Phone side: generate its own X25519 keypair, ECDH against desktop's public,
  // compute the SAS PIN. Returns { remotePublicKey, sharedSecret, pin }.
  const subtle = globalThis.crypto.subtle;
  const pair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const remotePublicKeyRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const remotePublicKey = base64UrlEncode(remotePublicKeyRaw);

  // We don't have direct access to desktop pubKey from inside store, but we
  // can read it from store.pairingKeys.
  const desktopEntry = store.pairingKeys.get(session.id);
  assert.ok(desktopEntry, 'desktop pairing key stored');
  const desktopPubRaw = base64UrlDecode(desktopEntry.publicKey);
  const desktopKey = await subtle.importKey('raw', desktopPubRaw, { name: 'X25519' }, false, []);
  const sharedSecret = new Uint8Array(
    await subtle.deriveBits({ name: 'X25519', public: desktopKey }, pair.privateKey, 256),
  );
  const pin = await derivePinCode(sharedSecret, session.id);
  return { remotePublicKey, sharedSecret, pin };
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return Buffer.from(binary, 'binary').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

test('verifyPin: matching SAS transitions session to paired and derives AEAD key', async (t) => {
  const { store, dataDir } = await spawnStore('match');
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const session = await store.createSession({ deviceName: 'TestDesktop' });
  const peer = await setupPeer(store, session);

  await store.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'android',
    remotePublicKey: peer.remotePublicKey,
  });
  const accepted = await store.acceptSession(session.id);
  assert.equal(accepted.state, 'pin-required', 'state advances to pin-required');
  assert.equal(accepted.pairing.pin, peer.pin, 'desktop PIN matches phone-derived PIN');
  assert.equal(accepted.pairing.attemptsRemaining, 3);

  const result = await store.verifyPin(session.id, {
    pin: peer.pin,
    deviceFingerprint: 'android:testphone',
  });
  assert.equal(result.ok, true);
  assert.equal(result.session.state, 'paired');
  assert.equal(result.session.pairing.encrypted, true);
  assert.equal(result.attemptsRemaining, 3);
  assert.ok(store.sessionSecrets.has(session.id), 'AEAD key was derived and stored');
});

test('verifyPin: mismatch decrements attempts but keeps session alive', async (t) => {
  const { store, dataDir, events } = await spawnStore('mismatch');
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const session = await store.createSession({ deviceName: 'TestDesktop' });
  const peer = await setupPeer(store, session);

  await store.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'ios',
    remotePublicKey: peer.remotePublicKey,
  });
  await store.acceptSession(session.id);

  const wrong = wrongPin(peer.pin);
  const r1 = await store.verifyPin(session.id, { pin: wrong, deviceFingerprint: 'ios:testphone' });
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'mismatch');
  assert.equal(r1.attemptsRemaining, 2);

  const r2 = await store.verifyPin(session.id, { pin: wrong, deviceFingerprint: 'ios:testphone' });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'mismatch');
  assert.equal(r2.attemptsRemaining, 1);

  // The session is still alive and AEAD key not yet derived.
  const live = store.getSession(session.id);
  assert.equal(live.state, 'pin-required');
  assert.equal(live.pairing.attemptsRemaining, 1);
  assert.ok(!store.sessionSecrets.has(session.id));

  // Real PIN still works on the last attempt
  const ok = await store.verifyPin(session.id, { pin: peer.pin, deviceFingerprint: 'ios:testphone' });
  assert.equal(ok.ok, true);
  assert.equal(ok.session.state, 'paired');

  assert.ok(
    events.some((e) => e.type === 'pin-mismatch'),
    'pin-mismatch SSE event broadcast',
  );
});

test('verifyPin: 3 strikes destroys session, zeros keys, broadcasts session-locked', async (t) => {
  const { store, dataDir, events } = await spawnStore('lockout');
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const session = await store.createSession({ deviceName: 'TestDesktop' });
  const peer = await setupPeer(store, session);

  await store.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'android',
    remotePublicKey: peer.remotePublicKey,
  });
  await store.acceptSession(session.id);

  const wrong = wrongPin(peer.pin);
  await store.verifyPin(session.id, { pin: wrong, deviceFingerprint: 'android:testphone' });
  await store.verifyPin(session.id, { pin: wrong, deviceFingerprint: 'android:testphone' });
  const final = await store.verifyPin(session.id, { pin: wrong, deviceFingerprint: 'android:testphone' });

  assert.equal(final.ok, false);
  assert.equal(final.reason, 'locked');
  assert.equal(final.attemptsRemaining, 0);

  const live = store.getSession(session.id);
  assert.equal(live.state, 'locked');
  assert.equal(live.closedReason, 'pin-attempts-exhausted');

  assert.ok(!store.pairingKeys.has(session.id), 'pairing key dropped on lockout');
  assert.ok(!store.sessionSecrets.has(session.id), 'no AEAD key was derived');

  const lockedEvent = events.find((e) => e.type === 'session-locked');
  assert.ok(lockedEvent, 'session-locked SSE event broadcast');
  assert.equal(lockedEvent.payload.reason, 'pin-attempts-exhausted');
  assert.equal(lockedEvent.payload.sessionId, session.id);

  // Further verifyPin calls reject because the session is locked
  await assert.rejects(
    () => store.verifyPin(session.id, { pin: peer.pin, deviceFingerprint: 'android:testphone' }),
    /not awaiting PIN verification/,
  );
});

test('pairingKeys persist across store restart (mid-pairing)', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'dropbeam-w4-persist-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const events1 = [];
  const store1 = new LocalBackendStore({
    dataDir,
    emit: (type, payload) => events1.push({ type, payload }),
  });
  await store1.init();
  const session = await store1.createSession({ deviceName: 'TestDesktop' });
  const peer = await setupPeer(store1, session);
  await store1.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'android',
    remotePublicKey: peer.remotePublicKey,
  });
  await store1.acceptSession(session.id);
  // Persist already happened inside acceptSession.

  // Spin up a fresh store backed by the same data dir — simulates restart.
  const events2 = [];
  const store2 = new LocalBackendStore({
    dataDir,
    emit: (type, payload) => events2.push({ type, payload }),
  });
  await store2.init();

  const restoredEntry = store2.pairingKeys.get(session.id);
  assert.ok(restoredEntry?.privateKey, 'pairing key restored from state.json');
  assert.ok(restoredEntry.publicKey && restoredEntry.publicKey.length > 0, 'public key restored');

  const restoredSession = store2.getSession(session.id);
  assert.equal(restoredSession.state, 'pin-required');

  // The pin verification still works post-restart because the pinChallenge
  // (which carries the shared secret) was persisted alongside the session.
  const result = await store2.verifyPin(session.id, {
    pin: peer.pin,
    deviceFingerprint: 'android:testphone',
  });
  assert.equal(result.ok, true);
  assert.equal(result.session.state, 'paired');
});

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

function wrongPin(realPin) {
  const digits = '0123456789';
  let candidate = realPin;
  while (candidate === realPin) {
    candidate = '';
    for (let i = 0; i < 6; i += 1) {
      candidate += digits[Math.floor(Math.random() * 10)];
    }
  }
  return candidate;
}
