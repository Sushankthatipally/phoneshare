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

async function makeStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dropbeam-upload-'));
  const store = new LocalBackendStore({
    dataDir,
    emit: () => {},
  });
  await store.init();
  return { store, dataDir, cleanup: () => rm(dataDir, { recursive: true, force: true }) };
}

async function generatePeerPublicKey() {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  let binary = '';
  for (let i = 0; i < raw.length; i += 1) binary += String.fromCharCode(raw[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function pairSession(store) {
  const session = await store.createSession({ mode: 'wifi' });
  const remotePublicKey = await generatePeerPublicKey();
  const paired = await store.requestConnect(session.id, {
    deviceName: 'TestPhone',
    platform: 'android',
    remotePublicKey,
  });
  assert.equal(paired.state, 'paired');
  return paired;
}

// Regression: cross-session upload resume must NOT collide.
// store.startUpload now scopes resume to the same sessionId — before the fix,
// two sessions uploading identical files would share the same upload id, causing
// one session to shadow the other and poisoning the transfer.
test('cross-session upload resume: identical file metadata produces distinct upload ids per session', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);

  // Pair two independent sessions.
  const sessionA = await pairSession(store);
  const sessionB = await pairSession(store);

  const sharedFileMeta = {
    direction: 'phone-to-desktop',
    name: 'x.txt',
    size: 1024,
    mimeType: 'text/plain',
    chunkSize: 1024,
    totalChunks: 1,
  };

  // Start an upload for session A but do NOT complete it (it stays 'pending').
  const uploadA = await store.startUpload(sessionA.id, sharedFileMeta);
  assert.equal(uploadA.status, 'pending', 'upload A must be pending');

  // Start an upload for session B with the exact same file metadata.
  const uploadB = await store.startUpload(sessionB.id, sharedFileMeta);
  assert.equal(uploadB.status, 'pending', 'upload B must be pending');

  // The two uploads must have different ids — session B must NOT resume session A's upload.
  assert.notEqual(
    uploadB.id,
    uploadA.id,
    'session B upload id must differ from session A upload id (no cross-session resume)',
  );
});
