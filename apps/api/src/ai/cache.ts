/**
 * Tiny in-memory TTL cache for tool snapshots. League-wide reads (standings, rosters,
 * team stats, free agents) are identical for every user of a league, so caching by
 * league + tool + args cuts repeat Yahoo/MLB calls, latency, and token cost within a
 * chat. Swappable for Redis later (see plan-of-record); intentionally process-local and
 * unbounded-but-expiring for this iteration.
 */
export class TtlCache {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get<T>(key: string): T | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** Read-through helper: return the cached value or compute, store, and return it. */
  async wrap<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    this.set(key, value, ttlMs);
    return value;
  }
}

/** Tiered TTLs (ms) by data volatility, mirroring the plan-of-record cache discipline. */
export const TTL = {
  standings: 15 * 60 * 1000,
  matchups: 5 * 60 * 1000,
  transactions: 5 * 60 * 1000,
  rosters: 15 * 60 * 1000,
  teamStats: 15 * 60 * 1000,
  playerStats: 15 * 60 * 1000,
  freeAgents: 30 * 60 * 1000,
  mlb: 60 * 60 * 1000,
  /** Expected/advanced season stats move slowly; an hour keeps repeat lookups cheap. */
  advanced: 60 * 60 * 1000,
  /** Bullpen roles shift week to week; refresh a few times a day. */
  bullpen: 6 * 60 * 60 * 1000,
} as const;
