import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTokenStore } from './devStore.js';
import type { YahooTokens } from './tokenStore.js';

const tempFiles: string[] = [];
function tempFile(): string {
  const file = join(tmpdir(), `fcm-tokens-${randomBytes(6).toString('hex')}.json`);
  tempFiles.push(file);
  return file;
}

afterEach(() => {
  for (const file of tempFiles.splice(0)) rmSync(file, { force: true });
});

const tokens: YahooTokens = { accessToken: 'access-abc', refreshToken: 'refresh-xyz', expiresAt: 1_700_000_000_000 };

describe('FileTokenStore', () => {
  it('saves and retrieves tokens (including expiresAt)', async () => {
    const store = new FileTokenStore(randomBytes(32), tempFile());
    await store.save('s1', tokens);
    expect(await store.get('s1')).toEqual(tokens);
  });

  it('persists tokens encrypted at rest (no plaintext on disk)', async () => {
    const file = tempFile();
    const store = new FileTokenStore(randomBytes(32), file);
    await store.save('s1', tokens);
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('access-abc');
    expect(raw).not.toContain('refresh-xyz');
  });

  it('survives a fresh instance (reload from disk with the same key)', async () => {
    const file = tempFile();
    const key = randomBytes(32);
    await new FileTokenStore(key, file).save('s1', tokens);
    const reopened = new FileTokenStore(key, file);
    expect(await reopened.get('s1')).toEqual(tokens);
  });

  it('drops entries that cannot be decrypted with the configured key', async () => {
    const file = tempFile();
    await new FileTokenStore(randomBytes(32), file).save('s1', tokens);
    // A different key can't read the prior payload; that session is dropped, not fatal.
    const reopened = new FileTokenStore(randomBytes(32), file);
    expect(await reopened.get('s1')).toBeUndefined();
  });

  it('clears tokens for a session', async () => {
    const file = tempFile();
    const store = new FileTokenStore(randomBytes(32), file);
    await store.save('s1', tokens);
    await store.clear('s1');
    expect(await store.get('s1')).toBeUndefined();
    expect(existsSync(file)).toBe(true);
  });
});
