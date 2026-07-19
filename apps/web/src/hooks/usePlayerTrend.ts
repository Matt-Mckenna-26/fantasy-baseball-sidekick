import { useEffect, useState } from 'react';
import { fetchPlayerTrendWindows, type PlayerStatsByRange } from '../lib/playerTrend';

/** Optional external cache (per-league trend windows) so repeat opens reuse fetched data. */
interface TrendWindowCache {
  get: (leagueId: string) => PlayerStatsByRange;
  set: (leagueId: string, windows: PlayerStatsByRange) => void;
}

/**
 * Fetch the league's trend windows (season + Last 30/21/14/7 as available) once per league,
 * caching them via `cache` so opening cards / switching players in the same league is cheap.
 * Windows land progressively (each surfaced as it arrives) so callers can render the trend
 * without waiting on the slowest window. Series derivation is left to the caller, since the
 * player-focus card plots every metric as its own series (see buildPlayerMetricTrend).
 */
export function usePlayerTrend(params: {
  leagueId: string | undefined;
  supportsLast14: boolean;
  enabled: boolean;
  cache?: TrendWindowCache;
}): { status: 'idle' | 'loading' | 'ready' | 'error'; windows: PlayerStatsByRange } {
  const { leagueId, supportsLast14, enabled, cache } = params;
  const [windows, setWindows] = useState<PlayerStatsByRange>(() =>
    leagueId && cache ? cache.get(leagueId) : {},
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!enabled || !leagueId) return;
    let stale = false;
    const existing = cache ? cache.get(leagueId) : {};
    if (Object.keys(existing).length > 0) {
      setWindows(existing);
      setStatus('ready');
    } else {
      setStatus('loading');
    }
    fetchPlayerTrendWindows(leagueId, existing, supportsLast14, (partial) => {
      if (stale) return;
      cache?.set(leagueId, partial);
      setWindows(partial);
    })
      .then((w) => {
        if (stale) return;
        cache?.set(leagueId, w);
        setWindows(w);
        setStatus('ready');
      })
      .catch(() => {
        if (!stale) setStatus('error');
      });
    return () => {
      stale = true;
    };
  }, [leagueId, enabled, supportsLast14, cache]);

  return { status, windows };
}
