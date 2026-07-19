/**
 * Client-side cache for the expensive league stat windows (player + free-agent tables).
 * Each window is ~12 Yahoo calls server-side, and opening player-focus cards fans out into
 * several window fetches at once, which trips Yahoo's rate limiter. Persisting the results
 * in localStorage - keyed by league + window + the current Eastern game-day - means repeat
 * opens and page reloads cost zero calls until the next day, and an in-flight promise map
 * collapses concurrent identical requests into a single network call.
 *
 * Data handling: this persists the user's own league/player data on their device (no tokens
 * or PII). It is cleared on logout / session expiry (see clearStatsCache).
 */

const PREFIX = 'fcm:statsCache:';
/**
 * Schema tag baked into every cache key. Bump it whenever the cached stat DTO shape changes
 * (e.g. adding Value+ fields) so clients drop windows cached under the old shape instead of
 * showing stale rows (a "-" column) until the next game-day.
 */
const SCHEMA_VERSION = 'v2';
/** Backstop expiry; the game-day key handles the normal daily refresh, this bounds a tab left open. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Full localStorage key: prefix + schema tag + caller key. */
function storageKey(cacheKey: string): string {
  return `${PREFIX}${SCHEMA_VERSION}:${cacheKey}`;
}

/** Current US-Eastern calendar date (YYYY-MM-DD): the MLB "game day" the stats belong to. */
function gameDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

interface Entry<T> {
  day: string;
  at: number;
  data: T;
}

/** Concurrent identical requests share one promise so a cold cache still makes a single call. */
const inFlight = new Map<string, Promise<unknown>>();

function read<T>(cacheKey: string): T | undefined {
  try {
    const raw = localStorage.getItem(storageKey(cacheKey));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Entry<T>;
    if (entry.day !== gameDay() || Date.now() - entry.at > TTL_MS) {
      localStorage.removeItem(storageKey(cacheKey));
      return undefined;
    }
    return entry.data;
  } catch {
    return undefined;
  }
}

function write<T>(cacheKey: string, data: T): void {
  try {
    localStorage.setItem(
      storageKey(cacheKey),
      JSON.stringify({ day: gameDay(), at: Date.now(), data } satisfies Entry<T>),
    );
  } catch {
    // Quota exceeded or serialization failure: caching is best-effort, so ignore.
  }
}

/**
 * Return `cacheKey`'s fresh cached value, or run `fetcher` once (de-duping concurrent callers)
 * and cache its result. Errors are never cached and reject every shared waiter.
 */
export function cachedStats<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = read<T>(cacheKey);
  if (hit !== undefined) return Promise.resolve(hit);
  const existing = inFlight.get(cacheKey) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fetcher()
    .then((data) => {
      write(cacheKey, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, promise);
  return promise;
}

/** Drop all cached stat windows (called on logout so data doesn't linger on shared machines). */
export function clearStatsCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    // Ignore storage access errors.
  }
}
