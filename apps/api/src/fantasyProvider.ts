import {
  inferPlayerPositionType,
  leagueMatchupsResponseSchema,
  leagueFreeAgentsResponseSchema,
  leagueRostersResponseSchema,
  leagueStandingsResponseSchema,
  leagueTeamStatsResponseSchema,
  leagueTransactionsResponseSchema,
  meLeaguesResponseSchema,
  playerStatsResponseSchema,
  teamStatsResponseSchema,
  teamWeekStatsResponseSchema,
  type LeagueFreeAgentsResponse,
  type LeagueMatchupsResponse,
  type LeagueRostersResponse,
  type LeagueStandingsResponse,
  type LeagueTeamStatsResponse,
  type LeagueTransaction,
  type LeagueTransactionsResponse,
  type Matchup,
  type MatchupStatWinner,
  type MatchupTeam,
  type MeLeaguesResponse,
  type Player,
  type PlayerStatLine,
  type PlayerStatsResponse,
  type StandingsRow,
  type StatColumn,
  type StatRange,
  type StatValue,
  type TeamRoster,
  type TeamStatBucket,
  type TeamStatLine,
  type TeamStatsResponse,
  type TeamWeekStatsResponse,
  type TransactionPlayer,
} from '@fcm/contracts';
import type {
  default as YahooFantasy,
  YahooMatchup,
  YahooPlayer,
  YahooScoreboard,
  YahooStatCategory,
  YahooStatWinner,
  YahooTeam,
  YahooTeamLogo,
  YahooUserGameLeaguesResult,
  YahooUserTeamsResult,
} from 'yahoo-fantasy';
import type { AppConfig } from './config.js';
import type { YahooTokens } from './tokenStore.js';
import { MockFantasyProvider } from './fantasyProvider.mock.js';
import { MlbStatsProvider } from './mlbStatsProvider.js';
import {
  TEAM_STAT_WINDOW_SIZE,
  aggregateWeeklyTeamStats,
  resolveWindowWeeks,
} from './teamStatsAggregate.js';
import { createYahooClient, type OnTokensRefreshed } from './yahooClient.js';

/**
 * Read-only access to a user's fantasy data. Keeps the app decoupled from Yahoo
 * specifics; both the live (Yahoo) and mock providers implement this interface,
 * so the rest of the app never changes when the data source is swapped.
 */
export interface FantasyProvider {
  getMyLeagues(
    tokens: YahooTokens,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<MeLeaguesResponse>;
  getLeagueRosters(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
    /** Optional YYYY-MM-DD; when set, each team's lineup is the snapshot for that game day. */
    date?: string,
  ): Promise<LeagueRostersResponse>;
  getPlayerStats(
    tokens: YahooTokens,
    leagueId: string,
    range: StatRange,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<PlayerStatsResponse>;
  getTeamRangeStats(
    tokens: YahooTokens,
    leagueId: string,
    teamId: string,
    range: StatRange,
    onTokensRefreshed?: OnTokensRefreshed,
    /** Optional YYYY-MM-DD; only applied when `range` is 'today' (that game day's line). */
    date?: string,
  ): Promise<TeamStatsResponse>;
  getTeamWeekStats(
    tokens: YahooTokens,
    leagueId: string,
    teamId: string,
    week: number,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<TeamWeekStatsResponse>;
  getLeagueTeamStats(
    tokens: YahooTokens,
    leagueId: string,
    bucket: TeamStatBucket,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueTeamStatsResponse>;
  getLeagueStandings(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueStandingsResponse>;
  getLeagueMatchups(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueMatchupsResponse>;
  getFreeAgents(
    tokens: YahooTokens,
    leagueId: string,
    query: FreeAgentsQuery,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueFreeAgentsResponse>;
  getLeagueTransactions(
    tokens: YahooTokens,
    leagueId: string,
    count: number,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueTransactionsResponse>;
}

/**
 * Filters for a free-agent lookup. Availability is Yahoo's own status filter, not a
 * client-side roster diff: 'FA' = unrostered free agents (default), 'A' = available
 * (free agents + waivers). `sortType` picks the window Yahoo ranks by so callers can
 * surface hot recent pickups; `limit` caps how many players are returned PER table
 * (batting AND pitching), each filled independently and bounded server-side.
 */
export interface FreeAgentsQuery {
  range: StatRange;
  availability?: 'FA' | 'A';
  position?: string;
  sortType?: 'season' | 'lastweek' | 'lastmonth';
  limit?: number;
}

/**
 * Yahoo caps the players collection at 25 rows per page, so a robust free-agent list is
 * paged. FREE_AGENT_LIMIT/MAX bound how many players we return PER table (batting AND
 * pitching); each table is filled independently so a pitcher-heavy free-agent pool never
 * starves the hitter table. Bounds keep Yahoo call count, latency, and token cost in check.
 */
const FREE_AGENT_PAGE = 25;
const FREE_AGENT_LIMIT = 50;
const FREE_AGENT_MAX = 100;

/**
 * Select the data provider from config. Auth is enforced upstream regardless of
 * mode; this only decides where authed data comes from (see plan-of-record). When
 * `statsSource` is 'mlb', the base provider is wrapped so player/free-agent stat
 * VALUES come from the MLB Stats API while Yahoo still owns identity, ownership, and
 * rank; every other method passes through unchanged.
 */
export function createFantasyProvider(config: AppConfig): FantasyProvider {
  const base = config.dataMode === 'mock' ? new MockFantasyProvider() : new YahooFantasyProvider(config);
  return config.statsSource === 'mlb' ? new MlbStatsProvider(base) : base;
}

/** Yahoo's MLB game code; used to scope league queries to baseball. */
const MLB_GAME_KEY = 'mlb';

/**
 * Pure mapping from the yahoo-fantasy `user.game_leagues` result to our DTO.
 * Exported for direct unit testing without touching the network or the library.
 */
export function mapUserLeaguesToDto(
  result: YahooUserGameLeaguesResult,
  userTeamByLeague?: Map<string, UserTeamByLeague>,
): MeLeaguesResponse {
  const games = Array.isArray(result.games) ? result.games : [];
  const leagues = games.flatMap((game) => {
    const gameLeagues = Array.isArray(game.leagues) ? game.leagues : [];
    return gameLeagues.map((league) => {
      const userTeam = userTeamByLeague?.get(league.league_key);
      return {
        // Use the full Yahoo league_key (e.g. "431.l.24281") as our leagueId: it is a
        // stable identifier the rosters/stats endpoints can pass straight back to Yahoo,
        // which requires the game-scoped key rather than the bare numeric league_id.
        leagueId: league.league_key,
        name: league.name,
        season: league.season,
        ...(userTeam?.teamName ? { teamName: userTeam.teamName } : {}),
        ...(userTeam?.logoUrl ? { logoUrl: userTeam.logoUrl } : {}),
      };
    });
  });

  // Validate at the boundary so runtime and compile-time agree before returning.
  return meLeaguesResponseSchema.parse({ userGuid: result.guid, leagues });
}

/** Extract the league_key prefix from a Yahoo team_key (e.g. "431.l.24281.t.3" -> "431.l.24281"). */
function leagueKeyFromTeamKey(teamKey: string): string | undefined {
  const match = teamKey.match(/^(.+\.l\.\d+)\.t\.\d+$/);
  return match?.[1];
}

export type UserTeamByLeague = {
  teamName: string;
  logoUrl?: string;
};

/** Build a league_key -> user team summary from user.game_teams(). */
export function mapUserTeamsByLeague(result: YahooUserTeamsResult): Map<string, UserTeamByLeague> {
  const byLeague = new Map<string, UserTeamByLeague>();
  for (const game of result.teams ?? []) {
    for (const team of game.teams ?? []) {
      const leagueKey = leagueKeyFromTeamKey(team.team_key);
      if (!leagueKey || !team.name) continue;
      const logoUrl = extractTeamLogoUrl(team);
      byLeague.set(leagueKey, {
        teamName: team.name,
        ...(logoUrl ? { logoUrl } : {}),
      });
    }
  }
  return byLeague;
}

/** Pull a player headshot URL from Yahoo's post-mapped player object or raw meta. */
function extractHeadshotUrl(source: {
  headshot?: { url?: string } | string;
  image_url?: string;
}): string | undefined {
  if (typeof source.image_url === 'string' && source.image_url.startsWith('http')) {
    return source.image_url;
  }
  const headshot = source.headshot;
  if (typeof headshot === 'string' && headshot.startsWith('http')) return headshot;
  if (headshot && typeof headshot === 'object' && typeof headshot.url === 'string') {
    return headshot.url;
  }
  return undefined;
}

/** Pull a fantasy team logo URL from Yahoo's post-mapped team object. */
export function extractTeamLogoUrl(source: { team_logos?: YahooTeamLogo[] }): string | undefined {
  const logos = source.team_logos;
  if (!Array.isArray(logos) || logos.length === 0) return undefined;
  const sorted = [...logos].sort(
    (a, b) => Number.parseInt(b.size ?? '0', 10) - Number.parseInt(a.size ?? '0', 10),
  );
  const url = sorted[0]?.url;
  return typeof url === 'string' && url.startsWith('http') ? url : undefined;
}

/** Map a Yahoo player (roster or stats shape) to our domain Player. */
function mapPlayerCore(p: YahooPlayer): Player {
  const headshotUrl = extractHeadshotUrl(p);
  const eligiblePositions = Array.isArray(p.eligible_positions) ? p.eligible_positions : [];
  const positionType = inferPlayerPositionType({
    ...(p.position_type === 'B' || p.position_type === 'P'
      ? { positionType: p.position_type }
      : {}),
    ...(typeof p.display_position === 'string' ? { displayPosition: p.display_position } : {}),
    eligiblePositions,
  });
  return {
    playerId: p.player_id,
    fullName: p.name?.full ?? 'Unknown Player',
    // Yahoo abbreviations vary in case across seasons; normalize to upper for the UI.
    ...(p.editorial_team_abbr ? { mlbTeamAbbr: p.editorial_team_abbr.toUpperCase() } : {}),
    eligiblePositions,
    ...(typeof p.display_position === 'string' ? { displayPosition: p.display_position } : {}),
    ...(positionType ? { positionType } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(headshotUrl ? { headshotUrl } : {}),
  };
}

/** Map a Yahoo team (with its roster populated) to our TeamRoster DTO. */
export function mapTeamToRoster(team: YahooTeam): TeamRoster {
  const manager =
    team.managers?.find((m) => String(m.is_current_login) === '1') ?? team.managers?.[0];
  const slots = (team.roster ?? []).map((p) => ({
    selectedPosition: p.selected_position ?? 'BN',
    player: mapPlayerCore(p),
  }));
  const logoUrl = extractTeamLogoUrl(team);
  return {
    teamId: team.team_id,
    teamName: team.name,
    ...(manager?.nickname ? { managerName: manager.nickname } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    slots,
  };
}

/**
 * Yahoo stat IDs for rate/composite categories that must NOT be summed across
 * players: AVG(3), OBP(4), SLG(5), OPS(55), ERA(26), WHIP(27). The display-name
 * fallback covers sources (e.g. mocks) that key by label instead of Yahoo ID.
 */
const RATE_STAT_IDS = new Set(['3', '4', '5', '55', '26', '27']);
const RATE_STAT_LABELS = new Set(['AVG', 'OBP', 'SLG', 'OPS', 'ERA', 'WHIP']);

/** Counting stats can be summed in a totals row; rate/composite stats cannot. */
function isAggregatable(cat: YahooStatCategory): boolean {
  return !RATE_STAT_IDS.has(String(cat.stat_id)) && !RATE_STAT_LABELS.has(cat.display_name);
}

/** Map a league's stat categories to Stats-page columns for one player type. */
function buildStatColumns(cats: YahooStatCategory[], positionType: 'B' | 'P'): StatColumn[] {
  return cats
    .filter((c) => c.position_type === positionType)
    .map((c) => ({
      key: String(c.stat_id),
      label: c.display_name,
      ...(c.name ? { description: c.name } : {}),
      aggregatable: isAggregatable(c),
    }));
}

/** Batting-only columns (batters and pitchers are shown in separate tables). */
export function buildBattingStatColumns(cats: YahooStatCategory[]): StatColumn[] {
  return buildStatColumns(cats, 'B');
}

/** Pitching-only columns (W, ERA, WHIP, K, ...). */
export function buildPitchingStatColumns(cats: YahooStatCategory[]): StatColumn[] {
  return buildStatColumns(cats, 'P');
}

/** Map one Yahoo player's season stats onto the league's batting columns. */
export function mapPlayerStatLine(player: YahooPlayer, columns: StatColumn[]): PlayerStatLine {
  const byStatId = new Map<string, string | number>();
  // Stats live on `player_stats` (league.players) or `stats` (players.teams w/ stats).
  const statList = player.player_stats?.stats ?? player.stats?.stats ?? [];
  for (const s of statList) {
    byStatId.set(String(s.stat_id), s.value);
  }
  return {
    player: mapPlayerCore(player),
    // "-" is Yahoo's own placeholder for an unavailable value; keep columns aligned.
    stats: columns.map((col) => ({ key: col.key, value: byStatId.get(col.key) ?? '-' })),
  };
}

/** Split an array into fixed-size chunks (Yahoo caps player_keys per request). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Yahoo exposes player rank only as a sort order, never a field, so we page the
// league's players sorted by actual season rank (AR) and use each player's position
// as their overall rank. Bounded to keep the extra Yahoo calls in check; players
// outside this window simply get no rank.
const RANK_PAGE_SIZE = 25;
const RANK_MAX_PLAYERS = 300;

// How many team keys to request per players/stats call (keeps each URL + response
// reasonable while covering a typical 12-team league in one or two calls).
const TEAM_KEY_CHUNK = 8;

// Yahoo caps player_keys per request (~25); one league players/stats call per chunk.
const PLAYER_KEY_CHUNK = 25;

/** Build a player_key -> overall season rank map from the AR-sorted player pool. */
async function fetchOverallRanks(
  yf: YahooFantasy,
  leagueKey: string,
): Promise<Map<string, number>> {
  const starts: number[] = [];
  for (let start = 0; start < RANK_MAX_PLAYERS; start += RANK_PAGE_SIZE) starts.push(start);

  const pages = await Promise.all(
    starts.map((start) =>
      yf.players.leagues(leagueKey, {
        sort: 'AR',
        sort_type: 'season',
        start,
        count: RANK_PAGE_SIZE,
      }),
    ),
  );

  const ranks = new Map<string, number>();
  starts.forEach((start, pageIdx) => {
    const players = pages[pageIdx]?.[0]?.players ?? [];
    players.forEach((p, i) => {
      if (typeof p.player_key === 'string' && !ranks.has(p.player_key)) {
        ranks.set(p.player_key, start + i + 1);
      }
    });
  });
  return ranks;
}

/**
 * Page the league's players collection for a single availability/position filter,
 * sorted by actual rank, until `perType` players are collected (Yahoo caps each page at
 * 25). Pages are fetched in parallel and deduped by player_key. Used to fill the batting
 * and pitching free-agent tables independently.
 */
async function fetchFreeAgentPool(
  yf: YahooFantasy,
  leagueId: string,
  filters: Record<string, string | number>,
  perType: number,
): Promise<YahooPlayer[]> {
  const pageCount = Math.ceil(perType / FREE_AGENT_PAGE);
  const starts = Array.from({ length: pageCount }, (_, i) => i * FREE_AGENT_PAGE);
  const pages = await Promise.all(
    starts.map((start) => yf.players.leagues(leagueId, { ...filters, start, count: FREE_AGENT_PAGE })),
  );
  const seen = new Set<string>();
  const players: YahooPlayer[] = [];
  for (const page of pages) {
    for (const p of page?.[0]?.players ?? []) {
      if (typeof p.player_key === 'string' && !seen.has(p.player_key)) {
        seen.add(p.player_key);
        players.push(p);
      }
    }
  }
  return players.slice(0, perType);
}

/**
 * Build the scoring columns for a team's range-stats table from a league's stat
 * categories. Includes every enabled scoring category (batting AND pitching) but
 * drops display-only stats (e.g. H/AB, IP), which Yahoo flags with
 * `is_only_display_stat` and which carry no scoring value. Order is preserved so
 * the table matches the league's own category order.
 */
export function buildScoringColumns(cats: YahooStatCategory[]): StatColumn[] {
  return cats
    .filter(
      (c) => String(c.enabled ?? '1') === '1' && String(c.is_only_display_stat ?? '0') !== '1',
    )
    .map((c) => ({
      key: String(c.stat_id),
      label: c.display_name,
      ...(c.name ? { description: c.name } : {}),
    }));
}

/* Raw shapes for the un-mapped `players;.../stats` collection returned by yf.api().
 * We parse it directly (rather than via the library's league.players, which cannot
 * request a coverage type) so we can pass ;type=date|lastweek|lastmonth|season. */
interface RawStatEntry {
  stat: { stat_id: string | number; value: string | number };
}
interface RawPlayerNode {
  player?: [unknown[], { player_stats?: { stats?: RawStatEntry[] } }?];
}
interface RawPlayersCollection {
  count?: number;
  [index: string]: unknown;
}
interface RawLeaguePlayersResponse {
  fantasy_content?: { league?: [unknown, { players?: RawPlayersCollection }?] };
}
interface RawTeamStatsResponse {
  fantasy_content?: { team?: [unknown, { team_stats?: { stats?: RawStatEntry[] } }?] };
}

/** Merge Yahoo's array-of-single-key-objects player metadata into one object. */
function mergePlayerMeta(items: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      Object.assign(out, item as Record<string, unknown>);
    }
  }
  return out;
}

/** Domain Player plus the routing fields getPlayerStats needs (rank + batter/pitcher split). */
interface RawPlayerMeta {
  player: Player;
  playerKey?: string;
  positionType?: string;
}

/** Map a raw player node's merged metadata to our Player (and its key/position type). */
function mapRawPlayerMeta(node: RawPlayerNode): RawPlayerMeta {
  const meta = mergePlayerMeta(Array.isArray(node.player?.[0]) ? node.player[0] : []);
  const name = meta.name as { full?: string } | undefined;
  const abbr = meta.editorial_team_abbr;
  const eligible = Array.isArray(meta.eligible_positions)
    ? (meta.eligible_positions as { position?: string }[])
        .map((p) => p.position)
        .filter((p): p is string => typeof p === 'string')
    : [];
  const headshotUrl = extractHeadshotUrl(meta);
  const player: Player = {
    playerId: String(meta.player_id ?? ''),
    fullName: name?.full ?? 'Unknown Player',
    ...(typeof abbr === 'string' ? { mlbTeamAbbr: abbr.toUpperCase() } : {}),
    eligiblePositions: eligible,
    ...(meta.position_type === 'B' || meta.position_type === 'P'
      ? { positionType: meta.position_type }
      : {}),
    ...(typeof meta.status === 'string' ? { status: meta.status } : {}),
    ...(headshotUrl ? { headshotUrl } : {}),
  };
  return {
    player,
    ...(typeof meta.player_key === 'string' ? { playerKey: meta.player_key } : {}),
    ...(typeof meta.position_type === 'string' ? { positionType: meta.position_type } : {}),
  };
}

/** Raw stat_id -> value map for one player node (empty when the stats node is absent). */
function rawStatMap(node: RawPlayerNode): Map<string, string | number> {
  const byStatId = new Map<string, string | number>();
  for (const s of node.player?.[1]?.player_stats?.stats ?? []) {
    byStatId.set(String(s.stat.stat_id), s.stat.value);
  }
  return byStatId;
}

/**
 * Align a raw player node's stats onto the given columns. Tolerant of a missing
 * stats node - Yahoo omits `player_stats` for some players ("-" keeps columns aligned).
 */
function mapRawPlayerStats(node: RawPlayerNode, columns: StatColumn[]): StatValue[] {
  const byStatId = rawStatMap(node);
  return columns.map((col) => ({ key: col.key, value: byStatId.get(col.key) ?? '-' }));
}

function mapRawPlayerToStatLine(node: RawPlayerNode, columns: StatColumn[]): PlayerStatLine {
  return { player: mapRawPlayerMeta(node).player, stats: mapRawPlayerStats(node, columns) };
}

/**
 * Parse the raw `league/{key}/players;.../stats` collection into stat lines mapped
 * onto the given columns. Exported (with the raw response) for unit testing against
 * captured Yahoo payloads without any network access.
 */
export function parseLeaguePlayersStats(
  response: RawLeaguePlayersResponse,
  columns: StatColumn[],
): PlayerStatLine[] {
  const players = response.fantasy_content?.league?.[1]?.players ?? {};
  const count = typeof players.count === 'number' ? players.count : 0;
  const rows: PlayerStatLine[] = [];
  for (let i = 0; i < count; i++) {
    const node = players[String(i)] as RawPlayerNode | undefined;
    if (node?.player) {
      rows.push(mapRawPlayerToStatLine(node, columns));
    }
  }
  return rows;
}

/**
 * Build a player_key -> (stat_id -> value) map from a league `players;.../stats`
 * response. Lets getPlayerStats fetch stats via the proven league players/stats path
 * and join them onto rostered players by key. Exported for unit testing against
 * captured Yahoo payloads without the network.
 */
export function parseLeaguePlayerStatMap(
  response: RawLeaguePlayersResponse,
): Map<string, Map<string, string | number>> {
  const players = response.fantasy_content?.league?.[1]?.players ?? {};
  const count = typeof players.count === 'number' ? players.count : 0;
  const out = new Map<string, Map<string, string | number>>();
  for (let i = 0; i < count; i++) {
    const node = players[String(i)] as RawPlayerNode | undefined;
    if (!node?.player) continue;
    const { playerKey } = mapRawPlayerMeta(node);
    if (playerKey) out.set(playerKey, rawStatMap(node));
  }
  return out;
}

/**
 * Align a team's aggregated `team_stats` onto the given scoring columns. Yahoo
 * returns the team's totals for the requested coverage window (with rate stats
 * like AVG/ERA/WHIP already computed), so no client-side aggregation is needed.
 * Exported for unit testing against captured payloads without the network.
 */
export function parseTeamStats(response: RawTeamStatsResponse, columns: StatColumn[]): StatValue[] {
  const byStatId = new Map<string, string | number>();
  for (const s of response.fantasy_content?.team?.[1]?.team_stats?.stats ?? []) {
    byStatId.set(String(s.stat.stat_id), s.stat.value);
  }
  // "-" is Yahoo's own placeholder for an unavailable value; keep columns aligned.
  return columns.map((col) => ({ key: col.key, value: byStatId.get(col.key) ?? '-' }));
}

/* Raw shapes for the un-mapped `league/{key}/transactions` collection. We parse it
 * directly (rather than the library's league.transactions(), which is unfiltered and
 * fetches the whole season) so we can bound the payload with a `;count=N` filter. */
interface RawTransactionData {
  type?: string;
  source_type?: string;
  source_team_name?: string;
  destination_type?: string;
  destination_team_name?: string;
}
interface RawTransactionPlayerNode {
  player?: [unknown[], { transaction_data?: RawTransactionData | RawTransactionData[] }?];
}
interface RawTransactionMeta {
  transaction_key?: string;
  transaction_id?: string;
  type?: string;
  status?: string;
  timestamp?: string | number;
}
interface RawTransactionNode {
  transaction?: [RawTransactionMeta, { players?: { count?: number; [index: string]: unknown } }?];
}
interface RawLeagueTransactionsResponse {
  fantasy_content?: {
    league?: [unknown, { transactions?: { count?: number; [index: string]: unknown } }?];
  };
}

/** Transaction types we surface (roster moves); commissioner-only moves are dropped. */
const KEPT_TRANSACTION_TYPES = new Set<LeagueTransaction['type']>([
  'add',
  'drop',
  'add/drop',
  'trade',
]);

/** Yahoo's per-player transaction_data.type maps to how the player moved. */
function toTransactionMovement(type: string | undefined): TransactionPlayer['movement'] | undefined {
  return type === 'add' || type === 'drop' || type === 'trade' ? type : undefined;
}

/** Map one raw transaction player node to our DTO player (undefined when it lacks a movement). */
function mapTransactionPlayerNode(node: RawTransactionPlayerNode): TransactionPlayer | undefined {
  const meta = mergePlayerMeta(Array.isArray(node.player?.[0]) ? node.player[0] : []);
  const raw = node.player?.[1]?.transaction_data;
  const data = Array.isArray(raw) ? raw[0] : raw;
  const movement = toTransactionMovement(data?.type);
  if (!movement) return undefined;
  const name = meta.name as { full?: string } | undefined;
  const abbr = meta.editorial_team_abbr;
  return {
    playerId: String(meta.player_id ?? ''),
    fullName: name?.full ?? 'Unknown Player',
    ...(typeof abbr === 'string' ? { mlbTeamAbbr: abbr.toUpperCase() } : {}),
    ...(typeof meta.display_position === 'string' ? { displayPosition: meta.display_position } : {}),
    ...(meta.position_type === 'B' || meta.position_type === 'P'
      ? { positionType: meta.position_type }
      : {}),
    movement,
    ...(typeof data?.source_team_name === 'string' ? { sourceTeamName: data.source_team_name } : {}),
    ...(typeof data?.destination_team_name === 'string'
      ? { destinationTeamName: data.destination_team_name }
      : {}),
  };
}

/** Map one raw transaction node to our DTO (undefined for filtered-out types, e.g. commish). */
function mapTransactionNode(node: RawTransactionNode): LeagueTransaction | undefined {
  const meta = node.transaction?.[0];
  const type = meta?.type as LeagueTransaction['type'] | undefined;
  if (!meta || !type || !KEPT_TRANSACTION_TYPES.has(type)) return undefined;
  const playersColl = node.transaction?.[1]?.players;
  const players: TransactionPlayer[] = [];
  const count = typeof playersColl?.count === 'number' ? playersColl.count : 0;
  for (let i = 0; i < count; i++) {
    const pnode = playersColl?.[String(i)] as RawTransactionPlayerNode | undefined;
    if (pnode?.player) {
      const mapped = mapTransactionPlayerNode(pnode);
      if (mapped) players.push(mapped);
    }
  }
  return {
    transactionId: String(meta.transaction_id ?? meta.transaction_key ?? ''),
    type,
    status: typeof meta.status === 'string' ? meta.status : 'successful',
    timestamp: toOptionalNumber(meta.timestamp) ?? 0,
    players,
  };
}

/**
 * Parse the raw `league/{key}/transactions` collection into our DTO: newest first,
 * commissioner-only moves dropped, capped to `limit`. Exported for unit testing
 * against captured Yahoo payloads without any network access.
 */
export function parseLeagueTransactions(
  response: RawLeagueTransactionsResponse,
  leagueId: string,
  limit: number,
): LeagueTransactionsResponse {
  const coll = response.fantasy_content?.league?.[1]?.transactions ?? {};
  const count = typeof coll.count === 'number' ? coll.count : 0;
  const transactions: LeagueTransaction[] = [];
  for (let i = 0; i < count; i++) {
    const node = coll[String(i)] as RawTransactionNode | undefined;
    if (node?.transaction) {
      const mapped = mapTransactionNode(node);
      if (mapped) transactions.push(mapped);
    }
  }
  transactions.sort((a, b) => b.timestamp - a.timestamp);
  return leagueTransactionsResponseSchema.parse({
    leagueId,
    transactions: transactions.slice(0, limit),
  });
}

/** URL for a league's recent transactions, bounded by `count` (Yahoo returns newest first). */
function leagueTransactionsUrl(leagueId: string, count: number): string {
  return `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueId}/transactions;count=${count}`;
}

/** Parse an optional Yahoo count (string|number) into a finite number, else undefined. */
function toOptionalNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/**
 * Map Yahoo's mapped `league.standings` teams to our standings DTO, ordered by
 * rank. Result fields are optional because Yahoo omits some pre-season and roto
 * leagues carry a different shape. Exported for unit testing without the network.
 */
export function mapStandingsToDto(leagueId: string, teams: YahooTeam[]): LeagueStandingsResponse {
  const rows: StandingsRow[] = teams.map((team) => {
    const standings = team.standings;
    const outcomes = standings?.outcome_totals;
    const manager =
      team.managers?.find((m) => String(m.is_current_login) === '1') ?? team.managers?.[0];
    const logoUrl = extractTeamLogoUrl(team);
    const percentage = outcomes?.percentage;
    const gamesBack = standings?.games_back;
    return {
      teamId: team.team_id,
      teamName: team.name,
      ...(logoUrl ? { logoUrl } : {}),
      ...(manager?.nickname ? { managerName: manager.nickname } : {}),
      ...(toOptionalNumber(standings?.rank) === undefined
        ? {}
        : { rank: toOptionalNumber(standings?.rank) }),
      ...(toOptionalNumber(outcomes?.wins) === undefined
        ? {}
        : { wins: toOptionalNumber(outcomes?.wins) }),
      ...(toOptionalNumber(outcomes?.losses) === undefined
        ? {}
        : { losses: toOptionalNumber(outcomes?.losses) }),
      ...(toOptionalNumber(outcomes?.ties) === undefined
        ? {}
        : { ties: toOptionalNumber(outcomes?.ties) }),
      ...(percentage === undefined ? {} : { winPercentage: String(percentage) }),
      ...(gamesBack === undefined ? {} : { gamesBack: String(gamesBack) }),
      ...(toOptionalNumber(team.number_of_moves) === undefined
        ? {}
        : { moves: toOptionalNumber(team.number_of_moves) }),
    };
  });
  rows.sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
  return leagueStandingsResponseSchema.parse({ leagueId, teams: rows });
}

/** Normalize Yahoo's matchup `status` to our lifecycle enum, defaulting to preevent. */
function toMatchupStatus(status: string | undefined): Matchup['status'] {
  return status === 'midevent' || status === 'postevent' ? status : 'preevent';
}

/** Yahoo booleans arrive as "1"/"0" (or numbers); treat "1"/1 as true. */
function toYahooBoolean(value: string | number | undefined): boolean {
  return value === '1' || value === 1;
}

/**
 * Tally per-team category wins/losses/ties from a matchup's `stat_winners` (one
 * entry per scoring category). This is a categories league, so these counts feed
 * directly into the cumulative season record. Keyed by `team_key`.
 */
function tallyCategoryResults(
  statWinners: YahooStatWinner[] | undefined,
  teamKeys: string[],
): Map<string, { won: number; lost: number; tied: number }> {
  const tally = new Map(teamKeys.map((key) => [key, { won: 0, lost: 0, tied: 0 }]));
  for (const winner of statWinners ?? []) {
    if (!winner) continue;
    if (toYahooBoolean(winner.is_tied)) {
      for (const key of teamKeys) tally.get(key)!.tied += 1;
      continue;
    }
    const winnerKey = winner.winner_team_key;
    if (!winnerKey || !tally.has(winnerKey)) continue;
    for (const key of teamKeys) {
      tally.get(key)![key === winnerKey ? 'won' : 'lost'] += 1;
    }
  }
  return tally;
}

/**
 * Map a matchup's `stat_winners` (one per scoring category) to our DTO shape,
 * resolving each winner's `team_key` to a bare `teamId`. `statKey` is the Yahoo
 * `stat_id` (== our StatColumn.key), letting the UI highlight the winning cell.
 */
function mapStatWinners(
  statWinners: YahooStatWinner[] | undefined,
  teamIdByKey: Map<string, string>,
): MatchupStatWinner[] {
  const out: MatchupStatWinner[] = [];
  for (const winner of statWinners ?? []) {
    if (winner?.stat_id === undefined || winner.stat_id === null) continue;
    const tied = toYahooBoolean(winner.is_tied);
    const winnerTeamId = winner.winner_team_key
      ? teamIdByKey.get(winner.winner_team_key)
      : undefined;
    out.push({
      statKey: String(winner.stat_id),
      ...(tied ? { isTied: true } : {}),
      ...(!tied && winnerTeamId ? { winnerTeamId } : {}),
    });
  }
  return out;
}

/**
 * Map Yahoo's mapped `league.scoreboard` block to our matchups DTO for a week.
 * Per-team `categoriesWon`/`categoriesLost`/`categoriesTied` come from the
 * matchup's `stat_winners`; when Yahoo omits them we fall back to each team's
 * `team_points.total` for wins and the opponent's total for losses (ties unknown,
 * treated as 0). Exported for unit testing without the network.
 */
export function mapScoreboardToDto(
  leagueId: string,
  scoreboard: YahooScoreboard | undefined,
): LeagueMatchupsResponse {
  const rawMatchups = scoreboard?.matchups ?? [];
  const matchups: Matchup[] = rawMatchups.map((m: YahooMatchup) => {
    const yahooTeams = m.teams ?? [];
    const hasStatWinners = (m.stat_winners?.length ?? 0) > 0;
    const tally = tallyCategoryResults(
      m.stat_winners,
      yahooTeams.map((t) => t.team_key),
    );
    // Resolve Yahoo's per-category winner (a full team_key) to our bare teamId so
    // the UI can highlight the winning cell keyed by StatColumn.key (== stat_id).
    const teamIdByKey = new Map(yahooTeams.map((t) => [t.team_key, t.team_id]));
    const statWinners = mapStatWinners(m.stat_winners, teamIdByKey);
    const teams: MatchupTeam[] = yahooTeams.map((team, i) => {
      const logoUrl = extractTeamLogoUrl(team);
      const opponent = yahooTeams[i === 0 ? 1 : 0];
      const result = tally.get(team.team_key);
      const won = hasStatWinners
        ? (result?.won ?? 0)
        : (toOptionalNumber(team.points?.total) ?? 0);
      const lost = hasStatWinners
        ? (result?.lost ?? 0)
        : (toOptionalNumber(opponent?.points?.total) ?? 0);
      const tied = result?.tied ?? 0;
      return {
        teamId: team.team_id,
        teamName: team.name,
        ...(logoUrl ? { logoUrl } : {}),
        categoriesWon: won,
        categoriesLost: lost,
        categoriesTied: tied,
      };
    });
    return {
      week: toOptionalNumber(m.week) ?? toOptionalNumber(scoreboard?.week) ?? 0,
      status: toMatchupStatus(m.status),
      ...(toYahooBoolean(m.is_playoffs) ? { isPlayoffs: true } : {}),
      ...(toYahooBoolean(m.is_tied) ? { isTied: true } : {}),
      ...(m.week_start ? { weekStart: m.week_start } : {}),
      ...(m.week_end ? { weekEnd: m.week_end } : {}),
      teams,
      ...(statWinners.length > 0 ? { statWinners } : {}),
    };
  });
  const week =
    toOptionalNumber(scoreboard?.week) ?? matchups.find((m) => m.week > 0)?.week ?? 0;
  return leagueMatchupsResponseSchema.parse({ leagueId, week, matchups });
}

/** A single-coverage bucket Yahoo can return in one call (season or one fantasy week). */
type SingleCoverage = number | 'season';

/** Map a single coverage to Yahoo's native `/stats;type=...` segment. */
function teamStatsCoverageSegment(coverage: SingleCoverage): string {
  return coverage === 'season' ? '/stats;type=season' : `/stats;type=week;week=${coverage}`;
}

/** URL for a single team's aggregated stats for one coverage (season or a fantasy week). */
function teamStatsUrl(leagueId: string, teamId: string, coverage: SingleCoverage): string {
  return (
    `https://fantasysports.yahooapis.com/fantasy/v2/team/${leagueId}.t.${teamId}` +
    `${teamStatsCoverageSegment(coverage)}`
  );
}

/**
 * The selectable fantasy week numbers for a league (start_week..current_week), from
 * the settings meta. Empty when the league carries no week bounds (e.g. a format
 * without weeks), in which case only the 'season' bucket is offered.
 */
export function leagueWeekNumbers(league: {
  start_week?: string | number;
  current_week?: string | number;
}): number[] {
  const start = Number(league.start_week);
  const current = Number(league.current_week);
  if (!Number.isFinite(start) || !Number.isFinite(current) || current < start) return [];
  const weeks: number[] = [];
  for (let w = start; w <= current; w++) weeks.push(w);
  return weeks;
}

/** URL for a league players collection filtered by keys, with stats over `range`. */
function leaguePlayersStatsUrl(
  leagueId: string,
  playerKeys: string[],
  range: StatRange,
  date?: string,
): string {
  return (
    `https://fantasysports.yahooapis.com/fantasy/v2/league/${leagueId}` +
    `/players;player_keys=${playerKeys.join(',')}${rangeToStatsSegment(range, date)}`
  );
}

/** Current calendar date in US Eastern time (YYYY-MM-DD) - the MLB "game day". */
function easternDateString(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

/** Map our range to the Yahoo `/stats;type=...` path segment. */
function rangeToStatsSegment(range: StatRange, date?: string): string {
  switch (range) {
    case 'today':
      return `/stats;type=date;date=${date ?? easternDateString()}`;
    case 'last7':
      return '/stats;type=lastweek';
    case 'last30':
      return '/stats;type=lastmonth';
    case 'season':
      return '/stats;type=season';
    case 'last14':
    case 'last21':
      // Yahoo has no native 14- or 21-day coverage; these windows are only served by
      // the MLB stats source, which never routes through the Yahoo provider (it
      // substitutes 'season' for scaffolding). Guard so a misconfiguration fails loudly.
      throw new Error(`${range} is not supported by the Yahoo stats source.`);
  }
}

/** Today's roster, or the snapshot for a specific YYYY-MM-DD game day. */
function loadTeamRoster(
  yf: ReturnType<typeof createYahooClient>,
  teamKey: string,
  date?: string,
): Promise<YahooTeam> {
  return date ? yf.roster.fetch(teamKey, date) : yf.team.roster(teamKey);
}

export class YahooFantasyProvider implements FantasyProvider {
  constructor(private readonly config: AppConfig) {}

  async getMyLeagues(
    tokens: YahooTokens,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<MeLeaguesResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);
    const [result, teamsResult] = await Promise.all([
      yf.user.game_leagues(MLB_GAME_KEY),
      yf.user.game_teams(MLB_GAME_KEY),
    ]);
    return mapUserLeaguesToDto(result, mapUserTeamsByLeague(teamsResult));
  }

  /**
   * Every team's roster in the league. `leagueId` is the Yahoo league_key. Yahoo has
   * no single "all rosters" call, so we list the teams then fetch each roster in
   * parallel (1 + N requests). Only non-sensitive counts are logged - never league
   * or player data (see security rule).
   */
  async getLeagueRosters(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
    date?: string,
  ): Promise<LeagueRostersResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const league = await yf.league.teams(leagueId);
    const teamList = league.teams ?? [];
    const teams = await Promise.all(
      teamList.map(async (t) => {
        const roster = mapTeamToRoster(await loadTeamRoster(yf, t.team_key, date));
        const withDate = date ? { ...roster, coverageDate: date } : roster;
        const logoUrl = extractTeamLogoUrl(t) ?? withDate.logoUrl;
        return logoUrl && logoUrl !== withDate.logoUrl ? { ...withDate, logoUrl } : withDate;
      }),
    );

    console.warn(
      `[live] rosters: mapped ${teams.length} teams for league ${leagueId}` +
        (date ? ` date=${date}` : ''),
    );
    return leagueRostersResponseSchema.parse({ leagueId, teams });
  }

  /**
   * Stats over `range` (today/last7/last30/season) for every rostered player in the
   * league, split into batting and pitching tables (their scoring categories don't
   * overlap). Each row carries the owning fantasy team and the player's Yahoo overall
   * *season* rank across the pool (rank is always season-based, independent of range).
   *
   * Two data sources are joined by player_key: team rosters (owner + who's rostered,
   * fetched without the `stats` subresource so the library parses them cleanly) and the
   * league players/stats collection (the only form Yahoo returns actual stat values for -
   * the same proven path as getTeamRangeStats). Cost: settings (1) + league teams (1) +
   * one roster call per TEAM_KEY_CHUNK teams + one stats call per PLAYER_KEY_CHUNK players
   * + the rank lookup (fetchOverallRanks) - a deliberate, caller-approved cost.
   */
  async getPlayerStats(
    tokens: YahooTokens,
    leagueId: string,
    range: StatRange,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<PlayerStatsResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const settings = await yf.league.settings(leagueId);
    const cats = settings.settings?.stat_categories ?? [];
    const battingColumns = buildBattingStatColumns(cats);
    const pitchingColumns = buildPitchingStatColumns(cats);

    const league = await yf.league.teams(leagueId);
    const teamKeys = (league.teams ?? [])
      .map((t) => t.team_key)
      .filter((k): k is string => typeof k === 'string');
    const ownerLogoByName = new Map<string, string>();
    for (const t of league.teams ?? []) {
      const logoUrl = extractTeamLogoUrl(t);
      if (logoUrl && t.name) ownerLogoByName.set(t.name, logoUrl);
    }

    // Rosters (owner + player meta + position), fetched without the `stats` subresource
    // so the library parses them cleanly (its stats parser crashes on statless players).
    const rosterChunks = await Promise.all(
      chunk(teamKeys, TEAM_KEY_CHUNK).map((keys) => yf.players.teams(keys)),
    );
    const rosterTeams = rosterChunks.flat();

    const playerKeys = rosterTeams
      .flatMap((t) => t.players ?? [])
      .map((p) => p.player_key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    // Stats keyed by player_key (proven league players/stats path) + whole-pool ranks.
    const [statChunks, ranks] = await Promise.all([
      Promise.all(
        chunk(playerKeys, PLAYER_KEY_CHUNK).map((keys) =>
          yf.api<RawLeaguePlayersResponse>('GET', leaguePlayersStatsUrl(leagueId, keys, range)),
        ),
      ),
      fetchOverallRanks(yf, leagueId),
    ]);
    const statsByKey = new Map<string, Map<string, string | number>>();
    for (const raw of statChunks) {
      for (const [key, stats] of parseLeaguePlayerStatMap(raw)) statsByKey.set(key, stats);
    }

    const battingPlayers: PlayerStatLine[] = [];
    const pitchingPlayers: PlayerStatLine[] = [];
    for (const team of rosterTeams) {
      const owner = team.name;
      const ownerLogoUrl = owner ? ownerLogoByName.get(owner) : undefined;
      for (const p of team.players ?? []) {
        const isPitcher = p.position_type === 'P';
        const columns = isPitcher ? pitchingColumns : battingColumns;
        const byStatId = statsByKey.get(p.player_key);
        const rank = ranks.get(p.player_key);
        const row: PlayerStatLine = {
          player: mapPlayerCore(p),
          // "-" is Yahoo's own placeholder for an unavailable value; keep columns aligned.
          stats: columns.map((col) => ({ key: col.key, value: byStatId?.get(col.key) ?? '-' })),
          ...(owner ? { owner } : {}),
          ...(ownerLogoUrl ? { ownerLogoUrl } : {}),
          ...(rank === undefined ? {} : { overallRank: rank }),
        };
        (isPitcher ? pitchingPlayers : battingPlayers).push(row);
      }
    }

    console.warn(
      `[live] stats: range=${range} ${battingPlayers.length} batters / ${pitchingPlayers.length} pitchers across ${rosterTeams.length} teams, ${statsByKey.size} with stats, ${ranks.size} ranked for league ${leagueId}`,
    );
    return playerStatsResponseSchema.parse({
      leagueId,
      batting: { columns: battingColumns, players: battingPlayers },
      pitching: { columns: pitchingColumns, players: pitchingPlayers },
    });
  }

  /**
   * One team's roster with each player's league scoring-category values over the
   * requested window. `leagueId` is the Yahoo league_key; `teamId` is the bare team
   * number. Columns come from the league's own scoring categories (batting + pitching,
   * display-only stats dropped). Bounded to a single team: settings + roster + one
   * players/stats call per 25-player chunk (a full roster exceeds Yahoo's per-request
   * key cap, so the keys are chunked). Only non-sensitive counts are logged.
   */
  async getTeamRangeStats(
    tokens: YahooTokens,
    leagueId: string,
    teamId: string,
    range: StatRange,
    onTokensRefreshed?: OnTokensRefreshed,
    date?: string,
  ): Promise<TeamStatsResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const settings = await yf.league.settings(leagueId);
    const cats = settings.settings?.stat_categories ?? [];
    const battingColumns = buildBattingStatColumns(cats);
    const pitchingColumns = buildPitchingStatColumns(cats);
    const columns = [...battingColumns, ...pitchingColumns];

    const teamKey = `${leagueId}.t.${teamId}`;
    const asOf = range === 'today' ? date : undefined;
    const team = await loadTeamRoster(yf, teamKey, asOf);
    const playerKeys = (team.roster ?? [])
      .map((p) => p.player_key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);

    if (!playerKeys.length) {
      return teamStatsResponseSchema.parse({
        leagueId,
        teamId,
        range,
        battingColumns,
        pitchingColumns,
        players: [],
      });
    }

    // Yahoo caps player_keys per request (~25), and a full roster (active + bench + IL +
    // NA) routinely exceeds that - so chunk the keys like getPlayerStats does and stitch
    // the parsed lines back together; a single over-cap request fails. The library's
    // league.players() cannot request a coverage type, so issue the raw call ourselves;
    // yf.api() appends ?format=json, so pass no query string.
    const statChunks = await Promise.all(
      chunk(playerKeys, PLAYER_KEY_CHUNK).map((keys) =>
        yf.api<RawLeaguePlayersResponse>('GET', leaguePlayersStatsUrl(leagueId, keys, range, asOf)),
      ),
    );
    const players = statChunks.flatMap((raw) => parseLeaguePlayersStats(raw, columns));

    console.warn(
      `[live] team-stats: team ${teamId} range=${range}` +
        (asOf ? ` date=${asOf}` : '') +
        ` -> ${players.length} players x ${columns.length} cols`,
    );
    return teamStatsResponseSchema.parse({
      leagueId,
      teamId,
      range,
      battingColumns,
      pitchingColumns,
      players,
    });
  }

  /**
   * One team's roster with each player's league scoring-category values for a single
   * fantasy `week`, so the Matchups view can show player stats aligned to the
   * head-to-head scoreboard week. Uses the team roster's players/stats sub-resource
   * (`team/{key}/roster;week=N/players/stats`) - the only Yahoo path that honours a
   * week for per-league player stats. ~2 Yahoo calls (settings + roster+stats). Only
   * non-sensitive counts are logged.
   */
  async getTeamWeekStats(
    tokens: YahooTokens,
    leagueId: string,
    teamId: string,
    week: number,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<TeamWeekStatsResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const settings = await yf.league.settings(leagueId);
    const cats = settings.settings?.stat_categories ?? [];
    const battingColumns = buildBattingStatColumns(cats);
    const pitchingColumns = buildPitchingStatColumns(cats);
    const columns = [...battingColumns, ...pitchingColumns];

    const teamKey = `${leagueId}.t.${teamId}`;
    // Yahoo only returns per-league weekly player stats through the team roster's
    // players sub-resource (`team/{key}/roster;week=N/players/stats`). The
    // `league/players` collection silently ignores the week and hands back season
    // totals (and omits position_type), which is why a week query there yields all
    // "-" cells. The library maps this roster shape - each player carries both
    // player_stats and position_type - so we reuse mapPlayerStatLine. Pass the week
    // as a string so the library's arg parser treats it as a week, not a date.
    const team = await yf.roster.players(teamKey, String(week), 'stats');
    const players = (team.roster ?? []).map((p) => mapPlayerStatLine(p, columns));

    console.warn(
      `[live] team-week-stats: team ${teamId} week=${week} -> ${players.length} players x ${columns.length} cols`,
    );
    return teamWeekStatsResponseSchema.parse({
      leagueId,
      teamId,
      week,
      battingColumns,
      pitchingColumns,
      players,
    });
  }

  /**
   * Every fantasy team's aggregated totals for `bucket`. Single buckets (a fantasy
   * week, or the full season) use Yahoo's own team-totals endpoint so rate stats
   * (AVG/ERA/WHIP) are computed by Yahoo, bucketed by Yahoo's native weeks
   * (`;type=week`). Multi-week windows ('lastNweeks') fetch each of the trailing N
   * weeks and roll them up here (counting stats summed, rate stats averaged - see
   * aggregateWeeklyTeamStats). Columns come from the league's enabled scoring
   * categories (batting + pitching).
   *
   * Cost: settings (1) + league teams (1) + one team-stats call per team per covered
   * week. A single bucket is ~12 calls (like getPlayerStats); a 4-week window in a
   * 12-team league is ~48, fetched a week at a time to bound concurrency. Only
   * non-sensitive counts are logged (see security rule).
   */
  async getLeagueTeamStats(
    tokens: YahooTokens,
    leagueId: string,
    bucket: TeamStatBucket,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueTeamStatsResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const settings = await yf.league.settings(leagueId);
    const cats = settings.settings?.stat_categories ?? [];
    const battingColumns = buildBattingStatColumns(cats);
    const pitchingColumns = buildPitchingStatColumns(cats);
    const columns = [...battingColumns, ...pitchingColumns];
    const weeks = leagueWeekNumbers(settings);

    const league = await yf.league.teams(leagueId);
    const teamList = league.teams ?? [];

    const fetchWeek = (teamId: string, coverage: SingleCoverage) =>
      yf
        .api<RawTeamStatsResponse>('GET', teamStatsUrl(leagueId, teamId, coverage))
        .then((raw) => parseTeamStats(raw, columns));

    // Multi-week window: roll up the trailing N weeks server-side.
    const windowSize =
      typeof bucket === 'string' && bucket !== 'season' ? TEAM_STAT_WINDOW_SIZE[bucket] : 0;
    const aggregatedWeeks = windowSize ? resolveWindowWeeks(weeks, windowSize) : [];
    if (windowSize && aggregatedWeeks.length > 0) {
      const weeklyByTeam = new Map<string, StatValue[][]>(teamList.map((t) => [t.team_id, []]));
      // A week at a time (teams in parallel) to bound concurrent Yahoo calls.
      for (const week of aggregatedWeeks) {
        const perTeam = await Promise.all(
          teamList.map(async (t) => [t.team_id, await fetchWeek(t.team_id, week)] as const),
        );
        for (const [teamId, stats] of perTeam) weeklyByTeam.get(teamId)?.push(stats);
      }
      const teams: TeamStatLine[] = teamList.map((t) => {
        const logoUrl = extractTeamLogoUrl(t);
        return {
          teamId: t.team_id,
          teamName: t.name,
          ...(logoUrl ? { logoUrl } : {}),
          stats: aggregateWeeklyTeamStats(weeklyByTeam.get(t.team_id) ?? [], columns),
        };
      });
      console.warn(
        `[live] league-team-stats: bucket=${bucket} weeks=${aggregatedWeeks.join('+')} ${teams.length} teams for league ${leagueId}`,
      );
      return leagueTeamStatsResponseSchema.parse({
        leagueId,
        bucket,
        weeks,
        aggregatedWeeks,
        battingColumns,
        pitchingColumns,
        teams,
      });
    }

    // Single coverage: a specific week, or season (also the fallback for an
    // out-of-range week or a window with no weeks available).
    const resolvedBucket: SingleCoverage =
      typeof bucket === 'number' && weeks.includes(bucket) ? bucket : 'season';
    const teams: TeamStatLine[] = await Promise.all(
      teamList.map(async (t) => {
        const logoUrl = extractTeamLogoUrl(t);
        return {
          teamId: t.team_id,
          teamName: t.name,
          ...(logoUrl ? { logoUrl } : {}),
          stats: await fetchWeek(t.team_id, resolvedBucket),
        };
      }),
    );

    console.warn(
      `[live] league-team-stats: bucket=${resolvedBucket} ${teams.length} teams x ${columns.length} cols for league ${leagueId}`,
    );
    return leagueTeamStatsResponseSchema.parse({
      leagueId,
      bucket: resolvedBucket,
      weeks,
      battingColumns,
      pitchingColumns,
      teams,
    });
  }

  /**
   * League standings: rank, win/loss/tie totals, win %, games back, and roster
   * moves per team, ordered by rank. Single Yahoo call (league standings). Only
   * non-sensitive counts are logged (see security rule).
   */
  async getLeagueStandings(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueStandingsResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const league = await yf.league.standings(leagueId);
    const dto = mapStandingsToDto(leagueId, league.standings ?? []);

    console.warn(`[live] standings: ${dto.teams.length} teams for league ${leagueId}`);
    return dto;
  }

  /**
   * Head-to-head scoreboard for the league's current fantasy week (single Yahoo
   * call; the week arg is omitted so Yahoo returns the current week). Roto leagues
   * have no scoreboard, so `matchups` comes back empty. Only non-sensitive counts
   * are logged (see security rule).
   */
  async getLeagueMatchups(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueMatchupsResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const league = await yf.league.scoreboard(leagueId);
    const dto = mapScoreboardToDto(leagueId, league.scoreboard);

    console.warn(
      `[live] matchups: week=${dto.week} ${dto.matchups.length} matchups for league ${leagueId}`,
    );
    return dto;
  }

  /**
   * Unrostered (or waiver-available) players for a league, split into batting and
   * pitching tables. Availability is Yahoo's own `status` filter (FA/A) via the proven
   * players.leagues path; being unrostered IS the dedup (rostered players never carry
   * status=FA), and the UI further drops any FA whose player_key is already rostered.
   *
   * The batting and pitching tables are filled independently using Yahoo's position=B /
   * position=P meta-filters, each paged up to `limit` players (Yahoo caps a page at 25).
   * This fixes the old single-mixed-page behaviour, where one 25-row page split into
   * batters + pitchers could surface only a handful of hitters. A caller-pinned position
   * collapses to a single pool. A second call joins real scoring-category values by
   * player_key (the same path getPlayerStats uses). Cost: settings (1) + paged FA lists
   * (ceil(limit/25) per table) + one stats call per PLAYER_KEY_CHUNK players.
   */
  async getFreeAgents(
    tokens: YahooTokens,
    leagueId: string,
    query: FreeAgentsQuery,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueFreeAgentsResponse> {
    const { range, availability = 'FA', position, sortType = 'season', limit } = query;
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const settings = await yf.league.settings(leagueId);
    const cats = settings.settings?.stat_categories ?? [];
    const battingColumns = buildBattingStatColumns(cats);
    const pitchingColumns = buildPitchingStatColumns(cats);

    const perType = Math.min(Math.max(Math.trunc(limit ?? FREE_AGENT_LIMIT), 1), FREE_AGENT_MAX);
    const baseFilters: Record<string, string | number> = {
      status: availability,
      sort: 'AR',
      sort_type: sortType,
    };

    // Fill each table independently (Yahoo's position=B / position=P meta-filters) so a
    // pitcher-heavy free-agent pool never starves the hitter table. A caller-pinned
    // position yields a single pool, split by the player's own position_type.
    let rawBatters: YahooPlayer[];
    let rawPitchers: YahooPlayer[];
    if (position) {
      const pool = await fetchFreeAgentPool(yf, leagueId, { ...baseFilters, position }, perType);
      rawBatters = pool.filter((p) => p.position_type !== 'P');
      rawPitchers = pool.filter((p) => p.position_type === 'P');
    } else {
      [rawBatters, rawPitchers] = await Promise.all([
        fetchFreeAgentPool(yf, leagueId, { ...baseFilters, position: 'B' }, perType),
        fetchFreeAgentPool(yf, leagueId, { ...baseFilters, position: 'P' }, perType),
      ]);
    }

    // Join real scoring-category values via the proven league players/stats path.
    const playerKeys = [...rawBatters, ...rawPitchers]
      .map((p) => p.player_key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);
    const statChunks = await Promise.all(
      chunk(playerKeys, PLAYER_KEY_CHUNK).map((keys) =>
        yf.api<RawLeaguePlayersResponse>('GET', leaguePlayersStatsUrl(leagueId, keys, range)),
      ),
    );
    const statsByKey = new Map<string, Map<string, string | number>>();
    for (const raw of statChunks) {
      for (const [key, stats] of parseLeaguePlayerStatMap(raw)) statsByKey.set(key, stats);
    }

    const toLine = (p: YahooPlayer, columns: StatColumn[]): PlayerStatLine => {
      const byStatId = statsByKey.get(p.player_key);
      return {
        player: mapPlayerCore(p),
        // "-" is Yahoo's own placeholder for an unavailable value; keep columns aligned.
        stats: columns.map((col) => ({ key: col.key, value: byStatId?.get(col.key) ?? '-' })),
      };
    };
    const batting = rawBatters.map((p) => toLine(p, battingColumns));
    const pitching = rawPitchers.map((p) => toLine(p, pitchingColumns));

    console.warn(
      `[live] free-agents: league ${leagueId} status=${availability} range=${range} -> ` +
        `${batting.length} batters, ${pitching.length} pitchers`,
    );
    return leagueFreeAgentsResponseSchema.parse({
      leagueId,
      range,
      batting: { columns: battingColumns, players: batting },
      pitching: { columns: pitchingColumns, players: pitching },
    });
  }

  /**
   * Recent league transactions (adds, drops/waivers, trades), newest first and
   * bounded to `count`. Uses the raw transactions endpoint with a `;count=N` filter
   * (the library's league.transactions() is unfiltered and pulls the whole season).
   * Commissioner-only moves are dropped in the parser. Single Yahoo call; only
   * non-sensitive counts are logged (see security rule).
   */
  async getLeagueTransactions(
    tokens: YahooTokens,
    leagueId: string,
    count: number,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueTransactionsResponse> {
    const yf = createYahooClient(this.config, onTokensRefreshed);
    yf.setUserToken(tokens.accessToken);
    yf.setRefreshToken(tokens.refreshToken);

    const raw = await yf.api<RawLeagueTransactionsResponse>(
      'GET',
      leagueTransactionsUrl(leagueId, count),
    );
    const dto = parseLeagueTransactions(raw, leagueId, count);

    console.warn(`[live] transactions: ${dto.transactions.length} for league ${leagueId}`);
    return dto;
  }
}
