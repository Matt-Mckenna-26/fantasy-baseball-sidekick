import { Router, type Request, type Response } from 'express';
import { statRangeSchema, teamStatBucketSchema } from '@fcm/contracts';
import type { AppConfig } from '../config.js';
import type { FantasyProvider } from '../fantasyProvider.js';
import type { TokenStore, YahooTokens } from '../tokenStore.js';
import { ensureFreshTokens } from '../tokenRefresh.js';
import { asyncHandler, sendError } from '../http.js';
import { isLeagueAllowed } from '../closedBeta.js';
import { buildLeagueAdvancedStats } from '../leagueAdvancedStats.js';
import { withSgptRank } from '../sgptRank.js';
import { getScoredFreeAgents } from '../freeAgentValue.js';
import { TtlCache, TTL } from '../ai/cache.js';

/** Authenticated, read-only endpoints scoped to the signed-in Yahoo user. */
export function createMeRouter(
  config: AppConfig,
  tokenStore: TokenStore,
  provider: FantasyProvider,
): Router {
  const router = Router();

  // Free agents scored with Value+ (against the rostered pool) are cached per league + query
  // so the extra rostered-stats fetch isn't repeated on every grid load. League-scoped data,
  // safe to share across sessions - mirrors buildLeagueAdvancedStats's cache.
  const freeAgentCache = new TtlCache();

  /**
   * Resolve the session's Yahoo tokens, proactively refreshing them if they are near
   * expiry (so the provider's parallel calls start with a valid token), or send a 401
   * and return undefined. A failed refresh propagates as an auth error to the handler.
   */
  async function requireTokens(req: Request, res: Response): Promise<YahooTokens | undefined> {
    const tokens = await ensureFreshTokens({ sessionId: req.sessionID, store: tokenStore, config });
    if (!tokens) {
      sendError(res, 401, 'unauthorized', 'Connect your Yahoo account first.');
      return undefined;
    }
    return tokens;
  }

  /** Read a required string route param, or send a 400 and return undefined. */
  function requireParam(req: Request, res: Response, name: string): string | undefined {
    const value = req.params[name];
    if (typeof value !== 'string' || value.length === 0) {
      sendError(res, 400, 'bad_request', `Missing route parameter: ${name}.`);
      return undefined;
    }
    return value;
  }

  // Resolve the leagueId route param and enforce the closed-beta allowlist. Sends a
  // 403 and returns undefined when the league is not admitted (deny-by-default).
  function requireAllowedLeague(req: Request, res: Response): string | undefined {
    const leagueId = requireParam(req, res, 'leagueId');
    if (!leagueId) return undefined;
    if (!isLeagueAllowed(leagueId)) {
      sendError(res, 403, 'league_not_allowed', 'This league is not in the closed beta group.');
      return undefined;
    }
    return leagueId;
  }

  // The e2e proof: an authenticated call returning the user's MLB leagues, each
  // annotated with whether it is admitted to the closed beta (allowlist policy).
  router.get(
    '/leagues',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagues = await provider.getMyLeagues(tokens, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      res.json({
        ...leagues,
        // Advertise the MLB-only Last 14 window so the UI can show/hide that control.
        supportsLast14: config.statsSource === 'mlb',
        leagues: leagues.leagues.map((league) => ({
          ...league,
          allowed: isLeagueAllowed(league.leagueId),
        })),
      });
    }),
  );

  // Rosters for every team in a league (auth required; data source depends on mode).
  router.get(
    '/leagues/:leagueId/rosters',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const rosters = await provider.getLeagueRosters(tokens, leagueId, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      res.json(rosters);
    }),
  );

  // Player stat table for a league over a window (?range=today|last7|last14|last21|
  // last30|season, default season; last14/last21 require STATS_SOURCE=mlb). Auth +
  // allowlist enforced.
  router.get(
    '/leagues/:leagueId/stats',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const parsedRange = statRangeSchema.safeParse(req.query.range ?? 'season');
      if (!parsedRange.success) {
        sendError(
          res,
          400,
          'bad_request',
          'range must be one of: today, last7, last14, last21, last30, season.',
        );
        return;
      }
      if (
        (parsedRange.data === 'last14' || parsedRange.data === 'last21') &&
        config.statsSource !== 'mlb'
      ) {
        sendError(
          res,
          400,
          'bad_request',
          `The ${parsedRange.data} window requires the MLB stats source.`,
        );
        return;
      }
      const stats = await provider.getPlayerStats(tokens, leagueId, parsedRange.data, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      // Attach Value+ scores (100 = league average, ranked across hitters + pitchers)
      // here so the UI grid and the AI co-manager share the exact same numbers.
      res.json(withSgptRank(stats));
    }),
  );

  // League-wide ADVANCED/expected ("luck") stats, shaped like /stats so the grid, compare
  // card, and player-focus tiles reuse the same percentile pipeline. Season-only (MLB exposes
  // expected splits per season); cached per league server-side. Auth + allowlist enforced.
  router.get(
    '/leagues/:leagueId/advanced-stats',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const stats = await buildLeagueAdvancedStats(provider, tokens, leagueId, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      res.json(stats);
    }),
  );

  // Unrostered (or waiver-available) players for a league over a window
  // (?range=today|last7|last14|last21|last30|season, default season; last14/last21
  // require STATS_SOURCE=mlb; ?position=SP; ?availability=FA|A; ?limit=25). Auth + allowlist.
  router.get(
    '/leagues/:leagueId/free-agents',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const parsedRange = statRangeSchema.safeParse(req.query.range ?? 'season');
      if (!parsedRange.success) {
        sendError(
          res,
          400,
          'bad_request',
          'range must be one of: today, last7, last14, last21, last30, season.',
        );
        return;
      }
      if (
        (parsedRange.data === 'last14' || parsedRange.data === 'last21') &&
        config.statsSource !== 'mlb'
      ) {
        sendError(
          res,
          400,
          'bad_request',
          `The ${parsedRange.data} window requires the MLB stats source.`,
        );
        return;
      }
      const availability = req.query.availability === 'A' ? 'A' : 'FA';
      const position = typeof req.query.position === 'string' ? req.query.position : undefined;
      const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
      const limit =
        Number.isFinite(limitRaw) && (limitRaw as number) > 0 ? (limitRaw as number) : undefined;
      // Value+ is scored against the rostered pool so the grid can compare pickups to the roster.
      const cacheKey = `${leagueId}:${parsedRange.data}:${availability}:${position ?? 'all'}:${limit ?? 'def'}`;
      const freeAgents = await freeAgentCache.wrap(cacheKey, TTL.freeAgents, () =>
        getScoredFreeAgents(
          provider,
          tokens,
          leagueId,
          {
            range: parsedRange.data,
            availability,
            ...(position ? { position } : {}),
            ...(limit ? { limit } : {}),
          },
          (refreshed) => tokenStore.save(req.sessionID, refreshed),
        ),
      );
      res.json(freeAgents);
    }),
  );

  // Every fantasy team's aggregated totals for a bucket (?week=<n>|season|last2weeks|
  // last3weeks|last4weeks, default season). Single buckets use Yahoo's native weekly
  // totals; windows are aggregated server-side. Auth + allowlist.
  router.get(
    '/leagues/:leagueId/team-stats',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const weekParam = req.query.week;
      // Numeric strings are fantasy weeks; everything else ('season'/window keys) is
      // validated as-is by the schema.
      const bucketCandidate =
        weekParam === undefined
          ? 'season'
          : typeof weekParam === 'string' && /^\d+$/.test(weekParam)
            ? Number(weekParam)
            : weekParam;
      const parsedBucket = teamStatBucketSchema.safeParse(bucketCandidate);
      if (!parsedBucket.success) {
        sendError(
          res,
          400,
          'bad_request',
          'week must be a positive integer, "season", or a window (last2weeks/last3weeks/last4weeks).',
        );
        return;
      }
      const stats = await provider.getLeagueTeamStats(
        tokens,
        leagueId,
        parsedBucket.data,
        (refreshed) => tokenStore.save(req.sessionID, refreshed),
      );
      res.json(stats);
    }),
  );

  // League standings: rank, W/L, win %, games back, roster moves. Auth + allowlist.
  router.get(
    '/leagues/:leagueId/standings',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const standings = await provider.getLeagueStandings(tokens, leagueId, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      res.json(standings);
    }),
  );

  // Recent league transactions (adds, drops/waivers, trades), newest first
  // (?count=<n>, default 25, clamped to 50). Auth + allowlist enforced.
  router.get(
    '/leagues/:leagueId/transactions',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const countRaw = typeof req.query.count === 'string' ? Number(req.query.count) : undefined;
      const count =
        Number.isFinite(countRaw) && (countRaw as number) > 0
          ? Math.min(Math.trunc(countRaw as number), 50)
          : 25;
      const transactions = await provider.getLeagueTransactions(
        tokens,
        leagueId,
        count,
        (refreshed) => tokenStore.save(req.sessionID, refreshed),
      );
      res.json(transactions);
    }),
  );

  // Head-to-head matchups for the league's current fantasy week (empty for roto
  // leagues with no scoreboard). Auth + allowlist enforced.
  router.get(
    '/leagues/:leagueId/matchups',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const matchups = await provider.getLeagueMatchups(tokens, leagueId, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      res.json(matchups);
    }),
  );

  // One team's players with their scoring-category values over a window
  // (?range=today|last7|last14|last21|last30|season, default season; last14/last21
  // require STATS_SOURCE=mlb). Auth + allowlist enforced.
  router.get(
    '/leagues/:leagueId/teams/:teamId/stats',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const teamId = requireParam(req, res, 'teamId');
      if (!teamId) return;
      const parsedRange = statRangeSchema.safeParse(req.query.range ?? 'season');
      if (!parsedRange.success) {
        sendError(
          res,
          400,
          'bad_request',
          'range must be one of: today, last7, last14, last21, last30, season.',
        );
        return;
      }
      if (
        (parsedRange.data === 'last14' || parsedRange.data === 'last21') &&
        config.statsSource !== 'mlb'
      ) {
        sendError(
          res,
          400,
          'bad_request',
          `The ${parsedRange.data} window requires the MLB stats source.`,
        );
        return;
      }
      const stats = await provider.getTeamRangeStats(
        tokens,
        leagueId,
        teamId,
        parsedRange.data,
        (refreshed) => tokenStore.save(req.sessionID, refreshed),
      );
      res.json(stats);
    }),
  );

  // One team's players with their scoring-category values for a single fantasy week
  // (?week=<n>), aligned to the head-to-head scoreboard. Auth + allowlist enforced.
  router.get(
    '/leagues/:leagueId/teams/:teamId/week-stats',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const teamId = requireParam(req, res, 'teamId');
      if (!teamId) return;
      const weekParam = req.query.week;
      if (typeof weekParam !== 'string' || !/^\d+$/.test(weekParam) || Number(weekParam) < 1) {
        sendError(res, 400, 'bad_request', 'week must be a positive integer.');
        return;
      }
      const stats = await provider.getTeamWeekStats(
        tokens,
        leagueId,
        teamId,
        Number(weekParam),
        (refreshed) => tokenStore.save(req.sessionID, refreshed),
      );
      res.json(stats);
    }),
  );

  return router;
}
