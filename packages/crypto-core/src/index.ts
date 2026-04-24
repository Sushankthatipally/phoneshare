const AES_NONCE_BYTES = 12;
const AES_GCM_ALGORITHM = 'AES-GCM';
const X25519_ALGORITHM = { name: 'X25519' } as const;

export type PairingTransport = 'usb' | 'wifi';

export interface PairingPayload {
  sessionId: string;
  transport: PairingTransport;
  host: string;
  port: number;
  publicKey: string;
  expiresAt: string;
}

export interface PairingSeed {
  host: string;
  port: number;
  transport: PairingTransport;
  publicKey: string;
  sessionId?: string;
  ttlMs?: number;
  expiresAt?: string;
}

export interface KeyAgreementMaterial {
  publicKey: string;
  privateKey: CryptoKey;
}

export interface SessionKeyMaterial {
  algorithm: 'x25519-hkdf-sha256/aes-256-gcm';
  keyId: string;
  publicKey: string;
  cryptoKey: CryptoKey;
  rawKey: Uint8Array;
}

export interface EncryptedTransferChunk {
  chunkIndex: number;
  nonce: string;
  ciphertext: string;
}

export async function createPairingSession(
  seed: Omit<PairingSeed, 'publicKey'>,
): Promise<{ keyAgreement: KeyAgreementMaterial; payload: PairingPayload }> {
  const keyAgreement = await generateKeyAgreement();

  return {
    keyAgreement,
    payload: buildPairingPayload({
      ...seed,
      publicKey: keyAgreement.publicKey,
    }),
  };
}

export function buildPairingPayload(seed: PairingSeed): PairingPayload {
  return {
    sessionId: seed.sessionId ?? `session-${crypto.randomUUID()}`,
    transport: seed.transport,
    host: seed.host,
    port: seed.port,
    publicKey: seed.publicKey,
    expiresAt:
      seed.expiresAt ??
      new Date(Date.now() + (seed.ttlMs ?? 10 * 60 * 1000)).toISOString(),
  };
}

export function buildPairingUrl(payload: PairingPayload) {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `http://${payload.host}:${payload.port}/#pair=${encoded}`;
}

export async function generateKeyAgreement(): Promise<KeyAgreementMaterial> {
  const subtle = requireSubtleCrypto();
  const pair = await subtle.generateKey(
    X25519_ALGORITHM as unknown as AlgorithmIdentifier,
    true,
    ['deriveBits'],
  );

  if (!isCryptoKeyPair(pair)) {
    throw new Error('X25519 key generation did not return a key pair');
  }

  const publicKey = new Uint8Array(
    await subtle.exportKey('raw', pair.publicKey),
  );

  return {
    publicKey: encodeBase64Url(publicKey),
    privateKey: pair.privateKey,
  };
}

export async function deriveSessionKey(input: {
  keyAgreement: KeyAgreementMaterial;
  remotePublicKey: string;
  sessionId: string;
}): Promise<SessionKeyMaterial> {
  const subtle = requireSubtleCrypto();
  const remotePublicKey = await subtle.importKey(
    'raw',
    toBufferSource(decodeBase64Url(input.remotePublicKey)),
    X25519_ALGORITHM as unknown as AlgorithmIdentifier,
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await subtle.deriveBits(
      {
        name: 'X25519',
        public: remotePublicKey,
      } as unknown as AlgorithmIdentifier,
      input.keyAgreement.privateKey,
      256,
    ),
  );
  const rawKey = await hkdfSha256(
    sharedSecret,
    encodeUtf8(input.sessionId),
    encodeUtf8('dropbeam-session-key'),
    32,
  );
  const digest = new Uint8Array(await subtle.digest('SHA-256', sharedSecret));
  const cryptoKey = await subtle.importKey(
    'raw',
    toBufferSource(rawKey),
    {
      name: AES_GCM_ALGORITHM,
      length: 256,
    } as unknown as AlgorithmIdentifier,
    false,
    ['encrypt', 'decrypt'],
  );

  return {
    algorithm: 'x25519-hkdf-sha256/aes-256-gcm',
    keyId: toHex(digest.slice(0, 8)),
    publicKey: input.keyAgreement.publicKey,
    cryptoKey,
    rawKey,
  };
}

export async function encryptChunk(input: {
  sessionKey: SessionKeyMaterial;
  sessionId: string;
  fileId: string;
  chunkIndex: number;
  plaintext: Uint8Array;
}): Promise<EncryptedTransferChunk> {
  const subtle = requireSubtleCrypto();
  const nonce = crypto.getRandomValues(new Uint8Array(AES_NONCE_BYTES));
  const ciphertext = await subtle.encrypt(
    {
      name: AES_GCM_ALGORITHM,
      iv: toBufferSource(nonce),
      additionalData: toBufferSource(
        encodeUtf8(`${input.sessionId}:${input.fileId}:${input.chunkIndex}`),
      ),
      tagLength: 128,
    },
    input.sessionKey.cryptoKey,
    toBufferSource(input.plaintext),
  );

  return {
    chunkIndex: input.chunkIndex,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptChunk(input: {
  sessionKey: SessionKeyMaterial;
  sessionId: string;
  fileId: string;
  chunk: EncryptedTransferChunk;
}): Promise<Uint8Array> {
  const subtle = requireSubtleCrypto();
  const plaintext = await subtle.decrypt(
    {
      name: AES_GCM_ALGORITHM,
      iv: toBufferSource(decodeBase64Url(input.chunk.nonce)),
      additionalData: toBufferSource(
        encodeUtf8(`${input.sessionId}:${input.fileId}:${input.chunk.chunkIndex}`),
      ),
      tagLength: 128,
    },
    input.sessionKey.cryptoKey,
    toBufferSource(decodeBase64Url(input.chunk.ciphertext)),
  );

  return new Uint8Array(plaintext);
}

export async function importSessionKey(input: {
  rawKey: Uint8Array;
  publicKey?: string;
  keyId?: string;
}): Promise<SessionKeyMaterial> {
  const subtle = requireSubtleCrypto();
  const rawKey = Uint8Array.from(input.rawKey);
  const digest = new Uint8Array(await subtle.digest('SHA-256', rawKey));
  const cryptoKey = await subtle.importKey(
    'raw',
    toBufferSource(rawKey),
    {
      name: AES_GCM_ALGORITHM,
      length: 256,
    } as unknown as AlgorithmIdentifier,
    false,
    ['encrypt', 'decrypt'],
  );

  return {
    algorithm: 'x25519-hkdf-sha256/aes-256-gcm',
    keyId: input.keyId ?? toHex(digest.slice(0, 8)),
    publicKey: input.publicKey ?? '',
    cryptoKey,
    rawKey,
  };
}

async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  outputBytes: number,
) {
  const subtle = requireSubtleCrypto();
  const imported = await subtle.importKey('raw', toBufferSource(ikm), 'HKDF', false, [
    'deriveBits',
  ]);
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
    throw new Error('Web Crypto is required for DropBeam crypto operations');
  }

  return globalThis.crypto.subtle;
}

function isCryptoKeyPair(value: CryptoKeyPair | CryptoKey): value is CryptoKeyPair {
  return 'privateKey' in value && 'publicKey' in value;
}

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function toBufferSource(bytes: Uint8Array) {
  return Uint8Array.from(bytes).buffer;
}
