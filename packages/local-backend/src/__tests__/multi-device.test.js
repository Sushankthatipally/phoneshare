import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { LocalBackendStore } from '../store.js';

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

async function makeStore() {
  const dataDir = await mkdtemp(join(tmpdir(), 'dropbeam-w7-'));
  const events = [];
  const store = new LocalBackendStore({
    dataDir,
    emit: (type, payload) => events.push({ type, payload }),
  });
  await store.init();
  return { store, dataDir, events, cleanup: () => rm(dataDir, { recursive: true, force: true }) };
}

async function generatePeerPublicKey() {
  const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  let binary = '';
  for (let i = 0; i < raw.length; i += 1) binary += String.fromCharCode(raw[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

test('multi-device: three connects within capacity succeed, fourth returns 409 session-full', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);

  const session = await store.createSession({ multiDevice: true, maxDevices: 3 });
  assert.equal(session.multiDevice, true);
  assert.equal(session.maxDevices, 3);
  assert.ok(Array.isArray(session.slots));
  assert.equal(session.slots.length, 3);
  for (const slot of session.slots) {
    assert.equal(slot.status, 'open');
  }

  for (let i = 0; i < 3; i += 1) {
    const remotePublicKey = await generatePeerPublicKey();
    await store.requestConnect(session.id, {
      deviceName: `Phone ${i + 1}`,
      platform: 'android',
      remotePublicKey,
    });
    const updated = await store.acceptSession(session.id);
    assert.equal(updated.state, 'paired');
    const connectedSlots = updated.slots.filter((s) => s.status === 'connected');
    assert.equal(connectedSlots.length, i + 1);
  }

  await assert.rejects(
    store.requestConnect(session.id, { deviceName: 'Phone 4', platform: 'android' }),
    (err) => {
      assert.equal(err.status, 409);
      assert.deepEqual(err.body, {
        error: 'session-full',
        maxDevices: 3,
        connectedDevices: 3,
      });
      return true;
    },
  );

  const final = store.getSession(session.id);
  assert.equal(final.connectedDevices.length, 3);
  const fingerprints = new Set(final.connectedDevices.map((d) => d.fingerprint));
  assert.equal(fingerprints.size, 3);
});

test('multi-device: default maxDevices is 3 when multiDevice is true and not specified', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);
  const session = await store.createSession({ multiDevice: true });
  assert.equal(session.maxDevices, 3);
  assert.equal(session.slots.length, 3);
});

test('multi-device: disconnecting a device frees the slot (no stale slots)', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);
  const session = await store.createSession({ multiDevice: true, maxDevices: 2 });

  await store.requestConnect(session.id, { deviceName: 'Phone A', platform: 'android' });
  const afterFirst = await store.acceptSession(session.id);
  const firstFp = afterFirst.connectedDevices[0].fingerprint;

  await store.requestConnect(session.id, { deviceName: 'Phone B', platform: 'ios' });
  const afterSecond = await store.acceptSession(session.id);
  assert.equal(afterSecond.connectedDevices.length, 2);

  await assert.rejects(
    store.requestConnect(session.id, { deviceName: 'Phone C', platform: 'ios' }),
    (err) => err.status === 409 && err.body?.error === 'session-full',
  );

  const afterDisconnect = await store.disconnectDeviceFromSession(session.id, firstFp);
  const openSlots = afterDisconnect.slots.filter((s) => s.status === 'open');
  assert.equal(openSlots.length, 1);
  assert.equal(afterDisconnect.connectedDevices.length, 1);

  await store.requestConnect(session.id, { deviceName: 'Phone C', platform: 'ios' });
  const afterThird = await store.acceptSession(session.id);
  assert.equal(afterThird.connectedDevices.length, 2);
});

test('hotspot: ticket carries mode=hotspot with ssid and password', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);

  const session = await store.createSession({
    mode: 'hotspot',
    hotspot: { ssid: 'DropBeam-K7MX2P', password: 'hq8n3rjwtz5m', band: '5GHz' },
  });

  assert.equal(session.mode, 'hotspot');
  const hotspot = session.pairing.ticket.hotspot;
  assert.ok(hotspot, 'ticket must include hotspot payload');
  assert.equal(hotspot.mode, 'hotspot');
  assert.equal(hotspot.ssid, 'DropBeam-K7MX2P');
  assert.equal(hotspot.password, 'hq8n3rjwtz5m');
  assert.equal(hotspot.band, '5GHz');
  assert.equal(hotspot.sessionId, session.id);
  assert.ok(hotspot.publicKey);
  assert.ok(hotspot.host);
  assert.ok(typeof hotspot.port === 'number');

  assert.ok(session.pairing.ticket.qrValue.includes('pair='));
  const hashPayload = session.pairing.ticket.qrValue.split('pair=')[1];
  const decoded = JSON.parse(decodeURIComponent(hashPayload));
  assert.equal(decoded.mode, 'hotspot');
  assert.equal(decoded.ssid, 'DropBeam-K7MX2P');
});

test('hotspot: missing credentials rejects with 400', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);
  await assert.rejects(
    store.createSession({ mode: 'hotspot' }),
    (err) => err.status === 400,
  );
});

test('reconnect known device: skips PIN — pin-verify rejects, ECDH connect alone pairs', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);

  // 1. Bootstrap: pair a phone normally so it lands in knownDevices.
  const initial = await store.createSession({ mode: 'wifi' });
  const remotePublicKey = await generatePeerPublicKey();
  await store.requestConnect(initial.id, {
    deviceName: 'Pixel 8 Pro',
    platform: 'android',
    remotePublicKey,
  });
  const paired = await store.acceptSession(initial.id);
  const fingerprint = paired.peerDevice.fingerprint;
  assert.ok(fingerprint, 'paired session must record peer fingerprint');
  assert.ok(store.listKnownDevices().some((d) => d.fingerprint === fingerprint));

  // 2. Issue reconnect for that known device.
  const result = await store.reconnectKnownDevice(fingerprint, { preferTransport: 'wifi' });
  assert.ok(result.session);
  assert.equal(result.session.state, 'awaiting-known-device');
  assert.deepEqual(result.session.awaitingKnownDevice, { fingerprint });
  assert.equal(result.knownDevice.fingerprint, fingerprint);

  // 3. PIN verify must reject for pre-targeted session.
  await assert.rejects(
    store.verifyPin(result.session.id, '123456'),
    (err) => err.status === 409,
  );

  // 4. ECDH-only connect alone pairs (no separate accept call would be needed if
  //    we recognize the fingerprint). Simulate phone scanning + sending its pubkey.
  const reconnectKey = await generatePeerPublicKey();
  const afterConnect = await store.requestConnect(result.session.id, {
    deviceName: 'Pixel 8 Pro',
    platform: 'android',
    remotePublicKey: reconnectKey,
  });
  assert.equal(afterConnect.state, 'paired');
  assert.equal(afterConnect.pairing.encrypted, true);
  assert.equal(afterConnect.peerDevice.fingerprint, fingerprint);
});

test('reconnect: unknown fingerprint returns 404', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);
  await assert.rejects(
    store.reconnectKnownDevice('android:never-seen'),
    (err) => err.status === 404,
  );
});

test('standard non-known sessions still require PIN (no regression)', async (t) => {
  const { store, cleanup } = await makeStore();
  t.after(cleanup);
  const session = await store.createSession({ mode: 'wifi' });
  await assert.rejects(
    store.verifyPin(session.id, '123456'),
    (err) => err.status === 409 && /no PIN configured/i.test(err.message),
  );
});
