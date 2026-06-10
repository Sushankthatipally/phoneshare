// crypto-core/src/rn.ts
// React Native entrypoint. quick-crypto polyfills most of Web Crypto (AES-GCM,
// HKDF, SHA-256), but its v0.7.x does NOT implement subtle.generateKey('X25519')
// or subtle.deriveBits({ name: 'X25519' }). We override those two functions
// here with pure-JS X25519 from @noble/curves; everything else falls through
// to the shared implementation in ./index.

// On react-native-web there is no native QuickCrypto module and requiring it
// throws — but the browser already ships a complete WebCrypto, so we simply
// skip the polyfill there and let everything fall through to globalThis.crypto.
let qc: { install?: () => void; randomBytes?: (n: number) => Buffer } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  qc = require('react-native-quick-crypto');
  if (qc?.install) {
    qc.install();
  }
} catch {
  qc = null;
}

// Ensure crypto.getRandomValues is present even if quick-crypto's install()
// only patches subtle/createHash/etc. Used by `encryptChunk` for AES nonces.
if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues !== 'function' && qc?.randomBytes) {
  // @ts-ignore — newer @types/node tightens the signature to accept null; the polyfill below never receives null.
  (globalThis.crypto as Crypto & { getRandomValues: <T extends ArrayBufferView>(view: T) => T }).getRandomValues =
    <T extends ArrayBufferView>(view: T): T => {
      const bytes: Buffer = qc.randomBytes(view.byteLength);
      const dst = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      dst.set(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return view;
    };
}

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

// Source 32 random bytes through quick-crypto so we don't depend on
// globalThis.crypto.getRandomValues being installed at noble-curves load time.
function randomBytes32(): Uint8Array {
  // quick-crypto exposes Node-style `randomBytes`; fall back to Web Crypto if available.
  if (qc && typeof qc.randomBytes === 'function') {
    const buf: Buffer = qc.randomBytes(32);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  }
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(new Uint8Array(32));
  }
  throw new Error('No secure random source available (quick-crypto.randomBytes / crypto.getRandomValues both missing)');
}

import type { KeyAgreementMaterial, SessionKeyMaterial } from './index.js';
import {
  decodeBase64Url,
  encodeBase64Url,
  encodeUtf8,
  toBufferSource,
  toHex,
} from './index.js';

export * from './index.js';

// Re-export overrides AFTER `export *` so these win over the originals.
export async function generateKeyAgreement(): Promise<KeyAgreementMaterial> {
  const privateKey = randomBytes32();
  const publicKey = x25519.getPublicKey(privateKey);
  return {
    publicKey: encodeBase64Url(publicKey),
    privateKey,
  };
}

/** RN-native PIN derivation — pure JS, no subtle.HKDF dependency. */
export async function derivePinCode(
  sharedSecret: ArrayBuffer | Uint8Array,
  sessionId: string,
): Promise<string> {
  const secret = sharedSecret instanceof Uint8Array ? sharedSecret : new Uint8Array(sharedSecret);
  const salt = encodeUtf8(sessionId);
  const info = encodeUtf8('dropbeam-sas-v1');
  const derivedBits = hkdf(sha256, secret, salt, info, 4);
  const view = new DataView(derivedBits.buffer, derivedBits.byteOffset, derivedBits.byteLength);
  const value = view.getUint32(0, false);
  return (value % 1_000_000).toString().padStart(6, '0');
}

export async function deriveSessionKey(input: {
  keyAgreement: KeyAgreementMaterial;
  remotePublicKey: string;
  sessionId: string;
}): Promise<SessionKeyMaterial> {
  if (!(input.keyAgreement.privateKey instanceof Uint8Array)) {
    throw new Error('deriveSessionKey (RN): expected Uint8Array private key from generateKeyAgreement');
  }
  const remote = decodeBase64Url(input.remotePublicKey);
  const sharedSecret = x25519.getSharedSecret(input.keyAgreement.privateKey, remote);
  // Pure-JS HKDF — quick-crypto v0.7.x doesn't implement subtle.importKey('HKDF').
  const rawKey = hkdf(
    sha256,
    sharedSecret,
    encodeUtf8(input.sessionId),
    encodeUtf8('dropbeam-session-key'),
    32,
  );

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('deriveSessionKey (RN): globalThis.crypto.subtle missing — quick-crypto install() did not run');
  }
  // Use noble sha256 directly so we don't depend on subtle.digest support.
  const digest = sha256(sharedSecret);
  const cryptoKey = await subtle.importKey(
    'raw',
    toBufferSource(rawKey),
    { name: 'AES-GCM', length: 256 } as unknown as AlgorithmIdentifier,
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
