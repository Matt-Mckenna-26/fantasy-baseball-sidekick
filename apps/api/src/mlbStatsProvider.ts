import {
  inferPlayerPositionType,
  type LeagueFreeAgentsResponse,
  type LeagueMatchupsResponse,
  type LeagueRostersResponse,
  type LeagueStandingsResponse,
  type LeagueTeamStatsResponse,
  type LeagueTransactionsResponse,
  type MeLeaguesResponse,
  type PlayerStatLine,
  type PlayerStatsResponse,
  type StatRange,
  type StatTable,
  type TeamStatBucket,
  type TeamStatsResponse,
  type TeamWeekStatsResponse,
} from '@fcm/contracts';
import type { FantasyProvider, FreeAgentsQuery } from './fantasyProvider.js';
import type { YahooTokens } from './tokenStore.js';
import type { OnTokensRefreshed } from './yahooClient.js';
import { buildMlbStatValues, type MlbStatPlayer, type StatGroup } from './mlbStats.js';

/**
 * A FantasyProvider decorator that keeps Yahoo as the source of player identity,
 * ownership, and season rank, but replaces the per-window stat VALUES in the player and
 * free-agent tables with numbers derived from the MLB Stats API. Every other method
 * delegates straight to the wrapped provider, so rosters, standings, matchups, team
 * stats, and transactions are unchanged. Because both the REST routes and the AI tools
 * receive this single provider, they get the MLB-derived values automatically.
 */
export class MlbStatsProvider implements FantasyProvider {
  constructor(private readonly base: FantasyProvider) {}

  // --- Delegated unchanged (Yahoo-owned) -----------------------------------

  getMyLeagues(tokens: YahooTokens, onTokensRefreshed?: OnTokensRefreshed): Promise<MeLeaguesResponse> {
    return this.base.getMyLeagues(tokens, onTokensRefreshed);
  }
  getLeagueRosters(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueRostersResponse> {
    return this.base.getLeagueRosters(tokens, leagueId, onTokensRefreshed);
  }
  getTeamWeekStats(
    tokens: YahooTokens,
    leagueId: string,
    teamId: string,
    week: number,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<TeamWeekStatsResponse> {
    return this.base.getTeamWeekStats(tokens, leagueId, teamId, week, onTokensRefreshed);
  }
  getLeagueTeamStats(
    tokens: YahooTokens,
    leagueId: string,
    bucket: TeamStatBucket,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueTeamStatsResponse> {
    return this.base.getLeagueTeamStats(tokens, leagueId, bucket, onTokensRefreshed);
  }
  getLeagueStandings(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueStandingsResponse> {
    return this.base.getLeagueStandings(tokens, leagueId, onTokensRefreshed);
  }
  getLeagueMatchups(
    tokens: YahooTokens,
    leagueId: string,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueMatchupsResponse> {
    return this.base.getLeagueMatchups(tokens, leagueId, onTokensRefreshed);
  }
  getLeagueTransactions(
    tokens: YahooTokens,
    leagueId: string,
    count: number,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueTransactionsResponse> {
    return this.base.getLeagueTransactions(tokens, leagueId, count, onTokensRefreshed);
  }

  // --- Overridden: MLB-derived stat values ---------------------------------

  async getPlayerStats(
    tokens: YahooTokens,
    leagueId: string,
    range: StatRange,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<PlayerStatsResponse> {
    // Yahoo can't serve 'last14'; the scaffolding (identity/owner/rank) is range-
    // independent, so fetch it at a Yahoo-serviceable range and overwrite the values.
    const scaffold = await this.base.getPlayerStats(
      tokens,
      leagueId,
      scaffoldRange(range),
      onTokensRefreshed,
    );
    const [batting, pitching] = await Promise.all([
      this.fillTable(scaffold.batting, 'hitting', range),
      this.fillTable(scaffold.pitching, 'pitching', range),
    ]);
    return { ...scaffold, batting, pitching };
  }

  async getTeamRangeStats(
    tokens: YahooTokens,
    leagueId: string,
    teamId: string,
    range: StatRange,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<TeamStatsResponse> {
    const scaffold = await this.base.getTeamRangeStats(
      tokens,
      leagueId,
      teamId,
      scaffoldRange(range),
      onTokensRefreshed,
    );
    // A roster mixes batters and pitchers in one list, each carrying only its own group's
    // columns. Classify by Yahoo position type, then derive hitting values for batters and
    // pitching values for pitchers (unknown -> both, e.g. two-way players).
    const groupOf = (l: PlayerStatLine): 'B' | 'P' | undefined =>
      inferPlayerPositionType({
        ...(l.player.positionType ? { positionType: l.player.positionType } : {}),
        eligiblePositions: l.player.eligiblePositions,
      });
    const groups = new Map(scaffold.players.map((l) => [l.player.playerId, groupOf(l)]));
    const toMlbPlayer = (l: PlayerStatLine) => ({
      playerId: l.player.playerId,
      fullName: l.player.fullName,
      ...(l.player.mlbTeamAbbr ? { mlbTeamAbbr: l.player.mlbTeamAbbr } : {}),
    });
    const [hitting, pitching] = await Promise.all([
      buildMlbStatValues({
        players: scaffold.players.filter((l) => groups.get(l.player.playerId) !== 'P').map(toMlbPlayer),
        columns: scaffold.battingColumns,
        group: 'hitting',
        range,
      }),
      buildMlbStatValues({
        players: scaffold.players.filter((l) => groups.get(l.player.playerId) !== 'B').map(toMlbPlayer),
        columns: scaffold.pitchingColumns,
        group: 'pitching',
        range,
      }),
    ]);
    const players = scaffold.players.map((l) => {
      const group = groups.get(l.player.playerId);
      const hv = hitting.byPlayerId.get(l.player.playerId) ?? [];
      const pv = pitching.byPlayerId.get(l.player.playerId) ?? [];
      const stats = group === 'P' ? pv : group === 'B' ? hv : [...hv, ...pv];
      return { ...l, stats };
    });
    return { ...scaffold, range, players };
  }

  async getFreeAgents(
    tokens: YahooTokens,
    leagueId: string,
    query: FreeAgentsQuery,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<LeagueFreeAgentsResponse> {
    const scaffold = await this.base.getFreeAgents(
      tokens,
      leagueId,
      { ...query, range: scaffoldRange(query.range) },
      onTokensRefreshed,
    );
    const [batting, pitching] = await Promise.all([
      this.fillTable(scaffold.batting, 'hitting', query.range),
      this.fillTable(scaffold.pitching, 'pitching', query.range),
    ]);
    // Report the requested window (the scaffold used a Yahoo-serviceable substitute).
    return { ...scaffold, range: query.range, batting, pitching };
  }

  /** Overwrite a table's per-player stat values with MLB-derived ones for the window. */
  private async fillTable(
    table: StatTable,
    group: StatGroup,
    range: StatRange,
  ): Promise<StatTable> {
    const players: MlbStatPlayer[] = table.players.map((l) => ({
      playerId: l.player.playerId,
      fullName: l.player.fullName,
      ...(l.player.mlbTeamAbbr ? { mlbTeamAbbr: l.player.mlbTeamAbbr } : {}),
    }));
    const { byPlayerId } = await buildMlbStatValues({
      players,
      columns: table.columns,
      group,
      range,
    });
    return {
      columns: table.columns,
      players: table.players.map((l) => ({
        ...l,
        stats: byPlayerId.get(l.player.playerId) ?? l.stats,
      })),
    };
  }
}

/** Yahoo has no native 14- or 21-day coverage, so use season scaffolding for those windows. */
function scaffoldRange(range: StatRange): StatRange {
  return range === 'last14' || range === 'last21' ? 'season' : range;
}
