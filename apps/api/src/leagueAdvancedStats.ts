import type { PlayerStatLine, PlayerStatsResponse, StatColumn, StatTable } from '@fcm/contracts';
import type { FantasyProvider } from './fantasyProvider.js';
import type { OnTokensRefreshed } from './yahooClient.js';
import type { YahooTokens } from './tokenStore.js';
import {
  ADVANCED_HITTING_COLUMNS,
  ADVANCED_PITCHING_COLUMNS,
  buildAdvancedStatValues,
  type AdvancedStatPlayer,
} from './mlbAdvanced.js';
import { withSgptRank } from './sgptRank.js';
import { TtlCache } from './ai/cache.js';

/**
 * Builds a league-wide ADVANCED/expected stat table shaped exactly like the scoring
 * PlayerStatsResponse, so the Player Stats grid, compare card, and player-focus tiles can
 * reuse the same percentile pipeline. Yahoo still owns identity, ownership, and season rank
 * (carried straight through); only the per-column numbers are swapped for MLB expected stats.
 * Value+ is carried from the scoring scaffold (same numbers as the scoring grid), not recomputed
 * on advanced rates.
 *
 * Season-only by design: the MLB Stats API exposes expected/advanced splits per season, not
 * per rolling window (that is the right sample for a luck read anyway). Cached per league.
 */

/** Advanced stats are season-scoped and slow-changing; cache them per league for an hour. */
const ADVANCED_TTL_MS = 60 * 60 * 1000;
const cache = new TtlCache();

/** Merge rostered + free-agent lines for a group, deduped by playerId (rostered wins). */
function mergeLines(rostered: PlayerStatLine[], freeAgents: PlayerStatLine[]): PlayerStatLine[] {
  const byId = new Map<string, PlayerStatLine>();
  for (const line of rostered) byId.set(line.player.playerId, line);
  for (const line of freeAgents)
    if (!byId.has(line.player.playerId)) byId.set(line.player.playerId, line);
  return [...byId.values()];
}

async function buildGroupTable(
  columns: StatColumn[],
  lines: PlayerStatLine[],
  group: 'hitting' | 'pitching',
): Promise<StatTable> {
  const players: AdvancedStatPlayer[] = lines.map((l) => ({
    playerId: l.player.playerId,
    fullName: l.player.fullName,
    ...(l.player.mlbTeamAbbr ? { mlbTeamAbbr: l.player.mlbTeamAbbr } : {}),
  }));
  const advById = await buildAdvancedStatValues({ players, group });
  const blank = columns.map((c) => ({ key: c.key, value: '-' }));
  return {
    columns,
    players: lines.map((l) => ({
      player: l.player,
      stats: advById.get(l.player.playerId) ?? blank,
      ...(l.overallRank !== undefined ? { overallRank: l.overallRank } : {}),
      // Value+ sticks from the scoring scaffold (not recomputed on advanced rates).
      ...(l.sgptPlus !== undefined ? { sgptPlus: l.sgptPlus } : {}),
      ...(l.sgptRank !== undefined ? { sgptRank: l.sgptRank } : {}),
      ...(l.owner !== undefined ? { owner: l.owner } : {}),
      ...(l.ownerLogoUrl !== undefined ? { ownerLogoUrl: l.ownerLogoUrl } : {}),
    })),
  };
}

/**
 * Assemble the league's advanced stat table. Pulls the season scoring scaffold (rostered
 * leaders + free agents) for identity/rank/ownership/Value+, then fills advanced/expected values.
 * Free agents are folded in so the grid's "Free agents only" filter works in advanced mode.
 */
export async function buildLeagueAdvancedStats(
  provider: FantasyProvider,
  tokens: YahooTokens,
  leagueId: string,
  onRefresh?: OnTokensRefreshed,
): Promise<PlayerStatsResponse> {
  return cache.wrap(`adv:v2:${leagueId}`, ADVANCED_TTL_MS, async () => {
    const [rostered, freeAgents] = await Promise.all([
      provider.getPlayerStats(tokens, leagueId, 'season', onRefresh),
      provider
        .getFreeAgents(tokens, leagueId, { range: 'season', availability: 'A' }, onRefresh)
        .catch(() => undefined),
    ]);
    // Same Value+ numbers as the scoring grid (rostered pool), then merge FAs for the table.
    const scored = withSgptRank(rostered);
    const [batting, pitching] = await Promise.all([
      buildGroupTable(
        ADVANCED_HITTING_COLUMNS,
        mergeLines(scored.batting.players, freeAgents?.batting.players ?? []),
        'hitting',
      ),
      buildGroupTable(
        ADVANCED_PITCHING_COLUMNS,
        mergeLines(scored.pitching.players, freeAgents?.pitching.players ?? []),
        'pitching',
      ),
    ]);
    return { leagueId, batting, pitching };
  });
}
