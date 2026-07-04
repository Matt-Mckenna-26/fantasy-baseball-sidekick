import { z } from 'zod';

/**
 * Shared DTOs and runtime schemas for every boundary between the web app and the API.
 * Both apps import from here so compile-time types and runtime validation stay in sync.
 * A change here is a contract change (see typed-contracts rule).
 */

/** A single fantasy league the signed-in user belongs to (read-only summary). */
export const leagueSummarySchema = z.object({
  leagueId: z.string(),
  name: z.string(),
  season: z.string(),
  /** The user's team name in this league, when available. */
  teamName: z.string().optional(),
});
export type LeagueSummary = z.infer<typeof leagueSummarySchema>;

/** Response for GET /api/me/leagues - the user's MLB leagues from Yahoo. */
export const meLeaguesResponseSchema = z.object({
  userGuid: z.string().optional(),
  leagues: z.array(leagueSummarySchema),
});
export type MeLeaguesResponse = z.infer<typeof meLeaguesResponseSchema>;

/** Response for GET /auth/status - whether the current session has a connected Yahoo account. */
export const authStatusSchema = z.object({
  authenticated: z.boolean(),
});
export type AuthStatus = z.infer<typeof authStatusSchema>;

/** Uniform error envelope returned by the API for non-2xx responses. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
