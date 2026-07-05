/**
 * Closed-beta access control (the private-league allowlist).
 *
 * This is the app's beta authorization gate: Yahoo OAuth proves *who* a user is,
 * but it does not authorize them - any Yahoo account can complete the login. Access
 * is deny-by-default and granted only for leagues on this list. Isolated here so the
 * policy has one obvious home and can grow (env-driven list, admin overrides) without
 * touching route or provider code.
 *
 * Matching is on the stable numeric Yahoo `league_id` (e.g. "101214"), NOT the
 * season-scoped `league_key` (e.g. "469.l.101214"), so admission survives the yearly
 * game rollover.
 */

/** Numeric Yahoo `league_id`s admitted to the closed beta. */
export const CLOSED_BETA_LEAGUE_IDS: ReadonlySet<string> = new Set([
  '101214', // "The Show"
]);

/**
 * Reduce a Yahoo `league_key` or bare `league_id` to its stable numeric `league_id`.
 * `"469.l.101214"` -> `"101214"`; `"101214"` -> `"101214"`.
 */
export function leagueIdFromKey(leagueKeyOrId: string): string {
  const parts = leagueKeyOrId.split('.');
  return parts[parts.length - 1] ?? leagueKeyOrId;
}

/** True if the given league key/id is admitted to the closed beta. */
export function isLeagueAllowed(leagueKeyOrId: string): boolean {
  return CLOSED_BETA_LEAGUE_IDS.has(leagueIdFromKey(leagueKeyOrId));
}
