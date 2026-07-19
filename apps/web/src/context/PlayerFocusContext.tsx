import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from './SessionContext';
import { useLeagueStatPool, type LeagueStatPool } from '../hooks/useLeagueStatPool';
import type { PlayerStatsByRange } from '../lib/playerTrend';

/** Max player cards that can be open at once (draggable, independently closable). */
export const MAX_PLAYER_CARDS = 5;

/**
 * The identity needed to open a player card. Every call site already has at least a
 * playerId + name; team/headshot/positionType are passed when available so the card
 * header and trend chart don't have to re-derive them.
 */
export interface PlayerFocusTarget {
  playerId: string;
  fullName: string;
  mlbTeamAbbr?: string;
  headshotUrl?: string;
  positionType?: 'B' | 'P';
}

interface PlayerFocusContextValue {
  /** Currently open cards, oldest first. Capped at MAX_PLAYER_CARDS. */
  targets: PlayerFocusTarget[];
  openPlayerFocus: (target: PlayerFocusTarget) => void;
  closePlayerFocus: (playerId: string) => void;
  /** Selected league id + Last-14 support, resolved from the session for all cards. */
  leagueId: string | undefined;
  supportsLast14: boolean;
  /** Shared season stat pool so every open card reuses one fetch (not one per card). */
  pool: LeagueStatPool;
  /** Per-league trend-window cache so opening cards / switching metrics is cheap. */
  getTrendWindows: (leagueId: string) => PlayerStatsByRange;
  setTrendWindows: (leagueId: string, windows: PlayerStatsByRange) => void;
}

const PlayerFocusContext = createContext<PlayerFocusContextValue | null>(null);

/**
 * Global provider for player-focus cards. Holds the open targets (up to five, each its own
 * draggable card) plus shared, league-scoped data: one season stat pool and a trend-window
 * cache, so N cards don't trigger N× the fetches. Mounted once, inside SessionProvider.
 */
export function PlayerFocusProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const leagueId = session.status === 'connected' ? session.selectedLeague?.leagueId : undefined;
  const supportsLast14 = session.status === 'connected' ? session.supportsLast14 : false;

  const [targets, setTargets] = useState<PlayerFocusTarget[]>([]);
  const trendCache = useRef<Map<string, PlayerStatsByRange>>(new Map());

  const pool = useLeagueStatPool(leagueId, 'season', targets.length > 0);

  const openPlayerFocus = useCallback((next: PlayerFocusTarget) => {
    setTargets((prev) => {
      const existing = prev.find((t) => t.playerId === next.playerId);
      // Reopening a player just merges any richer identity and moves it to the front (end).
      if (existing) {
        return [...prev.filter((t) => t.playerId !== next.playerId), { ...existing, ...next }];
      }
      const appended = [...prev, next];
      return appended.length > MAX_PLAYER_CARDS
        ? appended.slice(appended.length - MAX_PLAYER_CARDS)
        : appended;
    });
  }, []);

  const closePlayerFocus = useCallback((playerId: string) => {
    setTargets((prev) => prev.filter((t) => t.playerId !== playerId));
  }, []);

  const getTrendWindows = useCallback(
    (id: string): PlayerStatsByRange => trendCache.current.get(id) ?? {},
    [],
  );
  const setTrendWindows = useCallback((id: string, windows: PlayerStatsByRange) => {
    trendCache.current.set(id, windows);
  }, []);

  const value = useMemo(
    () => ({
      targets,
      openPlayerFocus,
      closePlayerFocus,
      leagueId,
      supportsLast14,
      pool,
      getTrendWindows,
      setTrendWindows,
    }),
    [targets, openPlayerFocus, closePlayerFocus, leagueId, supportsLast14, pool, getTrendWindows, setTrendWindows],
  );

  return <PlayerFocusContext.Provider value={value}>{children}</PlayerFocusContext.Provider>;
}

export function usePlayerFocus(): PlayerFocusContextValue {
  const ctx = useContext(PlayerFocusContext);
  if (!ctx) throw new Error('usePlayerFocus must be used within PlayerFocusProvider');
  return ctx;
}

/**
 * Non-throwing accessor for consumers (like clickable names) that may render outside the
 * provider - e.g. in isolated component tests. Returns null when no provider is mounted,
 * so those consumers can degrade to plain, non-interactive text instead of crashing.
 */
export function usePlayerFocusOptional(): PlayerFocusContextValue | null {
  return useContext(PlayerFocusContext);
}
