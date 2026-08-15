import type { LeagueFreeAgentsResponse, PlayerStatsResponse, StatRange } from '@fcm/contracts';
import type { FantasyProvider, FreeAgentsQuery } from './fantasyProvider.js';
import type { YahooTokens } from './tokenStore.js';
import type { OnTokensRefreshed } from './yahooClient.js';
import { buildSgptModel } from './sgptRank.js';

/**
 * Free agents scored with Value+ against the ROSTERED pool, so a waiver target's sgptPlus /
 * sgptRank is directly comparable to the numbers rostered players already show (e.g. "this FA
 * would slot in around #45 among rostered players"). The rostered pool is pulled at the SAME
 * window as the free-agent query so the two are on one scale.
 *
 * `loadRostered` lets a caller reuse an already-cached rostered fetch (the chat tool shares
 * get_player_value's `${leagueId}:sgpt:${range}` cache entry); when omitted the pool is fetched
 * directly. Rostered players' own Value+ is unaffected - only the free-agent lines are scored.
 */
export async function getScoredFreeAgents(
  provider: FantasyProvider,
  tokens: YahooTokens,
  leagueId: string,
  query: FreeAgentsQuery,
  onRefresh?: OnTokensRefreshed,
  opts: { loadRostered?: (range: StatRange) => Promise<PlayerStatsResponse> } = {},
): Promise<LeagueFreeAgentsResponse> {
  const loadRostered =
    opts.loadRostered ?? ((range: StatRange) => provider.getPlayerStats(tokens, leagueId, range, onRefresh));

  const [rostered, freeAgents] = await Promise.all([
    loadRostered(query.range),
    provider.getFreeAgents(tokens, leagueId, query, onRefresh),
  ]);

  const scored = buildSgptModel(rostered).scoreExternal({
    leagueId: freeAgents.leagueId,
    batting: freeAgents.batting,
    pitching: freeAgents.pitching,
  });
  return { ...freeAgents, batting: scored.batting, pitching: scored.pitching };
}
