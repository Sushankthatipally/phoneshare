import { describe, expect, it } from 'vitest';
import {
  deriveSessionKey,
  generateKeyAgreement,
  importSessionKey,
} from '../index.js';

describe('deriveSessionKey', () => {
  it('produces the same rawKey for Alice and Bob sides of the same exchange', async () => {
    const alice = await generateKeyAgreement();
    const bob = await generateKeyAgreement();
    const sessionId = 'derive-test-session-001';

    // Alice derives using Bob's public key
    const aliceMaterial = await deriveSessionKey({
      keyAgreement: alice,
      remotePublicKey: bob.publicKey,
      sessionId,
    });

    // Bob derives using Alice's public key
    const bobMaterial = await deriveSessionKey({
      keyAgreement: bob,
      remotePublicKey: alice.publicKey,
      sessionId,
    });

    // Both sides must arrive at the same session key bytes
    expect(aliceMaterial.rawKey).toEqual(bobMaterial.rawKey);
  });

  it('produces different keys for different sessionIds', async () => {
    const alice = await generateKeyAgreement();
    const bob = await generateKeyAgreement();

    const mat1 = await deriveSessionKey({
      keyAgreement: alice,
      remotePublicKey: bob.publicKey,
      sessionId: 'session-x',
    });

    // Need a fresh key agreement because privateKey is not re-exportable after use
    const alice2 = await generateKeyAgreement();
    const bob2 = await generateKeyAgreement();

    const mat2 = await deriveSessionKey({
      keyAgreement: alice2,
      remotePublicKey: bob2.publicKey,
      sessionId: 'session-y',
    });

    // Different ephemeral keys + different sessionIds must yield different raw keys
    expect(mat1.rawKey).not.toEqual(mat2.rawKey);
  });

  it('returns a 32-byte rawKey (AES-256)', async () => {
    const alice = await generateKeyAgreement();
    const bob = await generateKeyAgreement();

    const material = await deriveSessionKey({
      keyAgreement: alice,
      remotePublicKey: bob.publicKey,
      sessionId: 'len-check',
    });

    expect(material.rawKey.length).toBe(32);
  });

  it('sets algorithm to x25519-hkdf-sha256/aes-256-gcm', async () => {
    const alice = await generateKeyAgreement();
    const bob = await generateKeyAgreement();

    const material = await deriveSessionKey({
      keyAgreement: alice,
      remotePublicKey: bob.publicKey,
      sessionId: 'algo-check',
    });

    expect(material.algorithm).toBe('x25519-hkdf-sha256/aes-256-gcm');
  });

  it('importSessionKey round-trips a rawKey back to a usable SessionKeyMaterial', async () => {
    const alice = await generateKeyAgreement();
    const bob = await generateKeyAgreement();
    const sessionId = 'import-test';

    const original = await deriveSessionKey({
      keyAgreement: alice,
      remotePublicKey: bob.publicKey,
      sessionId,
    });

    const imported = await importSessionKey({
      rawKey: original.rawKey,
      publicKey: original.publicKey,
      keyId: original.keyId,
    });

    expect(imported.rawKey).toEqual(original.rawKey);
    expect(imported.keyId).toBe(original.keyId);
    expect(imported.publicKey).toBe(original.publicKey);
    expect(imported.algorithm).toBe('x25519-hkdf-sha256/aes-256-gcm');
  });
});
