import { describe, it, expect } from 'vitest';
import { InMemoryTokenStore } from './tokenStore.js';

describe('InMemoryTokenStore', () => {
  it('returns undefined for an unknown session', async () => {
    const store = new InMemoryTokenStore();
    expect(await store.get('missing')).toBeUndefined();
  });

  it('saves and retrieves tokens per session', async () => {
    const store = new InMemoryTokenStore();
    await store.save('s1', { accessToken: 'a', refreshToken: 'r' });
    await store.save('s2', { accessToken: 'a2', refreshToken: 'r2' });
    expect(await store.get('s1')).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(await store.get('s2')).toEqual({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('overwrites tokens on re-save (e.g. after refresh)', async () => {
    const store = new InMemoryTokenStore();
    await store.save('s1', { accessToken: 'a', refreshToken: 'r' });
    await store.save('s1', { accessToken: 'a-new', refreshToken: 'r-new' });
    expect(await store.get('s1')).toEqual({ accessToken: 'a-new', refreshToken: 'r-new' });
  });

  it('clears tokens for a session', async () => {
    const store = new InMemoryTokenStore();
    await store.save('s1', { accessToken: 'a', refreshToken: 'r' });
    await store.clear('s1');
    expect(await store.get('s1')).toBeUndefined();
  });
});
