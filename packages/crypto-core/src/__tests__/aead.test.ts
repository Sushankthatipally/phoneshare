import { describe, expect, it } from 'vitest';
import {
  decryptChunk,
  deriveSessionKey,
  encryptChunk,
  generateKeyAgreement,
} from '../index.js';

async function makeSessionKey() {
  const alice = await generateKeyAgreement();
  const bob = await generateKeyAgreement();
  const sessionId = 'aead-test-session';

  const aliceSession = await deriveSessionKey({
    keyAgreement: alice,
    remotePublicKey: bob.publicKey,
    sessionId,
  });

  return { sessionKey: aliceSession, sessionId };
}

describe('AEAD round-trip', () => {
  it('encrypts and decrypts a chunk successfully', async () => {
    const { sessionKey, sessionId } = await makeSessionKey();
    const plaintext = new TextEncoder().encode('hello dropbeam');

    const encrypted = await encryptChunk({
      sessionKey,
      sessionId,
      fileId: 'file-001',
      chunkIndex: 0,
      plaintext,
    });

    const decrypted = await decryptChunk({
      sessionKey,
      sessionId,
      fileId: 'file-001',
      chunk: encrypted,
    });

    expect(decrypted).toEqual(plaintext);
  });

  it('encrypts and decrypts a large binary chunk', async () => {
    const { sessionKey, sessionId } = await makeSessionKey();
    const plaintext = new Uint8Array(64 * 1024);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = i & 0xff;

    const encrypted = await encryptChunk({
      sessionKey,
      sessionId,
      fileId: 'file-big',
      chunkIndex: 7,
      plaintext,
    });

    const decrypted = await decryptChunk({
      sessionKey,
      sessionId,
      fileId: 'file-big',
      chunk: encrypted,
    });

    expect(decrypted).toEqual(plaintext);
  });

  it('rejects decryption when sessionId (AAD) is wrong', async () => {
    const { sessionKey, sessionId } = await makeSessionKey();
    const plaintext = new TextEncoder().encode('tamper test');

    const encrypted = await encryptChunk({
      sessionKey,
      sessionId,
      fileId: 'file-aad',
      chunkIndex: 0,
      plaintext,
    });

    await expect(
      decryptChunk({
        sessionKey,
        sessionId: 'wrong-session-id',
        fileId: 'file-aad',
        chunk: encrypted,
      }),
    ).rejects.toThrow();
  });

  it('rejects decryption when fileId (AAD) is wrong', async () => {
    const { sessionKey, sessionId } = await makeSessionKey();
    const plaintext = new TextEncoder().encode('tamper test file id');

    const encrypted = await encryptChunk({
      sessionKey,
      sessionId,
      fileId: 'file-aad-correct',
      chunkIndex: 0,
      plaintext,
    });

    await expect(
      decryptChunk({
        sessionKey,
        sessionId,
        fileId: 'file-aad-wrong',
        chunk: encrypted,
      }),
    ).rejects.toThrow();
  });

  it('rejects decryption when chunkIndex (AAD) is wrong', async () => {
    const { sessionKey, sessionId } = await makeSessionKey();
    const plaintext = new TextEncoder().encode('tamper test chunk');

    const encrypted = await encryptChunk({
      sessionKey,
      sessionId,
      fileId: 'file-chunk',
      chunkIndex: 3,
      plaintext,
    });

    await expect(
      decryptChunk({
        sessionKey,
        sessionId,
        fileId: 'file-chunk',
        chunk: { ...encrypted, chunkIndex: 4 },
      }),
    ).rejects.toThrow();
  });

  it('produces different ciphertexts for the same plaintext (random nonce)', async () => {
    const { sessionKey, sessionId } = await makeSessionKey();
    const plaintext = new TextEncoder().encode('nonce test');

    const enc1 = await encryptChunk({ sessionKey, sessionId, fileId: 'f', chunkIndex: 0, plaintext });
    const enc2 = await encryptChunk({ sessionKey, sessionId, fileId: 'f', chunkIndex: 0, plaintext });

    expect(enc1.nonce).not.toBe(enc2.nonce);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });
});
