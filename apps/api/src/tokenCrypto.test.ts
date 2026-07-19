import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, parseEncryptionKey } from './tokenCrypto.js';

const key = () => randomBytes(32);

describe('tokenCrypto', () => {
  it('round-trips a value through encrypt/decrypt', () => {
    const k = key();
    const plaintext = JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 123 });
    const payload = encrypt(plaintext, k);
    expect(payload).not.toContain('accessToken');
    expect(decrypt(payload, k)).toBe(plaintext);
  });

  it('produces a fresh IV each call (ciphertext differs for the same input)', () => {
    const k = key();
    expect(encrypt('same', k)).not.toBe(encrypt('same', k));
  });

  it('rejects a tampered payload (GCM auth tag)', () => {
    const k = key();
    const payload = encrypt('secret', k);
    const parts = payload.split(':');
    // Flip a byte in the ciphertext segment.
    const ct = Buffer.from(parts[3]!, 'base64');
    ct[0]! ^= 0x01;
    parts[3] = ct.toString('base64');
    expect(() => decrypt(parts.join(':'), k)).toThrow();
  });

  it('fails to decrypt with the wrong key', () => {
    const payload = encrypt('secret', key());
    expect(() => decrypt(payload, key())).toThrow();
  });

  it('rejects an unrecognized payload format', () => {
    expect(() => decrypt('not-a-valid-payload', key())).toThrow(/Unrecognized/);
  });

  it('parseEncryptionKey accepts a base64 32-byte key and rejects wrong sizes', () => {
    const good = randomBytes(32).toString('base64');
    expect(parseEncryptionKey(good)).toHaveLength(32);
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
