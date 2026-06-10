// E2E smoke test for the DropBeam transfer pipeline.
// Simulates a phone against a running backend (default http://127.0.0.1:17619):
//   create session -> ECDH connect (auto-pair) -> transfer batch request/accept
//   -> encrypted chunk upload -> finalize -> plain download -> encrypted payload download.
// Usage: node scripts/smoke-transfer.mjs [backendOrigin]

const ORIGIN = process.argv[2] ?? 'http://127.0.0.1:17619';
const subtle = globalThis.crypto.subtle;

function b64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}
function fromB64url(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

async function api(method, path, body, raw = false) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function hkdfSha256(ikm, salt, info, outputBytes) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(salt), info: new TextEncoder().encode(info) },
    key,
    outputBytes * 8,
  );
  return new Uint8Array(bits);
}

let failures = 0;
function check(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

// ── 1. Session create ────────────────────────────────────────────
const created = await api('POST', '/api/sessions', { mode: 'wifi' });
const session = created.session ?? created;
const sessionId = session.id;
check('create session', Boolean(sessionId), `id=${sessionId} state=${session.state}`);

// The phone normally learns the backend public key from mDNS TXT records (`pk`)
// or the pairing URL hash. Parse it from the pairing URL like a phone would.
let backendPublicKey = null;
const pairingUrl = session.pairing?.ticket?.pairingUrl ?? '';
const hashMatch = /#pair=(.+)$/.exec(pairingUrl);
if (hashMatch) {
  try {
    backendPublicKey = JSON.parse(decodeURIComponent(hashMatch[1])).publicKey ?? null;
  } catch {
    backendPublicKey = null;
  }
}
check('pairing URL exposes backend public key', Boolean(backendPublicKey));

// ── 2. Phone-side X25519 keypair + connect ───────────────────────
const phonePair = await subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
const phonePublicKey = b64url(new Uint8Array(await subtle.exportKey('raw', phonePair.publicKey)));

const connected = await api('POST', `/api/sessions/${sessionId}/connect`, {
  deviceName: 'Smoke iPhone',
  platform: 'ios',
  publicKey: phonePublicKey,
});
check('connect auto-pairs', connected.session?.state === 'paired', `state=${connected.session?.state}`);
check('pairing is encrypted', connected.session?.pairing?.encrypted === true);

// ── 3. Phone derives the same AEAD key ───────────────────────────
let rawKey = null;
if (backendPublicKey) {
  const backendKey = await subtle.importKey('raw', fromB64url(backendPublicKey), { name: 'X25519' }, false, []);
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: 'X25519', public: backendKey }, phonePair.privateKey, 256),
  );
  rawKey = await hkdfSha256(shared, sessionId, 'dropbeam-session-key', 32);
}
check('phone derived session key', Boolean(rawKey));
if (!rawKey) {
  console.log('\nSMOKE: cannot continue without session key');
  process.exit(1);
}

// ── 4. Transfer batch request + accept ───────────────────────────
const content = new TextEncoder().encode(`dropbeam smoke ${new Date().toISOString()}`);
const batchRes = await api('POST', `/api/sessions/${sessionId}/transfers`, {
  direction: 'phone-to-desktop',
  deviceName: 'Smoke iPhone',
  files: [{ name: 'smoke.txt', size: content.byteLength, mimeType: 'text/plain' }],
});
const batch = batchRes.batch;
check('transfer batch requested', Boolean(batch?.id), `batch=${batch?.id}`);

const acceptRes = await api('POST', `/api/sessions/${sessionId}/transfers/${batch.id}/accept`, {});
check('transfer batch accepted', acceptRes.result?.accepted?.length === 1);

// ── 5. Encrypted upload ──────────────────────────────────────────
const uploadRes = await api('POST', `/api/sessions/${sessionId}/uploads/start`, {
  direction: 'phone-to-desktop',
  name: 'smoke.txt',
  mimeType: 'text/plain',
  size: content.byteLength,
  chunkSize: content.byteLength,
  totalChunks: 1,
  deviceName: 'Smoke iPhone',
});
const upload = uploadRes.upload;
check('upload started', Boolean(upload?.id), `upload=${upload?.id}`);

const aesKey = await subtle.importKey('raw', rawKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const nonce = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = new Uint8Array(
  await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: new TextEncoder().encode(`${sessionId}:${upload.id}:0`),
      tagLength: 128,
    },
    aesKey,
    content,
  ),
);
const chunkRes = await api('PUT', `/api/uploads/${upload.id}/chunks/0`, {
  encrypted: true,
  fileId: upload.id,
  chunk: { chunkIndex: 0, nonce: b64url(nonce), ciphertext: b64url(ciphertext) },
});
check('encrypted chunk accepted', chunkRes.upload?.uploadedBytes === content.byteLength,
  `uploadedBytes=${chunkRes.upload?.uploadedBytes}`);

const completeRes = await api('POST', `/api/uploads/${upload.id}/complete`, {});
check('upload finalized', completeRes.file?.status === 'ready', `status=${completeRes.file?.status}`);

// ── 6. Plain download (receiver side) ────────────────────────────
const dl = await api('GET', `/api/files/${upload.id}/download`, undefined, true);
const dlBytes = new Uint8Array(await dl.arrayBuffer());
check('download matches original', dl.ok && Buffer.from(dlBytes).equals(Buffer.from(content)),
  `status=${dl.status} bytes=${dlBytes.byteLength}`);

// ── 7. Encrypted payload download (phone side) ───────────────────
const payloadRes = await api('GET', `/api/files/${upload.id}/payload?sessionId=${sessionId}`);
let decryptedOk = false;
if (payloadRes.payload && rawKey) {
  const plain = new Uint8Array(
    await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromB64url(payloadRes.payload.nonce),
        additionalData: new TextEncoder().encode(`${sessionId}:${upload.id}:0`),
        tagLength: 128,
      },
      aesKey,
      fromB64url(payloadRes.payload.ciphertext),
    ),
  );
  decryptedOk = Buffer.from(plain).equals(Buffer.from(content));
}
check('encrypted payload decrypts to original', decryptedOk);

console.log(failures === 0 ? '\nSMOKE: ALL PASS' : `\nSMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
