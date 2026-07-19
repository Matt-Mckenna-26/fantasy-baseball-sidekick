import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption for Yahoo tokens at rest. Uses AES-256-GCM: a random 96-bit
 * IV per message plus the GCM auth tag, which detects tampering (decrypt throws if
 * the ciphertext, IV, or tag was altered). The key is provided by the caller from
 * config (TOKEN_ENC_KEY); it is never derived from or written next to the data.
 *
 * Payload wire format: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`. The `v1` prefix
 * lets us rotate the scheme later without ambiguity.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const VERSION = 'v1';

/**
 * Decode and validate the base64 encryption key. Fails loudly (without echoing the
 * key) so a misconfigured secret is caught at startup rather than corrupting data.
 */
export function parseEncryptionKey(keyBase64: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(keyBase64, 'base64');
  } catch {
    throw new Error('TOKEN_ENC_KEY is not valid base64.');
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}).`);
  }
  return key;
}

/** Encrypt a UTF-8 string, returning the versioned `v1:iv:tag:ct` payload. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

/** Decrypt a `v1:iv:tag:ct` payload back to its UTF-8 string; throws on tamper/wrong key. */
export function decrypt(payload: string, key: Buffer): string {
  const parts = payload.split(':');
  const [version, ivB64, tagB64, ctB64] = parts;
  if (parts.length !== 4 || version !== VERSION || !ivB64 || !tagB64 || !ctB64) {
    throw new Error('Unrecognized encrypted token payload.');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
