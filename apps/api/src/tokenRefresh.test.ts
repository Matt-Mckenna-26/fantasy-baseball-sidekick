import { describe, it, expect, vi } from 'vitest';
import type { AppConfig } from './config.js';
import { InMemoryTokenStore, type YahooTokens } from './tokenStore.js';
import { ensureFreshTokens } from './tokenRefresh.js';
import { YahooUpstreamError } from './yahooClient.js';

// ensureFreshTokens only reads tokenRefreshSkewSeconds and passes config to the
// (injected, mocked) refresh function, so a minimal config is enough here.
const config = { tokenRefreshSkewSeconds: 300 } as AppConfig;

const future = (): number => Date.now() + 3_600_000;

describe('ensureFreshTokens', () => {
  it('returns undefined and never refreshes when the session has no tokens', async () => {
    const store = new InMemoryTokenStore();
    const refresh = vi.fn();
    expect(await ensureFreshTokens({ sessionId: 's', store, config, refresh })).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns stored tokens unchanged when comfortably before expiry', async () => {
    const store = new InMemoryTokenStore();
    const tokens: YahooTokens = { accessToken: 'a', refreshToken: 'r', expiresAt: future() };
    await store.save('s', tokens);
    const refresh = vi.fn();
    expect(await ensureFreshTokens({ sessionId: 's', store, config, refresh })).toEqual(tokens);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes and persists when within the skew window', async () => {
    const store = new InMemoryTokenStore();
    // 60s to expiry is inside the 300s skew, so a refresh is due.
    await store.save('s', { accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() + 60_000 });
    const fresh: YahooTokens = { accessToken: 'new', refreshToken: 'r2', expiresAt: future() };
    const refresh = vi.fn().mockResolvedValue(fresh);
    const result = await ensureFreshTokens({ sessionId: 's', store, config, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual(fresh);
    expect(await store.get('s')).toEqual(fresh);
  });

  it('refreshes when the stored expiry is unknown (legacy tokens)', async () => {
    const store = new InMemoryTokenStore();
    await store.save('s', { accessToken: 'old', refreshToken: 'r' });
    const fresh: YahooTokens = { accessToken: 'new', refreshToken: 'r2', expiresAt: future() };
    const refresh = vi.fn().mockResolvedValue(fresh);
    await ensureFreshTokens({ sessionId: 's', store, config, refresh });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent refreshes for one session (single-flight)', async () => {
    const store = new InMemoryTokenStore();
    await store.save('single', {
      accessToken: 'old',
      refreshToken: 'r',
      expiresAt: Date.now() + 60_000,
    });
    const fresh: YahooTokens = { accessToken: 'new', refreshToken: 'r2', expiresAt: future() };
    let release!: (tokens: YahooTokens) => void;
    const refresh = vi.fn(
      () =>
        new Promise<YahooTokens>((resolve) => {
          release = resolve;
        }),
    );

    const p1 = ensureFreshTokens({ sessionId: 'single', store, config, refresh });
    const p2 = ensureFreshTokens({ sessionId: 'single', store, config, refresh });
    // Let both calls reach the single-flight check before the refresh resolves.
    await Promise.resolve();
    release(fresh);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(fresh);
    expect(r2).toEqual(fresh);
  });

  it('clears tokens and throws an auth failure when the refresh fails', async () => {
    const store = new InMemoryTokenStore();
    await store.save('bad', {
      accessToken: 'old',
      refreshToken: 'dead',
      expiresAt: Date.now() + 60_000,
    });
    const refresh = vi.fn().mockRejectedValue(new Error('invalid_grant'));
    await expect(
      ensureFreshTokens({ sessionId: 'bad', store, config, refresh }),
    ).rejects.toBeInstanceOf(YahooUpstreamError);
    expect(await store.get('bad')).toBeUndefined();
  });
});
