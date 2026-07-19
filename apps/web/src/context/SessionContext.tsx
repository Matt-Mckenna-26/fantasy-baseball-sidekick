import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LeagueSummary } from '@fcm/contracts';
import { getAuthStatus, getMyLeagues, isUnauthorizedError, logout as apiLogout } from '../api/client';
import { getSelectedLeagueId, setSelectedLeagueId } from '../lib/selectedLeague';
import { onUnauthorized } from '../lib/unauthorized';
import { clearStatsCache } from '../lib/statsCache';

export type SessionState =
  | { status: 'loading' }
  | { status: 'disconnected'; sessionExpired?: boolean }
  | {
      status: 'connected';
      userGuid?: string;
      leagues: LeagueSummary[];
      selectedLeague: LeagueSummary | null;
      /** Server can serve the MLB-only Last 14 stat window (STATS_SOURCE=mlb). */
      supportsLast14: boolean;
    };

type SessionContextValue = {
  session: SessionState;
  selectLeague: (leagueId: string) => void;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function resolveSelectedLeague(leagues: LeagueSummary[]): LeagueSummary | null {
  const allowed = leagues.filter((l) => l.allowed);
  const stored = getSelectedLeagueId();
  return allowed.find((l) => l.leagueId === stored) ?? allowed[0] ?? null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  const markSessionExpired = useCallback(() => {
    setSession({ status: 'disconnected', sessionExpired: true });
    clearStatsCache();
    void apiLogout().catch(() => {
      // Session is already invalid server-side; clearing locally is enough.
    });
  }, []);

  useEffect(() => {
    onUnauthorized(markSessionExpired);
    return () => onUnauthorized(null);
  }, [markSessionExpired]);

  const refresh = useCallback(async () => {
    setSession({ status: 'loading' });
    try {
      const auth = await getAuthStatus();
      if (!auth.authenticated) {
        setSession({ status: 'disconnected' });
        return;
      }
      try {
        const data = await getMyLeagues();
        const selectedLeague = resolveSelectedLeague(data.leagues);
        if (selectedLeague) {
          setSelectedLeagueId(selectedLeague.leagueId);
        }
        setSession({
          status: 'connected',
          userGuid: data.userGuid,
          leagues: data.leagues,
          selectedLeague,
          supportsLast14: data.supportsLast14 ?? false,
        });
      } catch (err) {
        if (isUnauthorizedError(err)) {
          markSessionExpired();
        } else {
          setSession({
            status: 'connected',
            leagues: [],
            selectedLeague: null,
            supportsLast14: false,
          });
        }
      }
    } catch {
      setSession({ status: 'disconnected' });
    }
  }, [markSessionExpired]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectLeague = useCallback((leagueId: string) => {
    setSelectedLeagueId(leagueId);
    setSession((prev) => {
      if (prev.status !== 'connected') return prev;
      const selectedLeague = prev.leagues.find((l) => l.leagueId === leagueId) ?? null;
      return { ...prev, selectedLeague };
    });
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    clearStatsCache();
    setSession({ status: 'disconnected' });
  }, []);

  const value = useMemo(
    () => ({ session, selectLeague, logout }),
    [session, selectLeague, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return ctx;
}
