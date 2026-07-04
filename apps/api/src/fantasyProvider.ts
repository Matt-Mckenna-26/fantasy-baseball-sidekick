import { meLeaguesResponseSchema, type MeLeaguesResponse } from '@fcm/contracts';
import type { YahooUserGameLeaguesResult } from 'yahoo-fantasy';
import type { AppConfig } from './config.js';
import type { YahooTokens } from './tokenStore.js';
import { createYahooClient, type OnTokensRefreshed } from './yahooClient.js';

/**
 * Read-only access to a user's fantasy data. Keeps the app decoupled from Yahoo
 * specifics; a future MLB/other provider can implement the same interface.
 */
export interface FantasyProvider {
  getMyLeagues(
    tokens: YahooTokens,
    onTokensRefreshed?: OnTokensRefreshed,
  ): Promise<MeLeaguesResponse>;
}

/** Yahoo's MLB game code; used to scope league queries to baseball. */
const MLB_GAME_KEY = 'mlb';

/**
 * Pure mapping from the yahoo-fantasy `user.game_leagues` result to our DTO.
 * Exported for direct unit testing without touching the network or the library.
 */
export function mapUserLeaguesToDto(result: YahooUserGameLeaguesResult): MeLeaguesResponse {
  const games = Array.isArray(result.games) ? result.games : [];
  const leagues = games.flatMap((game) => {
    const gameLeagues = Array.isArray(game.leagues) ? game.leagues : [];
    return gameLeagues.map((league) => ({
      leagueId: league.league_id,
      name: league.name,
      season: league.season,
    }));
  });

  // Validate at the boundary so runtime and compile-time agree before returning.
  return meLeaguesResponseSchema.parse({ userGuid: result.guid, leagues });
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
    const result = await yf.user.game_leagues(MLB_GAME_KEY);
    return mapUserLeaguesToDto(result);
  }
}
