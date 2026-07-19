import {
  authStatusSchema,
  apiErrorSchema,
  chatStreamEventSchema,
  leagueFreeAgentsResponseSchema,
  leagueMatchupsResponseSchema,
  leagueRostersResponseSchema,
  leagueStandingsResponseSchema,
  leagueTeamStatsResponseSchema,
  leagueTransactionsResponseSchema,
  meLeaguesResponseSchema,
  mlbBoxScoreResponseSchema,
  mlbGamesResponseSchema,
  playerNewsResponseSchema,
  playerStatsResponseSchema,
  teamStatsResponseSchema,
  teamWeekStatsResponseSchema,
  type AuthStatus,
  type ChatRequest,
  type ChatResponse,
  type ChatToolEvent,
  type LeagueFreeAgentsResponse,
  type LeagueMatchupsResponse,
  type LeagueRostersResponse,
  type LeagueStandingsResponse,
  type LeagueTeamStatsResponse,
  type LeagueTransactionsResponse,
  type MeLeaguesResponse,
  type MlbBoxScoreResponse,
  type MlbGamesResponse,
  type PlayerNewsResponse,
  type PlayerStatsResponse,
  type StatRange,
  type TeamStatBucket,
  type TeamStatsResponse,
  type TeamWeekStatsResponse,
} from '@fcm/contracts';
import { beginLoad, endLoad } from '../lib/loadingStore';
import { notifyUnauthorized } from '../lib/unauthorized';
import { cachedStats } from '../lib/statsCache';

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
  return err instanceof ApiRequestError && (err.status === 401 || err.code === 'unauthorized');
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
      throw new ApiRequestError(res.status, `Request to ${url} failed with ${res.status}`, code);
    }
    return parse(await res.json());
  } finally {
    if (!opts?.silent) endLoad();
  }
}

export function getAuthStatus(): Promise<AuthStatus> {
  return getValidated('/auth/status', (d) => authStatusSchema.parse(d));
}

/** Live-progress callbacks for a streamed chat turn. */
export interface ChatStreamHandlers {
  /** Fired as each read-only tool starts and finishes, so the UI can show activity. */
  onToolEvent?: (event: ChatToolEvent) => void;
  /** Fired with each chunk of reply text, to render the answer as it streams. */
  onDelta?: (text: string) => void;
  /** Fired to discard streamed text so far (a preamble step turned into a tool call). */
  onReset?: () => void;
}

/**
 * Send a chat turn to the AI co-manager and consume its NDJSON stream. Runs silent (no
 * global loading overlay) because the Chat page shows its own in-bubble activity. Tool
 * events are surfaced live via `handlers.onToolEvent`; the promise resolves with the final
 * reply once the terminating `done` event arrives.
 */
export async function sendChatMessage(
  req: ChatRequest,
  handlers?: ChatStreamHandlers,
): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) {
    let code: string | undefined;
    try {
      const errBody: unknown = await res.json();
      const parsed = apiErrorSchema.safeParse(errBody);
      if (parsed.success) code = parsed.data.error.code;
    } catch {
      // Non-JSON error body — status alone is enough for callers.
    }
    if (res.status === 401 || code === 'unauthorized') {
      notifyUnauthorized();
    }
    throw new ApiRequestError(res.status, `Request to /api/chat failed with ${res.status}`, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: ChatResponse | undefined;

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = chatStreamEventSchema.parse(JSON.parse(trimmed));
    if (event.type === 'tool') {
      handlers?.onToolEvent?.(event);
    } else if (event.type === 'delta') {
      handlers?.onDelta?.(event.text);
    } else if (event.type === 'reset') {
      handlers?.onReset?.();
    } else if (event.type === 'error') {
      throw new ApiRequestError(500, event.message, event.code);
    } else {
      const { type: _type, ...response } = event;
      done = response;
    }
  };

  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      handleLine(line);
    }
  }
  // Flush any trailing line without a newline terminator.
  handleLine(buffer);

  if (!done) {
    throw new ApiRequestError(500, 'Chat stream ended without a final message.');
  }
  return done;
}

export function getMyLeagues(): Promise<MeLeaguesResponse> {
  return getValidated('/api/me/leagues', (d) => meLeaguesResponseSchema.parse(d));
}

export function getLeagueRosters(leagueId: string): Promise<LeagueRostersResponse> {
  return getValidated(`/api/me/leagues/${encodeURIComponent(leagueId)}/rosters`, (d) =>
    leagueRostersResponseSchema.parse(d),
  );
}

/**
 * League-wide player stats over a window (today/last7/last14/last21/last30/season, default
 * season). Windows other than the live 'today' view are cached per league + game-day in
 * localStorage (with concurrent-request de-duplication) since each is expensive server-side
 * and opening player-focus cards fans out into several at once - see lib/statsCache.
 */
export function getPlayerStats(
  leagueId: string,
  range: StatRange = 'season',
  opts?: { silent?: boolean },
): Promise<PlayerStatsResponse> {
  const fetcher = () =>
    getValidated(
      `/api/me/leagues/${encodeURIComponent(leagueId)}/stats?range=${encodeURIComponent(range)}`,
      (d) => playerStatsResponseSchema.parse(d),
      opts,
    );
  return range === 'today' ? fetcher() : cachedStats(`pstats:${leagueId}:${range}`, fetcher);
}

/**
 * League-wide ADVANCED/expected stats (xBA, xSLG, xwOBA, BABIP, K%/BB% or K/9 etc.), shaped
 * like getPlayerStats so the grid, compare card, and player-focus tiles reuse the same
 * percentile pipeline. Season-only; cached per league (localStorage) since it fans out into
 * several MLB Stats calls server-side. Silent by default (the grid shows its own overlay).
 */
export function getAdvancedLeagueStats(
  leagueId: string,
  opts?: { silent?: boolean },
): Promise<PlayerStatsResponse> {
  return cachedStats(`advstats:${leagueId}`, () =>
    getValidated(
      `/api/me/leagues/${encodeURIComponent(leagueId)}/advanced-stats`,
      (d) => playerStatsResponseSchema.parse(d),
      { silent: opts?.silent ?? true },
    ),
  );
}

/**
 * Unrostered players for a league over a window, split into batting and pitching (parity
 * with getPlayerStats). Every row's `owner` is absent - the "free agent" signal. Silent by
 * default so it can enrich the Players grid / chat cards without the overlay.
 *
 * Availability defaults to 'A' (available = free agents AND players on waivers) so the
 * Players view surfaces every pickup-able player; pass 'FA' to exclude waivers.
 */
export function getFreeAgents(
  leagueId: string,
  range: StatRange = 'season',
  opts?: { silent?: boolean; availability?: 'FA' | 'A' },
): Promise<LeagueFreeAgentsResponse> {
  const availability = opts?.availability ?? 'A';
  const fetcher = () =>
    getValidated(
      `/api/me/leagues/${encodeURIComponent(leagueId)}/free-agents` +
        `?range=${encodeURIComponent(range)}&availability=${availability}`,
      (d) => leagueFreeAgentsResponseSchema.parse(d),
      opts,
    );
  // Same cost/fan-out profile as getPlayerStats; cache every window except the live 'today'.
  return range === 'today'
    ? fetcher()
    : cachedStats(`fa:${leagueId}:${range}:${availability}`, fetcher);
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

/**
 * Recent league transactions (adds, drops/waivers, trades), newest first. Silent-capable
 * so the Standings page can load its activity log progressively without the overlay.
 */
export function getLeagueTransactions(
  leagueId: string,
  opts?: { silent?: boolean; count?: number },
): Promise<LeagueTransactionsResponse> {
  const query = opts?.count ? `?count=${encodeURIComponent(String(opts.count))}` : '';
  return getValidated(
    `/api/me/leagues/${encodeURIComponent(leagueId)}/transactions${query}`,
    (d) => leagueTransactionsResponseSchema.parse(d),
    opts,
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

/**
 * Public MLB box score for one game (batting + pitching lines). Silent by default so the
 * Scores page can poll live games without popping the global loading overlay.
 */
export function getMlbBoxScore(
  gamePk: number,
  opts?: { silent?: boolean },
): Promise<MlbBoxScoreResponse> {
  return getValidated(
    `/api/mlb/games/${encodeURIComponent(String(gamePk))}/boxscore`,
    (d) => mlbBoxScoreResponseSchema.parse(d),
    { silent: opts?.silent ?? true },
  );
}

/**
 * Merged public news for a player (ESPN articles + MLB Stats transactions), newest first.
 * Always silent: the player-focus modal shows its own inline loading state. Fails soft
 * server-side, so a resolved-but-empty list is normal (never breaks the modal).
 */
export function getPlayerNews(name: string, teamAbbr?: string): Promise<PlayerNewsResponse> {
  const params = new URLSearchParams({ name });
  if (teamAbbr) params.set('team', teamAbbr);
  return getValidated(
    `/api/mlb/players/news?${params.toString()}`,
    (d) => playerNewsResponseSchema.parse(d),
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
