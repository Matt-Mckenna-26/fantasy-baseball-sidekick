import { describe, it, expect } from 'vitest';
import { TtlCache } from './cache.js';

describe('TtlCache', () => {
  it('returns cached values within the TTL and expires after', () => {
    let now = 1000;
    const cache = new TtlCache(() => now);
    cache.set('k', 42, 100);
    expect(cache.get<number>('k')).toBe(42);
    now = 1050;
    expect(cache.get<number>('k')).toBe(42);
    now = 1101;
    expect(cache.get<number>('k')).toBeUndefined();
  });

  it('wrap computes once and serves the cached result', async () => {
    const cache = new TtlCache(() => 0);
    let calls = 0;
    const compute = async () => {
      calls += 1;
      return 'value';
    };
    expect(await cache.wrap('k', 1000, compute)).toBe('value');
    expect(await cache.wrap('k', 1000, compute)).toBe('value');
    expect(calls).toBe(1);
  });
});
