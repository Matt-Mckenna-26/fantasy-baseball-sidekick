/**
 * Minimal ambient types for the `yahoo-fantasy` package (v5), which ships no types.
 * Only the surface this app uses is declared, matching the library's actual runtime
 * shapes (see node_modules/yahoo-fantasy/YahooFantasy.mjs and userResource.mjs).
 */
declare module 'yahoo-fantasy' {
  export interface YahooTokenData {
    access_token: string;
    refresh_token: string;
  }

  type TokenCallback = (data: YahooTokenData) => void | Promise<void>;

  /** Structural subset of an Express Response used by auth(). */
  interface AuthResponseLike {
    redirect(url: string): void;
    send(body: unknown): void;
  }

  /** Structural subset of an Express Request used by authCallback(). */
  interface AuthRequestLike {
    query: Record<string, unknown>;
  }

  /** A league as returned (post-mapping) by user.game_leagues(). */
  export interface YahooUserLeague {
    league_key: string;
    league_id: string;
    name: string;
    season: string;
    num_teams?: number;
    [key: string]: unknown;
  }

  /** A game with its leagues, as returned by user.game_leagues(). */
  export interface YahooUserGameWithLeagues {
    game_key: string;
    game_id: string;
    name: string;
    code: string;
    season: string;
    leagues: YahooUserLeague[];
    [key: string]: unknown;
  }

  /** Resolved value of user.game_leagues(): the login user plus their games/leagues. */
  export interface YahooUserGameLeaguesResult {
    guid: string;
    games: YahooUserGameWithLeagues[];
    [key: string]: unknown;
  }

  interface UserResource {
    games(cb?: (err: unknown, data: unknown) => void): Promise<unknown>;
    game_leagues(
      gameKeys: string | string[],
      cb?: (err: unknown, data: YahooUserGameLeaguesResult) => void,
    ): Promise<YahooUserGameLeaguesResult>;
    game_teams(
      gameKeys: string | string[],
      cb?: (err: unknown, data: unknown) => void,
    ): Promise<unknown>;
  }

  export default class YahooFantasy {
    constructor(
      consumerKey: string,
      consumerSecret: string,
      tokenCallbackFn?: TokenCallback,
      redirectUri?: string,
    );
    user: UserResource;
    auth(res: AuthResponseLike, state?: string | null): void;
    authCallback(
      req: AuthRequestLike,
      cb: (
        err: unknown,
        data?: { access_token: string; refresh_token: string; state?: string },
      ) => void,
    ): void;
    setUserToken(token: string): void;
    setRefreshToken(token: string): void;
    refreshToken(cb: (err: unknown, data?: YahooTokenData) => void): void;
    api<T = unknown>(method: string, url: string, postData?: unknown): Promise<T>;
  }
}
