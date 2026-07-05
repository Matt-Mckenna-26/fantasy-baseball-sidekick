import { Router, type Request, type Response } from 'express';
import { statRangeSchema, teamStatBucketSchema } from '@fcm/contracts';
import type { FantasyProvider } from '../fantasyProvider.js';
import type { TokenStore, YahooTokens } from '../tokenStore.js';
import { asyncHandler, sendError } from '../http.js';
import { isLeagueAllowed } from '../closedBeta.js';

/** Authenticated, read-only endpoints scoped to the signed-in Yahoo user. */
export function createMeRouter(tokenStore: TokenStore, provider: FantasyProvider): Router {
  const router = Router();

  /** Resolve the session's Yahoo tokens, or send a 401 and return undefined. */
  async function requireTokens(req: Request, res: Response): Promise<YahooTokens | undefined> {
    const tokens = await tokenStore.get(req.sessionID);
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

  // Player stat table for a league over a window (?range=today|last7|last30|season,
  // default season). Auth + allowlist enforced; data source depends on mode.
  router.get(
    '/leagues/:leagueId/stats',
    asyncHandler(async (req, res) => {
      const tokens = await requireTokens(req, res);
      if (!tokens) return;
      const leagueId = requireAllowedLeague(req, res);
      if (!leagueId) return;
      const parsedRange = statRangeSchema.safeParse(req.query.range ?? 'season');
      if (!parsedRange.success) {
        sendError(res, 400, 'bad_request', 'range must be one of: today, last7, last30, season.');
        return;
      }
      const stats = await provider.getPlayerStats(tokens, leagueId, parsedRange.data, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      res.json(stats);
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
  // (?range=today|last7|last30|season, default season). Auth + allowlist enforced.
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
        sendError(res, 400, 'bad_request', 'range must be one of: today, last7, last30, season.');
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
