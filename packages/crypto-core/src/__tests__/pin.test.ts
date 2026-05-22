import { describe, expect, it } from 'vitest';
import { compareSasConstantTime, derivePinCode } from '../index.js';

function makeSecret(seed: number): Uint8Array {
  const buf = new Uint8Array(32);
  for (let i = 0; i < 32; i++) buf[i] = (seed + i) & 0xff;
  return buf;
}

describe('derivePinCode', () => {
  it('returns exactly 6 digits for typical inputs', async () => {
    const pin = await derivePinCode(makeSecret(1), 'session-abc');
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('is zero-padded to 6 digits', async () => {
    // Run many combinations to try to hit a small value — at minimum always length 6
    for (let seed = 0; seed < 20; seed++) {
      const pin = await derivePinCode(makeSecret(seed), `session-${seed}`);
      expect(pin.length).toBe(6);
    }
  });

  it('is deterministic: same inputs → same PIN', async () => {
    const secret = makeSecret(42);
    const sessionId = 'session-determinism-test';
    const pin1 = await derivePinCode(secret, sessionId);
    const pin2 = await derivePinCode(secret, sessionId);
    expect(pin1).toBe(pin2);
  });

  it('produces different PINs for different sessionIds', async () => {
    const secret = makeSecret(7);
    const pin1 = await derivePinCode(secret, 'session-alpha');
    const pin2 = await derivePinCode(secret, 'session-beta');
    expect(pin1).not.toBe(pin2);
  });

  it('produces different PINs for different secrets', async () => {
    const sessionId = 'session-same';
    const pin1 = await derivePinCode(makeSecret(10), sessionId);
    const pin2 = await derivePinCode(makeSecret(11), sessionId);
    expect(pin1).not.toBe(pin2);
  });

  it('accepts ArrayBuffer as input', async () => {
    const u8 = makeSecret(5);
    const buf: ArrayBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    const pin = await derivePinCode(buf, 'session-arraybuffer');
    expect(pin).toMatch(/^\d{6}$/);
  });

  it('ArrayBuffer and Uint8Array with same bytes produce same PIN', async () => {
    const u8 = makeSecret(99);
    // Use slice on the typed array to guarantee a plain ArrayBuffer copy
    const ab: ArrayBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
    const pinFromU8 = await derivePinCode(u8, 'session-parity');
    const pinFromAb = await derivePinCode(ab, 'session-parity');
    expect(pinFromU8).toBe(pinFromAb);
  });
});

describe('compareSasConstantTime', () => {
  it('returns true for identical strings', () => {
    expect(compareSasConstantTime('123456', '123456')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(compareSasConstantTime('123456', '654321')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(compareSasConstantTime('12345', '123456')).toBe(false);
    expect(compareSasConstantTime('1234567', '123456')).toBe(false);
  });

  it('returns false when one character differs', () => {
    expect(compareSasConstantTime('123456', '123457')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(compareSasConstantTime('', '')).toBe(true);
  });
});
