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
  /** The user's fantasy team logo in this league, when available. */
  logoUrl: z.string().url().optional(),
  /**
   * Whether this league is admitted to the closed beta. Resolved server-side by the
   * allowlist; the UI uses it to gate league selection. Absent = treat as not allowed.
   */
  allowed: z.boolean().optional(),
});
export type LeagueSummary = z.infer<typeof leagueSummarySchema>;

/** Response for GET /api/me/leagues - the user's MLB leagues from Yahoo. */
export const meLeaguesResponseSchema = z.object({
  userGuid: z.string().optional(),
  leagues: z.array(leagueSummarySchema),
  /**
   * Whether the server can serve the MLB-only 'last14' stat window (i.e. STATS_SOURCE=mlb).
   * The UI uses this to show or hide the Last 14 control. Absent means not supported.
   */
  supportsLast14: z.boolean().optional(),
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

/* -------------------------------------------------------------------------- */
/* Players & rosters                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A baseball player as our domain models them. This is intentionally our own
 * shape, not Yahoo's raw wire format - the provider mapper is responsible for
 * translating Yahoo -> Player, so the UI never depends on Yahoo specifics.
 */
export const playerSchema = z.object({
  playerId: z.string(),
  fullName: z.string(),
  /** MLB team abbreviation, e.g. "NYY". Absent for free agents without a team. */
  mlbTeamAbbr: z.string().optional(),
  /** Positions the player is eligible to fill, e.g. ["1B", "OF"]. */
  eligiblePositions: z.array(z.string()),
  /** Yahoo `display_position`, e.g. "SP", "2B,SS" - preferred short label for grids/filters. */
  displayPosition: z.string().optional(),
  /** Yahoo player type: batter or pitcher. Used to split IL/BN rows when slot position is ambiguous. */
  positionType: z.enum(['B', 'P']).optional(),
  /** Roster/injury status when relevant, e.g. "DTD", "IL10". */
  status: z.string().optional(),
  headshotUrl: z.string().url().optional(),
});
export type Player = z.infer<typeof playerSchema>;

/** One slot on a fantasy roster: the player plus the position they're started at. */
export const rosterSlotSchema = z.object({
  /** Started position or bench/IL designation, e.g. "1B", "SP", "BN", "IL". */
  selectedPosition: z.string(),
  player: playerSchema,
});
export type RosterSlot = z.infer<typeof rosterSlotSchema>;

const PITCHER_GAME_POSITIONS = new Set(['SP', 'RP', 'P']);

/** Bench/IL/NA designations — not real game positions; ignore when inferring batter vs pitcher. */
export function isRosterSlotPosition(pos: string): boolean {
  return pos === 'BN' || pos === 'NA' || pos === 'IL' || pos.startsWith('IL');
}

/** Eligible positions minus bench/IL slots (the positions a player actually plays). */
export function playerGameEligiblePositions(eligible: string[]): string[] {
  return eligible.filter((p) => !isRosterSlotPosition(p));
}

/**
 * Infer batter vs pitcher from Yahoo fields. Used when mapping roster players and when
 * splitting BN/IL rows in the roster UI (slot position alone is ambiguous there).
 */
export function inferPlayerPositionType(fields: {
  positionType?: 'B' | 'P';
  displayPosition?: string;
  eligiblePositions: string[];
}): 'B' | 'P' | undefined {
  if (fields.positionType === 'B' || fields.positionType === 'P') return fields.positionType;
  const display = fields.displayPosition;
  if (display && PITCHER_GAME_POSITIONS.has(display)) return 'P';
  if (display && display !== 'Util' && !PITCHER_GAME_POSITIONS.has(display)) return 'B';
  const gamePositions = playerGameEligiblePositions(fields.eligiblePositions);
  const pitches = gamePositions.some((p) => PITCHER_GAME_POSITIONS.has(p));
  const hits = gamePositions.some((p) => !PITCHER_GAME_POSITIONS.has(p) && p !== 'Util');
  if (pitches && !hits) return 'P';
  if (hits && !pitches) return 'B';
  return undefined;
}

/** Whether a roster slot belongs in the pitchers table (active SP/RP/P or BN/IL arms). */
export function isPitcherRosterSlot(slot: RosterSlot): boolean {
  if (PITCHER_GAME_POSITIONS.has(slot.selectedPosition)) return true;
  if (slot.player.positionType === 'P') return true;
  if (slot.player.positionType === 'B') return false;
  return inferPlayerPositionType({ eligiblePositions: slot.player.eligiblePositions }) === 'P';
}

/** A single fantasy team's roster within a league. */
export const teamRosterSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  managerName: z.string().optional(),
  logoUrl: z.string().url().optional(),
  /** Date the roster snapshot reflects (ISO date), when provided by the source. */
  coverageDate: z.string().optional(),
  slots: z.array(rosterSlotSchema),
});
export type TeamRoster = z.infer<typeof teamRosterSchema>;

/** Response for GET /api/leagues/:leagueId/rosters - every team's roster. */
export const leagueRostersResponseSchema = z.object({
  leagueId: z.string(),
  teams: z.array(teamRosterSchema),
});
export type LeagueRostersResponse = z.infer<typeof leagueRostersResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Stats                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A stat category column. Leagues define their own scoring categories, so stats
 * are modeled generically as columns + per-player values rather than a fixed set.
 */
export const statColumnSchema = z.object({
  /** Stable identifier, e.g. "AVG", "HR", "ERA". */
  key: z.string(),
  /** Short display label, e.g. "AVG". */
  label: z.string(),
  description: z.string().optional(),
  /**
   * Whether the column can be meaningfully summed across players (counting stats
   * like R, HR, W). Rate/composite stats (AVG, ERA, OPS) set this false so a totals
   * row can skip them. Absent means aggregatable.
   */
  aggregatable: z.boolean().optional(),
  /**
   * Explicit percentile/color direction: true when a higher value is better (HR, AVG),
   * false when lower is better (ERA, BB/9). Absent falls back to label-based heuristics.
   * Set by columns (like advanced/expected stats) whose direction can't be inferred
   * reliably from the label alone.
   */
  higherIsBetter: z.boolean().optional(),
});
export type StatColumn = z.infer<typeof statColumnSchema>;

/** A single stat value for a player, keyed to a StatColumn. */
export const statValueSchema = z.object({
  key: z.string(),
  value: z.union([z.number(), z.string()]),
});
export type StatValue = z.infer<typeof statValueSchema>;

/** A player's stat line: the player plus their values across the columns. */
export const playerStatLineSchema = z.object({
  player: playerSchema,
  stats: z.array(statValueSchema),
  /**
   * Season-long overall rank across the league's player pool (1 = best), as ordered
   * by Yahoo. Optional because a player outside the ranked window has no value.
   */
  overallRank: z.number().optional(),
  /**
   * Value+ index: the player's average percentile across the
   * league's scoring categories, indexed so 100 = league average (like OPS+/wRC+).
   * Server-computed over the rostered pool. Absent when the player has no scored
   * categories.
   */
  sgptPlus: z.number().optional(),
  /**
   * 1-based rank by Value+ across the entire rostered pool, spanning both hitters and
   * pitchers (percentiles are normalized, so the two are directly comparable). Absent
   * when the player has no Value+ value.
   */
  sgptRank: z.number().optional(),
  /** Fantasy team that rosters this player, for league-wide (all-teams) tables. */
  owner: z.string().optional(),
  /** Owning fantasy team's logo URL, when available. */
  ownerLogoUrl: z.string().url().optional(),
});
export type PlayerStatLine = z.infer<typeof playerStatLineSchema>;

/** A stat table for one player type: the scoring columns plus a row per player. */
export const statTableSchema = z.object({
  columns: z.array(statColumnSchema),
  players: z.array(playerStatLineSchema),
});
export type StatTable = z.infer<typeof statTableSchema>;

/**
 * Response for GET /api/leagues/:leagueId/stats. Batting and pitching are separate
 * tables because their scoring categories don't overlap; the UI shows one at a time.
 */
export const playerStatsResponseSchema = z.object({
  leagueId: z.string(),
  batting: statTableSchema,
  pitching: statTableSchema,
});
export type PlayerStatsResponse = z.infer<typeof playerStatsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Team roster stats over a time window                                       */
/* -------------------------------------------------------------------------- */

/**
 * The time window a roster stat table covers. Yahoo coverage types cover today ->
 * date, last7 -> lastweek, last30 -> lastmonth, season -> season. 'last14' and
 * 'last21' have no native Yahoo coverage type and are only served when the MLB stats
 * source is on (values derived from MLB game logs); with the Yahoo source they are
 * unavailable.
 */
export const statRangeSchema = z.enum(['today', 'last7', 'last14', 'last21', 'last30', 'season']);
export type StatRange = z.infer<typeof statRangeSchema>;

/**
 * Response for GET /api/me/leagues/:leagueId/free-agents - unrostered (or waiver-
 * available) players for a league over a window, split into batting and pitching
 * tables (parity with playerStatsResponse). Every row's `owner` is absent, which is
 * itself the "unrostered" signal. Powers both the Player Stats free-agent filter and
 * the AI co-manager's waiver/pickup tool.
 */
export const leagueFreeAgentsResponseSchema = z.object({
  leagueId: z.string(),
  range: statRangeSchema,
  batting: statTableSchema,
  pitching: statTableSchema,
});
export type LeagueFreeAgentsResponse = z.infer<typeof leagueFreeAgentsResponseSchema>;

/**
 * Response for GET /api/me/leagues/:leagueId/teams/:teamId/stats - one team's
 * players with their league scoring-category values over the requested window.
 * Batting and pitching columns are split so roster tables can show the right
 * categories per player type regardless of the selected time window.
 */
export const teamStatsResponseSchema = z.object({
  leagueId: z.string(),
  teamId: z.string(),
  range: statRangeSchema,
  battingColumns: z.array(statColumnSchema),
  pitchingColumns: z.array(statColumnSchema),
  players: z.array(playerStatLineSchema),
});
export type TeamStatsResponse = z.infer<typeof teamStatsResponseSchema>;

/**
 * Response for GET /api/me/leagues/:leagueId/teams/:teamId/week-stats - one team's
 * players with their league scoring-category values for a single fantasy week
 * (Yahoo `;type=week;week=N`). Mirrors TeamStatsResponse but keyed to a week number
 * instead of a rolling calendar window, so the Matchups view aligns player stats
 * with the head-to-head scoreboard week.
 */
export const teamWeekStatsResponseSchema = z.object({
  leagueId: z.string(),
  teamId: z.string(),
  week: z.number().int().positive(),
  battingColumns: z.array(statColumnSchema),
  pitchingColumns: z.array(statColumnSchema),
  players: z.array(playerStatLineSchema),
});
export type TeamWeekStatsResponse = z.infer<typeof teamWeekStatsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* League-wide team stats (aggregated team totals over a time window)         */
/* -------------------------------------------------------------------------- */

/**
 * One fantasy team's aggregated scoring-category values over a window, sourced
 * from Yahoo's own team-totals endpoint (so rate stats like AVG/ERA/WHIP are
 * computed by Yahoo, not summed client-side). `stats` carries the combined
 * batting + pitching category values keyed to the response's columns.
 */
export const teamStatLineSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  logoUrl: z.string().url().optional(),
  stats: z.array(statValueSchema),
});
export type TeamStatLine = z.infer<typeof teamStatLineSchema>;

/**
 * Multi-week helper windows for the Team Stats page ("Last N weeks" badges). The
 * server rolls up the trailing N fantasy weeks (counting stats summed, rate stats
 * averaged), so the client only picks the window.
 */
export const teamStatWindowSchema = z.enum(['last2weeks', 'last3weeks', 'last4weeks']);
export type TeamStatWindow = z.infer<typeof teamStatWindowSchema>;

/**
 * A team-stats coverage bucket: a fantasy week number, 'season' for full-season
 * totals, or a multi-week helper window. Single buckets use Yahoo's native weekly
 * totals (`;type=week`); windows are aggregated server-side across their weeks.
 */
export const teamStatBucketSchema = z.union([
  z.number().int().positive(),
  z.literal('season'),
  teamStatWindowSchema,
]);
export type TeamStatBucket = z.infer<typeof teamStatBucketSchema>;

/**
 * Response for GET /api/me/leagues/:leagueId/team-stats - every fantasy team's
 * aggregated totals for the selected `bucket`. `weeks` lists the selectable fantasy
 * week numbers (start_week..current_week; empty when the league has no weeks).
 * `aggregatedWeeks` is present only for a multi-week window and names the weeks that
 * were combined. Batting and pitching columns are split so the UI can show the right
 * categories per tab (parity with the player Stats page).
 */
export const leagueTeamStatsResponseSchema = z.object({
  leagueId: z.string(),
  bucket: teamStatBucketSchema,
  weeks: z.array(z.number().int().positive()),
  aggregatedWeeks: z.array(z.number().int().positive()).optional(),
  battingColumns: z.array(statColumnSchema),
  pitchingColumns: z.array(statColumnSchema),
  teams: z.array(teamStatLineSchema),
});
export type LeagueTeamStatsResponse = z.infer<typeof leagueTeamStatsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* League standings (rank, W/L, win%, games back, roster moves)               */
/* -------------------------------------------------------------------------- */

/**
 * One team's standing row. Every result field is optional because Yahoo omits
 * some fields pre-season and roto leagues carry a different shape than head-to-head.
 */
export const standingsRowSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  logoUrl: z.string().url().optional(),
  managerName: z.string().optional(),
  /** Overall league rank (1 = first). */
  rank: z.number().optional(),
  wins: z.number().optional(),
  losses: z.number().optional(),
  ties: z.number().optional(),
  /** Winning percentage as Yahoo formats it, e.g. ".639". */
  winPercentage: z.string().optional(),
  /** Games back from first place, e.g. "-" for the leader or "26.5". */
  gamesBack: z.string().optional(),
  /** Yahoo `number_of_moves` - roster add/drop count for the season. */
  moves: z.number().optional(),
});
export type StandingsRow = z.infer<typeof standingsRowSchema>;

/** Response for GET /api/me/leagues/:leagueId/standings - teams ordered by rank. */
export const leagueStandingsResponseSchema = z.object({
  leagueId: z.string(),
  teams: z.array(standingsRowSchema),
});
export type LeagueStandingsResponse = z.infer<typeof leagueStandingsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* League transactions (recent adds, drops/waivers, trades)                   */
/* -------------------------------------------------------------------------- */

/**
 * One player's role within a transaction: `movement` is how this player moved
 * (added to a team, dropped off one, or traded between two). The team names give
 * the human-readable log ("X added Player from waivers", "Y traded to Z").
 */
export const transactionPlayerSchema = z.object({
  playerId: z.string(),
  fullName: z.string(),
  mlbTeamAbbr: z.string().optional(),
  /** Yahoo `display_position`, e.g. "SP", "2B,SS". */
  displayPosition: z.string().optional(),
  positionType: z.enum(['B', 'P']).optional(),
  /** How this player moved in the transaction. */
  movement: z.enum(['add', 'drop', 'trade']),
  /** Team the player left (drops/trades), when Yahoo provides it. */
  sourceTeamName: z.string().optional(),
  /** Team the player joined (adds/trades), when Yahoo provides it. */
  destinationTeamName: z.string().optional(),
});
export type TransactionPlayer = z.infer<typeof transactionPlayerSchema>;

/**
 * A completed league transaction. `type` follows Yahoo's transaction type
 * (`add/drop` is a combined pickup+release in one move). `timestamp` is Unix
 * seconds; commissioner-only moves are filtered out server-side.
 */
export const leagueTransactionSchema = z.object({
  transactionId: z.string(),
  type: z.enum(['add', 'drop', 'add/drop', 'trade']),
  status: z.string(),
  /** When the transaction was processed (Unix seconds). */
  timestamp: z.number(),
  players: z.array(transactionPlayerSchema),
});
export type LeagueTransaction = z.infer<typeof leagueTransactionSchema>;

/**
 * Response for GET /api/me/leagues/:leagueId/transactions - the most recent
 * roster moves (adds, drops/waivers, trades), newest first. Powers the Standings
 * page activity log and the AI co-manager's recent-transactions tool.
 */
export const leagueTransactionsResponseSchema = z.object({
  leagueId: z.string(),
  transactions: z.array(leagueTransactionSchema),
});
export type LeagueTransactionsResponse = z.infer<typeof leagueTransactionsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Weekly matchups (head-to-head scoreboard for the current fantasy week)     */
/* -------------------------------------------------------------------------- */

/**
 * One side of a head-to-head matchup with the team's live category breakdown.
 * In a categories league the season record is the cumulative count of category
 * wins/losses/ties, so an in-progress week contributes all three to the standings.
 */
export const matchupTeamSchema = z.object({
  teamId: z.string(),
  teamName: z.string(),
  logoUrl: z.string().url().optional(),
  /** Categories won so far this week, from Yahoo `team_points.total`. */
  categoriesWon: z.number(),
  /** Categories lost so far this week (the opponent's category wins). */
  categoriesLost: z.number().optional(),
  /** Categories currently tied this week (counts for both teams). */
  categoriesTied: z.number().optional(),
});
export type MatchupTeam = z.infer<typeof matchupTeamSchema>;

/**
 * Yahoo's authoritative per-category result for a matchup: which team currently
 * leads a single scoring category (or a tie). `statKey` matches a StatColumn.key
 * (Yahoo stat_id), so the UI can highlight the winning cell in a per-category grid.
 */
export const matchupStatWinnerSchema = z.object({
  statKey: z.string(),
  /** The team leading this category, or absent when tied/undecided. */
  winnerTeamId: z.string().optional(),
  isTied: z.boolean().optional(),
});
export type MatchupStatWinner = z.infer<typeof matchupStatWinnerSchema>;

/**
 * A single head-to-head matchup for a fantasy week. `status` follows Yahoo's
 * lifecycle: preevent (not started), midevent (in progress), postevent (final).
 * `teams` holds the two sides; a rare bye/incomplete matchup may carry fewer.
 */
export const matchupSchema = z.object({
  week: z.number(),
  status: z.enum(['preevent', 'midevent', 'postevent']),
  isPlayoffs: z.boolean().optional(),
  isTied: z.boolean().optional(),
  /** Coverage bounds (ISO dates) when Yahoo provides them. */
  weekStart: z.string().optional(),
  weekEnd: z.string().optional(),
  teams: z.array(matchupTeamSchema),
  /** Per-category winners from Yahoo's scoreboard; absent when Yahoo omits them. */
  statWinners: z.array(matchupStatWinnerSchema).optional(),
});
export type Matchup = z.infer<typeof matchupSchema>;

/**
 * Response for GET /api/me/leagues/:leagueId/matchups - the head-to-head
 * scoreboard for the league's current fantasy week. Empty `matchups` when the
 * league has no weekly scoreboard (roto/offseason).
 */
export const leagueMatchupsResponseSchema = z.object({
  leagueId: z.string(),
  week: z.number(),
  matchups: z.array(matchupSchema),
});
export type LeagueMatchupsResponse = z.infer<typeof leagueMatchupsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Live MLB game state (ticker) - sourced from the public MLB Stats API, not   */
/* Yahoo. Used only to annotate rosters with "what's happening right now".     */
/* -------------------------------------------------------------------------- */

export const mlbGameStateSchema = z.object({
  /** MLB Stats API game id. */
  gamePk: z.number(),
  /** Coarse lifecycle: not started, in progress, or finished. */
  state: z.enum(['scheduled', 'live', 'final']),
  /** Human-readable detail, e.g. "In Progress", "Final", "Scheduled". */
  detail: z.string(),
  /** ISO 8601 scheduled first-pitch time. */
  startTime: z.string().optional(),
  /** MLB team abbreviations for the two sides, e.g. "NYY". */
  homeAbbr: z.string(),
  awayAbbr: z.string(),
  homeScore: z.number().optional(),
  awayScore: z.number().optional(),
  /** Current inning number when live. */
  inning: z.number().optional(),
  /** e.g. "Top", "Bottom", "Middle", "End" when live. */
  inningState: z.string().optional(),
  /**
   * Batting-order slot (1-9) keyed by `teamAbbr|normalizedName` (see `playerGameKey`).
   * Populated when lineups are posted; Yahoo ids differ from MLB ids so we match on name.
   */
  battingOrder: z.record(z.string(), z.number().int().min(1).max(9)).optional(),
  /** Probable starters keyed the same way as `battingOrder` (home + away). */
  probablePitchers: z.array(z.string()).optional(),
});
export type MlbGameState = z.infer<typeof mlbGameStateSchema>;

/** Canonicalize MLB/Yahoo team abbreviations for lineup-key matching. */
const TEAM_ABBR_ALIASES: Record<string, string> = {
  AZ: 'ARI',
  WSH: 'WAS',
  CHW: 'CWS',
  ATH: 'OAK',
  SDP: 'SD',
  SFG: 'SF',
  TBR: 'TB',
  KCR: 'KC',
  CHN: 'CHC',
};

export function normalizeTeamAbbr(abbr: string): string {
  const upper = abbr.toUpperCase();
  return TEAM_ABBR_ALIASES[upper] ?? upper;
}

/** Normalize a player name for cross-source lineup matching (accents, suffixes, punctuation). */
export function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[''`]/g, '')
    .replace(/\./g, '')
    .replace(/-/g, ' ')
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Stable lookup key for `battingOrder` / `probablePitchers` on a game DTO. */
export function playerGameKey(teamAbbr: string, fullName: string): string {
  return `${normalizeTeamAbbr(teamAbbr)}|${normalizePlayerName(fullName)}`;
}

/** Response for GET /api/mlb/games - every MLB game on a given date. */
export const mlbGamesResponseSchema = z.object({
  /** The date (YYYY-MM-DD) the games are for. */
  date: z.string(),
  games: z.array(mlbGameStateSchema),
});
export type MlbGamesResponse = z.infer<typeof mlbGamesResponseSchema>;

/* -------------------------------------------------------------------------- */
/* MLB box score (per game) - sourced from the public MLB Stats API. Powers    */
/* the Scores page's expandable box score. Fantasy ownership is joined on the   */
/* client by `playerGameKey(teamAbbr, fullName)`, so each row carries fullName. */
/* -------------------------------------------------------------------------- */

/** One batter's line in a box score. Season AVG is included for context. */
export const mlbBoxBatterSchema = z.object({
  fullName: z.string(),
  /** Fielding position abbreviation, e.g. "SS", "DH". */
  position: z.string().optional(),
  /** Lineup slot (1-9) when the player was a starter/in the order. */
  battingOrder: z.number().int().min(1).max(9).optional(),
  ab: z.number(),
  r: z.number(),
  h: z.number(),
  rbi: z.number(),
  hr: z.number(),
  bb: z.number(),
  so: z.number(),
  /** Season batting average as reported by MLB (e.g. ".272"). */
  avg: z.string().optional(),
});
export type MlbBoxBatter = z.infer<typeof mlbBoxBatterSchema>;

/** One pitcher's line in a box score. Season ERA is included for context. */
export const mlbBoxPitcherSchema = z.object({
  fullName: z.string(),
  /** Decision earned in this game: "W", "L", "SV", "HLD", or "BS". */
  decision: z.string().optional(),
  /** Innings pitched as reported by MLB (e.g. "5.1"). */
  ip: z.string(),
  h: z.number(),
  r: z.number(),
  er: z.number(),
  bb: z.number(),
  so: z.number(),
  hr: z.number(),
  /** Season ERA as reported by MLB (e.g. "5.06"). */
  era: z.string().optional(),
});
export type MlbBoxPitcher = z.infer<typeof mlbBoxPitcherSchema>;

/** One team's half of a box score: line-score totals plus batter/pitcher lines. */
export const mlbBoxSideSchema = z.object({
  /** Normalized team abbreviation, matching `playerGameKey`. */
  teamAbbr: z.string(),
  teamName: z.string(),
  runs: z.number(),
  hits: z.number(),
  errors: z.number(),
  batters: z.array(mlbBoxBatterSchema),
  pitchers: z.array(mlbBoxPitcherSchema),
});
export type MlbBoxSide = z.infer<typeof mlbBoxSideSchema>;

/**
 * Response for GET /api/mlb/games/:gamePk/boxscore - one game's full box score.
 * The game lifecycle state is intentionally omitted: the boxscore payload does not
 * carry it, and the client already has it from the games list it opened the card from.
 */
export const mlbBoxScoreResponseSchema = z.object({
  gamePk: z.number(),
  home: mlbBoxSideSchema,
  away: mlbBoxSideSchema,
});
export type MlbBoxScoreResponse = z.infer<typeof mlbBoxScoreResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Player news (public, keyless): ESPN articles + MLB Stats transactions       */
/* -------------------------------------------------------------------------- */

/**
 * One news item shown in the player-focus modal. `source` distinguishes ESPN
 * article-style news from MLB Stats API roster transactions (IL moves, trades,
 * call-ups) so the UI can tag them. Every field but the identity/headline is
 * optional because the two upstreams populate different subsets.
 */
export const playerNewsItemSchema = z.object({
  /** Stable per-source id (dedupe key within a response). */
  id: z.string(),
  source: z.enum(['espn', 'mlb']),
  /** Upstream category, e.g. ESPN article type or MLB transaction type ("Trade"). */
  type: z.string().optional(),
  headline: z.string(),
  description: z.string().optional(),
  /** ISO 8601 publish/transaction timestamp when the source provides one. */
  published: z.string().optional(),
  /** External link to the full article (ESPN only). */
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
});
export type PlayerNewsItem = z.infer<typeof playerNewsItemSchema>;

/**
 * Response for GET /api/mlb/players/news - merged, newest-first news for one
 * player from the public ESPN + MLB Stats APIs. `matched` is false when the
 * player id could not be resolved upstream; `items` is still a (possibly empty)
 * list so the modal always renders. Fails soft: upstream errors yield an empty
 * list, never a non-2xx.
 */
export const playerNewsResponseSchema = z.object({
  /** The player name the news was resolved for (echoed back). */
  player: z.string(),
  matched: z.boolean(),
  items: z.array(playerNewsItemSchema),
});
export type PlayerNewsResponse = z.infer<typeof playerNewsResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Advanced / expected stats ("luck" analysis, public MLB Stats API)          */
/* -------------------------------------------------------------------------- */

/**
 * One advanced-stat row: an actual value and, where the API exposes it, the
 * Statcast-expected counterpart (e.g. AVG vs xBA). Numbers are pre-parsed so the
 * UI can render deltas/bars; `format` says how to display them and
 * `higherIsBetter` colors the actual-vs-expected gap. `expected` is absent for
 * context-only metrics (BABIP, K%, ISO) that have no expected counterpart.
 */
export const advancedStatMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  actual: z.number().optional(),
  expected: z.number().optional(),
  format: z.enum(['rate3', 'rate2', 'pct']),
  higherIsBetter: z.boolean(),
});
export type AdvancedStatMetric = z.infer<typeof advancedStatMetricSchema>;

/**
 * A plain-language luck read derived from the actual-vs-expected gaps: whether the
 * player looks like a buy-low (results trailing the underlying quality) or a
 * sell-high / regression risk (results outrunning it).
 */
export const advancedStatLuckSchema = z.object({
  lean: z.enum(['buy', 'sell', 'neutral']),
  summary: z.string(),
});
export type AdvancedStatLuck = z.infer<typeof advancedStatLuckSchema>;

/**
 * Response for GET /api/mlb/players/advanced - expected + advanced season stats for
 * one player, keyed to whether they're a hitter or pitcher. `matched` is false when
 * the player id can't be resolved upstream; `metrics` is then empty (the modal still
 * renders). Fails soft: upstream errors yield matched:false, never a non-2xx.
 */
export const playerAdvancedResponseSchema = z.object({
  /** The player name the lookup was resolved for (echoed back). */
  query: z.string(),
  matched: z.boolean(),
  player: z.string().optional(),
  team: z.string().optional(),
  position: z.string().optional(),
  group: z.enum(['hitting', 'pitching']).optional(),
  season: z.number().optional(),
  metrics: z.array(advancedStatMetricSchema),
  luck: advancedStatLuckSchema.optional(),
});
export type PlayerAdvancedResponse = z.infer<typeof playerAdvancedResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Chat (AI co-manager)                                                       */
/* -------------------------------------------------------------------------- */

export const chatRoleSchema = z.enum(['user', 'assistant', 'system']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

/** A persisted chat message with identity and timestamp. */
export const chatMessageSchema = z.object({
  id: z.string(),
  role: chatRoleSchema,
  content: z.string(),
  /** ISO 8601 timestamp. */
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A single conversation turn sent to the API (no id/timestamp yet). */
export const chatTurnSchema = z.object({
  role: chatRoleSchema,
  content: z.string().min(1),
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

/** Request body for POST /api/chat. */
export const chatRequestSchema = z.object({
  /** Optional league context so the co-manager can ground its advice. */
  leagueId: z.string().optional(),
  /** The signed-in user's own team name in this league (so the bot knows "my team"). */
  teamName: z.string().optional(),
  /** The league's display name, for natural references in advice. */
  leagueName: z.string().optional(),
  messages: z.array(chatTurnSchema).min(1),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** Token accounting for one chat turn, when the model reports it. */
export const chatUsageSchema = z.object({
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
});
export type ChatUsage = z.infer<typeof chatUsageSchema>;

/**
 * A player the assistant substantively referenced in its reply. The server resolves the
 * names the model tagged against the (Yahoo) player data it fetched this turn, so `playerId`
 * matches the Players grid and the client can render the same rank cards. UI-only, optional.
 */
export const mentionedPlayerSchema = z.object({
  playerId: z.string(),
  fullName: z.string(),
  positionType: z.enum(['B', 'P']).optional(),
  mlbTeamAbbr: z.string().optional(),
  headshotUrl: z.string().url().optional(),
});
export type MentionedPlayer = z.infer<typeof mentionedPlayerSchema>;

/**
 * A web article the co-manager cited via the read-only `web_search` tool. The server
 * collects the (HTTPS-only) results the tool returned this turn and assigns each a stable
 * 1-based `index` that matches the `[[s:N]]` markers in the reply, so the client can render
 * ChatGPT-style clickable source badges (and inline numbered pills) that open the article in
 * a new tab. UI-only, optional.
 */
export const citedSourceSchema = z.object({
  index: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  domain: z.string(),
  publishedDate: z.string().optional(),
});
export type CitedSource = z.infer<typeof citedSourceSchema>;

/**
 * Response for POST /api/chat - the assistant's reply. `toolsUsed` and `usage` are
 * optional observability fields (which read-only tools the co-manager called and the
 * token spend for the turn); clients may surface or ignore them. `playersMentioned`
 * lists the players the reply featured so the UI can render rank cards for them, and
 * `sourcesCited` lists the web articles behind any `web_search`-grounded claims.
 */
export const chatResponseSchema = z.object({
  message: chatMessageSchema,
  toolsUsed: z.array(z.string()).optional(),
  usage: chatUsageSchema.optional(),
  playersMentioned: z.array(mentionedPlayerSchema).optional(),
  sourcesCited: z.array(citedSourceSchema).optional(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Chat streaming events (NDJSON over POST /api/chat)                          */
/* -------------------------------------------------------------------------- */

/**
 * A tool-activity event streamed as the co-manager works: one 'start' when a
 * read-only tool begins and one 'end' (with success) when it finishes.
 *
 * DATA HANDLING (reviewed): to power the expandable "what I did" cards, the tool's
 * `args` (the request the model made) and a truncated `result` (the tool's output) now
 * cross the wire. This is the SAME authenticated user's own league data they already see
 * in the reply - never another user's data and never tokens/secrets - but it does mean the
 * raw tool I/O reaches the client and is persisted in the browser's chat history.
 */
export const chatToolEventSchema = z.object({
  type: z.literal('tool'),
  name: z.string(),
  phase: z.enum(['start', 'end']),
  /** Present on 'end': whether the tool ran without error. */
  ok: z.boolean().optional(),
  /** Present on 'start': the raw JSON arguments the model passed to the tool. */
  args: z.string().optional(),
  /** Present on 'end': the tool's (truncated) JSON output, for the expandable detail. */
  result: z.string().optional(),
});
export type ChatToolEvent = z.infer<typeof chatToolEventSchema>;

/** Terminating event carrying the full reply (mirrors chatResponseSchema). */
export const chatDoneEventSchema = chatResponseSchema.extend({
  type: z.literal('done'),
});
export type ChatDoneEvent = z.infer<typeof chatDoneEventSchema>;

/**
 * A chunk of the assistant's reply text as it is generated, so the UI can render the
 * answer token-by-token instead of waiting for the whole turn. `text` is appended to the
 * in-progress bubble; the terminating `done` event still carries the authoritative full
 * reply (with player tags resolved), which replaces the streamed text.
 */
export const chatDeltaEventSchema = z.object({
  type: z.literal('delta'),
  text: z.string(),
});
export type ChatDeltaEvent = z.infer<typeof chatDeltaEventSchema>;

/**
 * Discard any streamed text buffered so far. Emitted when a completion that produced some
 * preamble text turns out to be a tool-calling step (that text was not the final answer),
 * so the UI clears the in-progress bubble before tool activity resumes.
 */
export const chatResetEventSchema = z.object({
  type: z.literal('reset'),
});
export type ChatResetEvent = z.infer<typeof chatResetEventSchema>;

/** Emitted if the turn fails after streaming has already begun. */
export const chatErrorEventSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
});
export type ChatErrorEvent = z.infer<typeof chatErrorEventSchema>;

/** Any line the chat stream can emit (one JSON object per NDJSON line). */
export const chatStreamEventSchema = z.discriminatedUnion('type', [
  chatToolEventSchema,
  chatDeltaEventSchema,
  chatResetEventSchema,
  chatDoneEventSchema,
  chatErrorEventSchema,
]);
export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;
