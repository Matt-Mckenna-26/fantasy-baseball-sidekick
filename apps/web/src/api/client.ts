import {
  authStatusSchema,
  apiErrorSchema,
  leagueMatchupsResponseSchema,
  leagueRostersResponseSchema,
  leagueStandingsResponseSchema,
  leagueTeamStatsResponseSchema,
  meLeaguesResponseSchema,
  mlbGamesResponseSchema,
  playerStatsResponseSchema,
  teamStatsResponseSchema,
  teamWeekStatsResponseSchema,
  type AuthStatus,
  type LeagueMatchupsResponse,
  type LeagueRostersResponse,
  type LeagueStandingsResponse,
  type LeagueTeamStatsResponse,
  type MeLeaguesResponse,
  type MlbGamesResponse,
  type PlayerStatsResponse,
  type StatRange,
  type TeamStatBucket,
  type TeamStatsResponse,
  type TeamWeekStatsResponse,
} from '@fcm/contracts';
import { beginLoad, endLoad } from '../lib/loadingStore';
import { notifyUnauthorized } from '../lib/unauthorized';

/** Error carrying the HTTP status so callers can special-case 401, etc. */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function isUnauthorizedError(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.status === 401 || err.code === 'unauthorized')
  );
}

async function getValidated<T>(
  url: string,
  parse: (data: unknown) => T,
  opts?: { silent?: boolean },
): Promise<T> {
  if (!opts?.silent) beginLoad();
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      let code: string | undefined;
      try {
        const body: unknown = await res.json();
        const parsed = apiErrorSchema.safeParse(body);
        if (parsed.success) code = parsed.data.error.code;
      } catch {
        // Non-JSON error body — status alone is enough for callers.
      }
      if (res.status === 401 || code === 'unauthorized') {
        notifyUnauthorized();
      }
      throw new ApiRequestError(
        res.status,
        `Request to ${url} failed with ${res.status}`,
        code,
      );
    }
    return parse(await res.json());
  } finally {
    if (!opts?.silent) endLoad();
  }
}

export function getAuthStatus(): Promise<AuthStatus> {
  return getValidated('/auth/status', (d) => authStatusSchema.parse(d));
}

export function getMyLeagues(): Promise<MeLeaguesResponse> {
  return getValidated('/api/me/leagues', (d) => meLeaguesResponseSchema.parse(d));
}

export function getLeagueRosters(leagueId: string): Promise<LeagueRostersResponse> {
  return getValidated(`/api/me/leagues/${encodeURIComponent(leagueId)}/rosters`, (d) =>
    leagueRostersResponseSchema.parse(d),
  );
}

/** League-wide player stats over a window (today/last7/last30/season, default season). */
export function getPlayerStats(
  leagueId: string,
  range: StatRange = 'season',
  opts?: { silent?: boolean },
): Promise<PlayerStatsResponse> {
  return getValidated(
    `/api/me/leagues/${encodeURIComponent(leagueId)}/stats?range=${encodeURIComponent(range)}`,
    (d) => playerStatsResponseSchema.parse(d),
    opts,
  );
}

/** League-wide team totals bucketed by fantasy week (or 'season', the default). */
export function getLeagueTeamStats(
  leagueId: string,
  bucket: TeamStatBucket = 'season',
  opts?: { silent?: boolean },
): Promise<LeagueTeamStatsResponse> {
  return getValidated(
    `/api/me/leagues/${encodeURIComponent(leagueId)}/team-stats?week=${encodeURIComponent(String(bucket))}`,
    (d) => leagueTeamStatsResponseSchema.parse(d),
    opts,
  );
}

/** League standings (rank, W/L, win %, games back, roster moves), ordered by rank. */
export function getLeagueStandings(leagueId: string): Promise<LeagueStandingsResponse> {
  return getValidated(`/api/me/leagues/${encodeURIComponent(leagueId)}/standings`, (d) =>
    leagueStandingsResponseSchema.parse(d),
  );
}

/** Head-to-head matchups for the league's current fantasy week (empty for roto leagues). */
export function getLeagueMatchups(leagueId: string): Promise<LeagueMatchupsResponse> {
  return getValidated(`/api/me/leagues/${encodeURIComponent(leagueId)}/matchups`, (d) =>
    leagueMatchupsResponseSchema.parse(d),
  );
}

/** One team's scoring-stat values over a window (today/last7/last30/season). */
export function getTeamRangeStats(
  leagueId: string,
  teamId: string,
  range: StatRange,
): Promise<TeamStatsResponse> {
  const url =
    `/api/me/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/stats` +
    `?range=${encodeURIComponent(range)}`;
  return getValidated(url, (d) => teamStatsResponseSchema.parse(d));
}

/** One team's player scoring-stat values for a single fantasy week (Matchups view). */
export function getTeamWeekStats(
  leagueId: string,
  teamId: string,
  week: number,
  opts?: { silent?: boolean },
): Promise<TeamWeekStatsResponse> {
  const url =
    `/api/me/leagues/${encodeURIComponent(leagueId)}/teams/${encodeURIComponent(teamId)}/week-stats` +
    `?week=${encodeURIComponent(String(week))}`;
  return getValidated(url, (d) => teamWeekStatsResponseSchema.parse(d), opts);
}

/**
 * Public MLB live-game state for a date (YYYY-MM-DD), used by the roster ticker.
 * Always silent: this polls every 30s in the background and must not pop the overlay.
 */
export function getMlbGames(date: string): Promise<MlbGamesResponse> {
  return getValidated(
    `/api/mlb/games?date=${encodeURIComponent(date)}`,
    (d) => mlbGamesResponseSchema.parse(d),
    { silent: true },
  );
}

export async function logout(): Promise<void> {
  const res = await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    throw new ApiRequestError(res.status, 'Logout failed');
  }
}

/** Full-page navigation to begin Yahoo OAuth (server issues the redirect). */
export const YAHOO_LOGIN_URL = '/auth/yahoo';
