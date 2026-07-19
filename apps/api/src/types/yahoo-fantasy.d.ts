/**
 * Minimal ambient types for the `yahoo-fantasy` package (v5), which ships no types.
 * Only the surface this app uses is declared, matching the library's actual runtime
 * shapes (see node_modules/yahoo-fantasy/resources/*.mjs and helpers/*.mjs, plus the
 * captured responses in node_modules/yahoo-fantasy/tests/nock-data/*).
 */
declare module 'yahoo-fantasy' {
  export interface YahooTokenData {
    access_token: string;
    refresh_token: string;
    /** Access-token lifetime in seconds (Yahoo returns ~3600); used to compute expiry. */
    expires_in?: number;
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

  /* ---- rosters / players (team.roster, league.teams, league.players) ---- */

  export interface YahooManager {
    manager_id: string;
    nickname?: string;
    guid?: string;
    /** "1" on the manager belonging to the currently signed-in user. */
    is_current_login?: string | number;
    is_commissioner?: string | number;
    [key: string]: unknown;
  }

  export interface YahooTeamLogo {
    size?: string;
    url: string;
  }

  export interface YahooPlayerName {
    full: string;
    first?: string;
    last?: string;
    [key: string]: unknown;
  }

  export interface YahooPlayerHeadshot {
    url: string;
    size?: string;
  }

  export interface YahooPlayerStat {
    stat_id: string | number;
    value: string | number;
  }

  /** Post-mapping player_stats: coverage plus a flat list of {stat_id, value}. */
  export interface YahooPlayerStats {
    coverage_type: string;
    coverage_value?: string | number;
    stats: YahooPlayerStat[];
  }

  export interface YahooPlayer {
    player_key: string;
    player_id: string;
    name: YahooPlayerName;
    editorial_team_abbr?: string;
    display_position?: string;
    /** "B" for batters, "P" for pitchers. */
    position_type?: string;
    /** Injury/roster status when relevant, e.g. "DTD", "IL10", "NA". */
    status?: string;
    status_full?: string;
    /** Mapped to a flat string[] of positions by the library. */
    eligible_positions?: string[];
    /** Mapped to the started position string by the library. */
    selected_position?: string;
    player_stats?: YahooPlayerStats;
    /** Present when players are fetched with the `stats` collection sub-resource. */
    stats?: YahooPlayerStats;
    /** Player cutout image; `image_url` is the same URL in a flat field. */
    headshot?: YahooPlayerHeadshot | string;
    image_url?: string;
    [key: string]: unknown;
  }

  /** Win/loss/tie totals within a team's standings entry (head-to-head leagues). */
  export interface YahooOutcomeTotals {
    wins?: string | number;
    losses?: string | number;
    ties?: string | number;
    percentage?: string | number;
  }

  /** A team's standings entry, as carried on league.standings() results. */
  export interface YahooTeamStandings {
    rank?: string | number;
    outcome_totals?: YahooOutcomeTotals;
    games_back?: string | number;
    [key: string]: unknown;
  }

  export interface YahooTeam {
    team_key: string;
    team_id: string;
    name: string;
    managers?: YahooManager[];
    team_logos?: YahooTeamLogo[];
    is_owned_by_current_login?: string | number;
    /** Roster add/drop count for the season (present on standings results). */
    number_of_moves?: string | number;
    /** Trade count for the season (present on standings results). */
    number_of_trades?: string | number;
    /** Present on team.roster() / roster.players() results. */
    roster?: YahooPlayer[];
    /** Present on players.teams() results (the team's rostered players). */
    players?: YahooPlayer[];
    /** Present on league.standings() results (mapped onto each team). */
    standings?: YahooTeamStandings;
    /** Present on scoreboard matchup teams: `total` is categories won this week. */
    points?: YahooTeamPoints;
    [key: string]: unknown;
  }

  /** A team's weekly points block on a scoreboard matchup (head-to-head). */
  export interface YahooTeamPoints {
    coverage_type?: string;
    week?: string | number;
    /** Scoring categories the team currently leads this week. */
    total?: string | number;
  }

  /**
   * Per-category result within a matchup: which team leads (or tie) a single stat.
   * The yahoo-fantasy client unwraps Yahoo's `{ stat_winner: {...} }` envelope, so
   * each scoreboard `stat_winners` entry is this flat object.
   */
  export interface YahooStatWinner {
    stat_id?: string | number;
    winner_team_key?: string;
    is_tied?: string | number;
  }

  /** One head-to-head matchup on a league scoreboard (two teams with weekly points). */
  export interface YahooMatchup {
    week?: string | number;
    week_start?: string;
    week_end?: string;
    /** Yahoo lifecycle: "preevent", "midevent", or "postevent". */
    status?: string;
    is_playoffs?: string | number;
    is_tied?: string | number;
    winner_team_key?: string;
    /** One entry per scoring category with its current winner (or tie). */
    stat_winners?: YahooStatWinner[];
    teams: YahooTeam[];
    [key: string]: unknown;
  }

  /** Mapped `league.scoreboard` block: the week plus its matchups. */
  export interface YahooScoreboard {
    week?: string | number;
    matchups: YahooMatchup[];
    [key: string]: unknown;
  }

  export interface YahooLeagueWithScoreboard {
    league_key: string;
    league_id: string;
    name: string;
    season: string;
    scoring_type?: string;
    current_week?: string | number;
    scoreboard?: YahooScoreboard;
    [key: string]: unknown;
  }

  export interface YahooLeagueWithTeams {
    league_key: string;
    league_id: string;
    name: string;
    season: string;
    teams?: YahooTeam[];
    [key: string]: unknown;
  }

  export interface YahooStatCategory {
    stat_id: string | number;
    name: string;
    display_name: string;
    /** "B" for batting categories, "P" for pitching. */
    position_type?: string;
    sort_order?: string | number;
    is_only_display_stat?: string | number;
    [key: string]: unknown;
  }

  export interface YahooLeagueSettings {
    stat_categories?: YahooStatCategory[];
    [key: string]: unknown;
  }

  export interface YahooLeagueWithSettings {
    league_key: string;
    league_id: string;
    name: string;
    season: string;
    /** League meta carried on league[0]: the fantasy week bounds for weekly buckets. */
    current_week?: string | number;
    start_week?: string | number;
    end_week?: string | number;
    scoring_type?: string;
    settings?: YahooLeagueSettings;
    [key: string]: unknown;
  }

  export interface YahooLeagueWithPlayers {
    league_key: string;
    league_id: string;
    players?: YahooPlayer[];
    [key: string]: unknown;
  }

  export interface YahooLeagueWithStandings {
    league_key: string;
    league_id: string;
    name: string;
    season: string;
    scoring_type?: string;
    /** Teams ordered by the standings, each carrying its `standings` entry. */
    standings?: YahooTeam[];
    [key: string]: unknown;
  }

  export interface YahooUserGameTeams {
    game_key: string;
    teams?: YahooTeam[];
    [key: string]: unknown;
  }

  /**
   * Resolved value of user.game_teams(): the login user plus one entry per requested
   * game. Note the library assigns the mapped array to `teams` (unlike game_leagues,
   * which uses `games`); each entry then carries its own `teams` array.
   */
  export interface YahooUserTeamsResult {
    guid?: string;
    teams: YahooUserGameTeams[];
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
      cb?: (err: unknown, data: YahooUserTeamsResult) => void,
    ): Promise<YahooUserTeamsResult>;
  }

  interface LeagueResource {
    teams(
      leagueKey: string,
      cb?: (err: unknown, data: YahooLeagueWithTeams) => void,
    ): Promise<YahooLeagueWithTeams>;
    settings(
      leagueKey: string,
      cb?: (err: unknown, data: YahooLeagueWithSettings) => void,
    ): Promise<YahooLeagueWithSettings>;
    standings(
      leagueKey: string,
      cb?: (err: unknown, data: YahooLeagueWithStandings) => void,
    ): Promise<YahooLeagueWithStandings>;
    /**
     * Head-to-head scoreboard for a week (defaults to the current week when the
     * week arg is omitted). H2H leagues only; roto leagues have no scoreboard.
     */
    scoreboard(
      leagueKey: string,
      cb?: (err: unknown, data: YahooLeagueWithScoreboard) => void,
    ): Promise<YahooLeagueWithScoreboard>;
    scoreboard(
      leagueKey: string,
      week: string | number,
      cb?: (err: unknown, data: YahooLeagueWithScoreboard) => void,
    ): Promise<YahooLeagueWithScoreboard>;
    players(
      leagueKey: string,
      playerKeys: string | string[],
      cb?: (err: unknown, data: YahooLeagueWithPlayers) => void,
    ): Promise<YahooLeagueWithPlayers>;
  }

  interface TeamResource {
    roster(teamKey: string, cb?: (err: unknown, data: YahooTeam) => void): Promise<YahooTeam>;
  }

  interface RosterResource {
    /**
     * A team's roster for a given week or date (`YYYY-MM-DD`) with a sub-resource -
     * pass `'stats'` to populate each roster player's `player_stats` for that week.
     * The week/date must be a string so the library's parser routes it correctly.
     * URL: `team/{key}/roster;week=N/players/stats`.
     */
    players(
      teamKey: string,
      weekOrDate: string,
      subresource: string,
      cb?: (err: unknown, data: YahooTeam) => void,
    ): Promise<YahooTeam>;
  }

  /** Filters accepted by the players collection (sort, pagination, status, etc.). */
  type PlayersFilters = Record<string, string | number>;

  interface PlayersCollection {
    /**
     * Players eligible in the given league(s), with optional filters such as
     * `{ sort: 'AR', sort_type: 'season', start, count }`. Returns one entry per
     * league key, each carrying its `players` array in the requested sort order.
     */
    leagues(
      leagueKeys: string | string[],
      filters?: PlayersFilters,
      subresources?: string | string[],
      cb?: (err: unknown, data: YahooLeagueWithPlayers[]) => void,
    ): Promise<YahooLeagueWithPlayers[]>;
    /**
     * Rostered players for the given team(s). Pass `['stats']` as the sub-resource to
     * populate each player's season stats. Returns one entry per team, each carrying
     * its `players` array.
     */
    teams(
      teamKeys: string | string[],
      subresources?: string | string[],
      cb?: (err: unknown, data: YahooTeam[]) => void,
    ): Promise<YahooTeam[]>;
  }

  export default class YahooFantasy {
    constructor(
      consumerKey: string,
      consumerSecret: string,
      tokenCallbackFn?: TokenCallback,
      redirectUri?: string,
    );
    user: UserResource;
    league: LeagueResource;
    team: TeamResource;
    roster: RosterResource;
    players: PlayersCollection;
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
