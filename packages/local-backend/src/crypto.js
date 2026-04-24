const AES_NONCE_BYTES = 12;
const AES_GCM_ALGORITHM = 'AES-GCM';
const X25519_ALGORITHM = { name: 'X25519' };

export async function createPairingTicket({
  backendOrigin,
  pairingOrigin,
  sessionId,
  transport,
  ttlMs = 10 * 60 * 1000,
}) {
  const subtle = requireSubtleCrypto();
  const pair = await subtle.generateKey(X25519_ALGORITHM, true, ['deriveBits']);
  if (!isCryptoKeyPair(pair)) {
    throw new Error('DropBeam pairing key generation failed');
  }

  const backendUrl = new URL(normalizeOrigin(backendOrigin));
  const publicKey = encodeBase64Url(
    new Uint8Array(await subtle.exportKey('raw', pair.publicKey)),
  );
  const payload = {
    sessionId,
    transport,
    host: backendUrl.hostname,
    port: Number(backendUrl.port || (backendUrl.protocol === 'https:' ? 443 : 80)),
    publicKey,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
  const pairingUrl = new URL(`${normalizeOrigin(pairingOrigin)}/pair/${encodeURIComponent(sessionId)}`);
  pairingUrl.hash = `pair=${encodeURIComponent(JSON.stringify(payload))}`;

  return {
    pairingUrl: pairingUrl.toString(),
    payload,
    privateKey: pair.privateKey,
    publicKey,
  };
}

export async function deriveSessionSecret({ privateKey, remotePublicKey, sessionId }) {
  const subtle = requireSubtleCrypto();
  const remoteKey = await subtle.importKey(
    'raw',
    toBufferSource(decodeBase64Url(remotePublicKey)),
    X25519_ALGORITHM,
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await subtle.deriveBits(
      {
        name: 'X25519',
        public: remoteKey,
      },
      privateKey,
      256,
    ),
  );
  const rawKey = await hkdfSha256(
    sharedSecret,
    encodeUtf8(sessionId),
    encodeUtf8('dropbeam-session-key'),
    32,
  );
  const digest = new Uint8Array(await subtle.digest('SHA-256', sharedSecret));

  return {
    algorithm: 'x25519-hkdf-sha256/aes-256-gcm',
    keyId: toHex(digest.slice(0, 8)),
    rawKey,
  };
}

export async function encryptTransferBuffer({
  chunkIndex = 0,
  fileId,
  plaintext,
  rawKey,
  sessionId,
}) {
  const subtle = requireSubtleCrypto();
  const key = await importAesKey(rawKey);
  const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_BYTES));
  const ciphertext = await subtle.encrypt(
    {
      name: AES_GCM_ALGORITHM,
      iv: toBufferSource(nonce),
      additionalData: toBufferSource(encodeUtf8(`${sessionId}:${fileId}:${chunkIndex}`)),
      tagLength: 128,
    },
    key,
    toBufferSource(plaintext),
  );

  return {
    chunkIndex,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptTransferChunk({ chunk, fileId, rawKey, sessionId }) {
  const subtle = requireSubtleCrypto();
  const key = await importAesKey(rawKey);
  const plaintext = await subtle.decrypt(
    {
      name: AES_GCM_ALGORITHM,
      iv: toBufferSource(decodeBase64Url(chunk.nonce)),
      additionalData: toBufferSource(encodeUtf8(`${sessionId}:${fileId}:${chunk.chunkIndex}`)),
      tagLength: 128,
    },
    key,
    toBufferSource(decodeBase64Url(chunk.ciphertext)),
  );

  return new Uint8Array(plaintext);
}

async function importAesKey(rawKey) {
  const subtle = requireSubtleCrypto();
  return subtle.importKey(
    'raw',
    toBufferSource(rawKey),
    {
      name: AES_GCM_ALGORITHM,
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function hkdfSha256(ikm, salt, info, outputBytes) {
  const subtle = requireSubtleCrypto();
  const imported = await subtle.importKey('raw', toBufferSource(ikm), 'HKDF', false, ['deriveBits']);
  const derived = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toBufferSource(salt),
      info: toBufferSource(info),
    },
    imported,
    outputBytes * 8,
  );

  return new Uint8Array(derived);
}

function requireSubtleCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is required for DropBeam encryption');
  }

  return globalThis.crypto.subtle;
}

function isCryptoKeyPair(value) {
  return value && 'privateKey' in value && 'publicKey' in value;
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return 'http://127.0.0.1:17619';
  }

  return value.replace(/\/+$/, '');
}

function encodeUtf8(value) {
  return new TextEncoder().encode(value);
}

function encodeBase64Url(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toHex(bytes) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function toBufferSource(bytes) {
  return Uint8Array.from(bytes).buffer;
}
