import { useEffect, useState } from 'react';
import type { LeagueSummary } from '@fcm/contracts';
import { isUnauthorizedError } from '../api/client';
import { useSession } from '../context/SessionContext';

/**
 * Shared loader for authed, league-scoped data (Rosters, Stats). Enforces the
 * auth boundary in the UI: it checks the Yahoo session, resolves the league the
 * user chose at sign-in (falling back to their first closed-beta league), then
 * fetches the resource. The data source (live vs mock) and the closed-beta
 * allowlist are both decided server-side, so this hook behaves the same in every
 * mode - the `allowed` flag it reads is authoritative.
 */
export type LeagueResourceState<T> =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | { status: 'empty' }
  | { status: 'not_allowed' }
  | { status: 'error' }
  | { status: 'ready'; data: T; league: LeagueSummary };

export function useFirstLeagueResource<T>(
  load: (leagueId: string) => Promise<T>,
): LeagueResourceState<T> {
  const { session } = useSession();
  const selectedLeagueId =
    session.status === 'connected' ? (session.selectedLeague?.leagueId ?? null) : null;
  const [state, setState] = useState<LeagueResourceState<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (session.status === 'loading') {
        if (!cancelled) setState({ status: 'loading' });
        return;
      }
      if (session.status === 'disconnected') {
        if (!cancelled) setState({ status: 'disconnected' });
        return;
      }

      const { leagues, selectedLeague } = session;
      if (leagues.length === 0) {
        if (!cancelled) setState({ status: 'empty' });
        return;
      }
      if (!selectedLeague) {
        if (!cancelled) setState({ status: 'not_allowed' });
        return;
      }

      if (!cancelled) setState({ status: 'loading' });
      try {
        const data = await load(selectedLeague.leagueId);
        if (!cancelled) setState({ status: 'ready', data, league: selectedLeague });
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorizedError(err)) {
          setState({ status: 'disconnected' });
        } else {
          setState({ status: 'error' });
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [load, session, selectedLeagueId]);

  return state;
}
