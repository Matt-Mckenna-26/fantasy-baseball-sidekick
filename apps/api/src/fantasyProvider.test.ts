import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  YahooPlayer,
  YahooScoreboard,
  YahooStatCategory,
  YahooTeam,
  YahooUserGameLeaguesResult,
} from 'yahoo-fantasy';
import type { AppConfig } from './config.js';

vi.mock('./yahooClient.js', () => ({ createYahooClient: vi.fn() }));

import { createYahooClient } from './yahooClient.js';
import {
  buildBattingStatColumns,
  buildPitchingStatColumns,
  buildScoringColumns,
  mapPlayerStatLine,
  mapScoreboardToDto,
  mapStandingsToDto,
  mapTeamToRoster,
  mapUserLeaguesToDto,
  mapUserTeamsByLeague,
  parseLeaguePlayersStats,
  parseLeaguePlayerStatMap,
  parseLeagueTransactions,
  parseTeamStats,
  YahooFantasyProvider,
} from './fantasyProvider.js';
import { MockFantasyProvider } from './fantasyProvider.mock.js';

const config = {
  yahooClientId: 'id',
  yahooClientSecret: 'secret',
  yahooRedirectUri: 'https://localhost:5173/auth/yahoo/callback',
  webAppUrl: 'https://localhost:5173',
  sessionSecret: 'x'.repeat(16),
  port: 8787,
  dataMode: 'live',
  chatProvider: 'mock',
  azureOpenAiApiVersion: '2024-10-21',
} satisfies AppConfig;

const sampleResult: YahooUserGameLeaguesResult = {
  guid: 'GUID123',
  games: [
    {
      game_key: '431',
      game_id: '431',
      name: 'Baseball',
      code: 'mlb',
      season: '2026',
      leagues: [
        { league_key: '431.l.111', league_id: '111', name: 'FKL Baseball', season: '2026' },
        { league_key: '431.l.222', league_id: '222', name: 'Freddy Beach', season: '2026' },
      ],
    },
  ],
};

describe('mapUserLeaguesToDto', () => {
  it('flattens games -> leagues into the DTO', () => {
    expect(mapUserLeaguesToDto(sampleResult)).toEqual({
      userGuid: 'GUID123',
      leagues: [
        { leagueId: '431.l.111', name: 'FKL Baseball', season: '2026' },
        { leagueId: '431.l.222', name: 'Freddy Beach', season: '2026' },
      ],
    });
  });

  it('handles a result with no games or leagues', () => {
    expect(mapUserLeaguesToDto({ guid: 'G' } as YahooUserGameLeaguesResult)).toEqual({
      userGuid: 'G',
      leagues: [],
    });
  });

  it('attaches user team name and logo when provided', () => {
    const userTeams = new Map([
      [
        '431.l.111',
        { teamName: 'Bronx Bombers', logoUrl: 'https://example.com/logo.png' },
      ],
    ]);
    expect(mapUserLeaguesToDto(sampleResult, userTeams).leagues[0]).toEqual({
      leagueId: '431.l.111',
      name: 'FKL Baseball',
      season: '2026',
      teamName: 'Bronx Bombers',
      logoUrl: 'https://example.com/logo.png',
    });
  });
});

describe('mapUserTeamsByLeague', () => {
  it('maps team name and logo by league key', () => {
    expect(
      mapUserTeamsByLeague({
        teams: [
          {
            teams: [
              {
                team_key: '431.l.111.t.3',
                name: 'Bronx Bombers',
                team_logos: [{ url: 'https://example.com/logo.png' }],
              },
            ],
          },
        ],
      }),
    ).toEqual(
      new Map([
        ['431.l.111', { teamName: 'Bronx Bombers', logoUrl: 'https://example.com/logo.png' }],
      ]),
    );
  });
});

describe('YahooFantasyProvider.getMyLeagues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets tokens on the client and maps the response', async () => {
    const gameLeagues = vi.fn().mockResolvedValue(sampleResult);
    const gameTeams = vi.fn().mockResolvedValue({
      teams: [
        {
          teams: [
            {
              team_key: '431.l.111.t.3',
              name: 'Bronx Bombers',
              team_logos: [{ url: 'https://example.com/team.png' }],
            },
          ],
        },
      ],
    });
    const setUserToken = vi.fn();
    const setRefreshToken = vi.fn();
    vi.mocked(createYahooClient).mockReturnValue({
      setUserToken,
      setRefreshToken,
      user: { game_leagues: gameLeagues, game_teams: gameTeams },
    } as unknown as ReturnType<typeof createYahooClient>);

    const provider = new YahooFantasyProvider(config);
    const dto = await provider.getMyLeagues({ accessToken: 'a', refreshToken: 'r' });

    expect(setUserToken).toHaveBeenCalledWith('a');
    expect(setRefreshToken).toHaveBeenCalledWith('r');
    expect(gameLeagues).toHaveBeenCalledWith('mlb');
    expect(gameTeams).toHaveBeenCalledWith('mlb');
    expect(dto.leagues).toHaveLength(2);
    expect(dto.leagues[0]).toMatchObject({
      leagueId: '431.l.111',
      teamName: 'Bronx Bombers',
      logoUrl: 'https://example.com/team.png',
    });
    expect(dto.userGuid).toBe('GUID123');
  });
});

describe('YahooFantasyProvider.getFreeAgents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const cats: YahooStatCategory[] = [
    { stat_id: 7, name: 'Runs', display_name: 'R', position_type: 'B' },
    { stat_id: 28, name: 'Wins', display_name: 'W', position_type: 'P' },
  ];

  /** A library-mapped free-agent player (no `owner`, since FA are unrostered). */
  const fa = (key: string, name: string, positionType: 'B' | 'P'): YahooPlayer =>
    ({
      player_key: key,
      player_id: key.split('.').pop(),
      name: { full: name },
      editorial_team_abbr: 'NYY',
      position_type: positionType,
      eligible_positions: positionType === 'P' ? ['SP'] : ['OF'],
    }) as unknown as YahooPlayer;

  it('fills batting and pitching independently via position=B/P and pages each pool', async () => {
    const settings = vi.fn().mockResolvedValue({ settings: { stat_categories: cats } });
    // One full page (25) of the requested type on start=0, empty on the next page, so
    // both tables come back full even when the raw FA pool skews to one type.
    const leagues = vi.fn().mockImplementation((_leagueId: string, filters: { position?: string; start?: number }) => {
      if (filters.start !== 0) return Promise.resolve([{ players: [] }]);
      const type = filters.position === 'P' ? 'P' : 'B';
      const players = Array.from({ length: 25 }, (_, i) =>
        fa(`431.p.${type}${i}`, `${type} Player ${i}`, type as 'B' | 'P'),
      );
      return Promise.resolve([{ players }]);
    });
    const api = vi.fn().mockResolvedValue({});

    vi.mocked(createYahooClient).mockReturnValue({
      setUserToken: vi.fn(),
      setRefreshToken: vi.fn(),
      league: { settings },
      players: { leagues },
      api,
    } as unknown as ReturnType<typeof createYahooClient>);

    const provider = new YahooFantasyProvider(config);
    const dto = await provider.getFreeAgents({ accessToken: 'a', refreshToken: 'r' }, '431.l.111', {
      range: 'season',
    });

    // Separate B and P pools were requested (not one mixed page), status=FA, paged.
    const positionsRequested = leagues.mock.calls.map((c) => (c[1] as { position?: string }).position);
    expect(new Set(positionsRequested)).toEqual(new Set(['B', 'P']));
    expect(leagues.mock.calls.every((c) => (c[1] as { status?: string }).status === 'FA')).toBe(true);

    // Both tables are full (25 each) - the bug was ~4 hitters from a single mixed page.
    expect(dto.batting.players).toHaveLength(25);
    expect(dto.pitching.players).toHaveLength(25);
    // Free agents never carry an owner.
    expect(dto.batting.players.every((p) => !('owner' in p))).toBe(true);
  });

  it('collapses to a single pool when a position is pinned', async () => {
    const settings = vi.fn().mockResolvedValue({ settings: { stat_categories: cats } });
    const leagues = vi
      .fn()
      .mockImplementation((_leagueId: string, filters: { start?: number }) =>
        Promise.resolve([{ players: filters.start === 0 ? [fa('431.p.OF1', 'Some Outfielder', 'B')] : [] }]),
      );
    const api = vi.fn().mockResolvedValue({});

    vi.mocked(createYahooClient).mockReturnValue({
      setUserToken: vi.fn(),
      setRefreshToken: vi.fn(),
      league: { settings },
      players: { leagues },
      api,
    } as unknown as ReturnType<typeof createYahooClient>);

    const provider = new YahooFantasyProvider(config);
    const dto = await provider.getFreeAgents({ accessToken: 'a', refreshToken: 'r' }, '431.l.111', {
      range: 'season',
      position: 'OF',
    });

    // Pinned position => the caller's filter is passed straight through (no B/P fan-out).
    expect(leagues.mock.calls.every((c) => (c[1] as { position?: string }).position === 'OF')).toBe(true);
    expect(dto.batting.players).toHaveLength(1);
    expect(dto.pitching.players).toHaveLength(0);
  });
});

describe('YahooFantasyProvider.getTeamWeekStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requests the roster players/stats sub-resource for the week and maps the stat lines', async () => {
    const cats: YahooStatCategory[] = [
      { stat_id: 7, name: 'Runs', display_name: 'R', position_type: 'B' },
      { stat_id: 28, name: 'Wins', display_name: 'W', position_type: 'P' },
    ];
    const settings = vi.fn().mockResolvedValue({ settings: { stat_categories: cats } });
    // Library-mapped roster: each player carries position_type + player_stats.
    const players = vi.fn().mockResolvedValue({
      roster: [
        {
          player_key: '431.p.1',
          player_id: '1',
          name: { full: 'Aaron Judge' },
          editorial_team_abbr: 'NYY',
          position_type: 'B',
          eligible_positions: ['OF'],
          player_stats: {
            coverage_type: 'week',
            coverage_value: '14',
            stats: [{ stat_id: '7', value: '5' }],
          },
        },
      ],
    });
    vi.mocked(createYahooClient).mockReturnValue({
      setUserToken: vi.fn(),
      setRefreshToken: vi.fn(),
      league: { settings },
      roster: { players },
    } as unknown as ReturnType<typeof createYahooClient>);

    const provider = new YahooFantasyProvider(config);
    const dto = await provider.getTeamWeekStats(
      { accessToken: 'a', refreshToken: 'r' },
      '431.l.111',
      '3',
      14,
    );

    expect(players).toHaveBeenCalledWith('431.l.111.t.3', '14', 'stats');
    expect(dto.week).toBe(14);
    expect(dto.teamId).toBe('3');
    expect(dto.battingColumns).toEqual([{ key: '7', label: 'R', description: 'Runs', aggregatable: true }]);
    expect(dto.pitchingColumns).toEqual([{ key: '28', label: 'W', description: 'Wins', aggregatable: true }]);
    expect(dto.players).toEqual([
      {
        player: {
          playerId: '1',
          fullName: 'Aaron Judge',
          mlbTeamAbbr: 'NYY',
          eligiblePositions: ['OF'],
          positionType: 'B',
        },
        stats: [
          { key: '7', value: '5' },
          { key: '28', value: '-' },
        ],
      },
    ]);
  });

  it('returns an empty player list when the roster has no players', async () => {
    const settings = vi.fn().mockResolvedValue({ settings: { stat_categories: [] } });
    const players = vi.fn().mockResolvedValue({ roster: [] });
    vi.mocked(createYahooClient).mockReturnValue({
      setUserToken: vi.fn(),
      setRefreshToken: vi.fn(),
      league: { settings },
      roster: { players },
    } as unknown as ReturnType<typeof createYahooClient>);

    const provider = new YahooFantasyProvider(config);
    const dto = await provider.getTeamWeekStats(
      { accessToken: 'a', refreshToken: 'r' },
      '431.l.111',
      '3',
      14,
    );

    expect(players).toHaveBeenCalledWith('431.l.111.t.3', '14', 'stats');
    expect(dto.players).toEqual([]);
  });
});

// Shapes below mirror the library's post-mapping output (see
// node_modules/yahoo-fantasy/tests/nock-data/teamRoster.js + playerStats.js).
describe('mapTeamToRoster', () => {
  it('maps team meta, current-login manager, and roster slots', () => {
    const team: YahooTeam = {
      team_key: '431.l.111.t.3',
      team_id: '3',
      name: 'Bronx Bombers',
      managers: [
        { manager_id: '9', nickname: 'CommishBob', is_commissioner: '1' },
        { manager_id: '3', nickname: 'You', is_current_login: '1' },
      ],
      team_logos: [{ size: 'large', url: 'https://example.com/team.png' }],
      roster: [
        {
          player_key: '431.p.1',
          player_id: '1',
          name: { full: 'Aaron Judge' },
          editorial_team_abbr: 'nyy',
          position_type: 'B',
          eligible_positions: ['OF', 'Util'],
          selected_position: 'OF',
          status: 'DTD',
          image_url: 'https://s.yimg.com/xe/i/us/sp/v/mlb_cutout/players_l/10012020/9898.png',
        },
        {
          player_key: '431.p.2',
          player_id: '2',
          name: { full: 'Tarik Skubal' },
          editorial_team_abbr: 'DET',
          position_type: 'P',
          eligible_positions: ['SP', 'P'],
          selected_position: 'BN',
        },
      ],
    };

    expect(mapTeamToRoster(team)).toEqual({
      teamId: '3',
      teamName: 'Bronx Bombers',
      managerName: 'You',
      logoUrl: 'https://example.com/team.png',
      slots: [
        {
          selectedPosition: 'OF',
          player: {
            playerId: '1',
            fullName: 'Aaron Judge',
            mlbTeamAbbr: 'NYY',
            eligiblePositions: ['OF', 'Util'],
            positionType: 'B',
            status: 'DTD',
            headshotUrl: 'https://s.yimg.com/xe/i/us/sp/v/mlb_cutout/players_l/10012020/9898.png',
          },
        },
        {
          selectedPosition: 'BN',
          player: {
            playerId: '2',
            fullName: 'Tarik Skubal',
            mlbTeamAbbr: 'DET',
            eligiblePositions: ['SP', 'P'],
            positionType: 'P',
          },
        },
      ],
    });
  });

  it('defaults an empty roster and missing manager gracefully', () => {
    expect(mapTeamToRoster({ team_key: 'k', team_id: '1', name: 'Empty' })).toEqual({
      teamId: '1',
      teamName: 'Empty',
      slots: [],
    });
  });

  it('maps positionType for IL and bench slots so the UI can split batter/pitcher tables', () => {
    const team: YahooTeam = {
      team_key: '431.l.111.t.3',
      team_id: '3',
      name: 'Test',
      roster: [
        {
          player_key: '431.p.10',
          player_id: '10',
          name: { full: 'Injured Hitter' },
          position_type: 'B',
          selected_position: 'IL',
          eligible_positions: [],
          status: 'IL10',
        },
        {
          player_key: '431.p.11',
          player_id: '11',
          name: { full: 'Injured Pitcher' },
          position_type: 'P',
          selected_position: 'IL',
          eligible_positions: [],
          status: 'IL60',
        },
      ],
    };

    expect(mapTeamToRoster(team).slots).toEqual([
      {
        selectedPosition: 'IL',
        player: {
          playerId: '10',
          fullName: 'Injured Hitter',
          eligiblePositions: [],
          positionType: 'B',
          status: 'IL10',
        },
      },
      {
        selectedPosition: 'IL',
        player: {
          playerId: '11',
          fullName: 'Injured Pitcher',
          eligiblePositions: [],
          positionType: 'P',
          status: 'IL60',
        },
      },
    ]);
  });

  it('infers positionType from display_position when Yahoo omits position_type on IL/BN arms', () => {
    const team: YahooTeam = {
      team_key: '431.l.111.t.3',
      team_id: '3',
      name: 'Test',
      roster: [
        {
          player_key: '431.p.12',
          player_id: '12',
          name: { full: 'Bench Pitcher' },
          display_position: 'SP',
          selected_position: 'BN',
          eligible_positions: ['BN', 'SP', 'P'],
        },
        {
          player_key: '431.p.13',
          player_id: '13',
          name: { full: 'IL Pitcher' },
          display_position: 'RP',
          selected_position: 'IL',
          eligible_positions: ['IL'],
          status: 'IL60',
        },
      ],
    };

    expect(mapTeamToRoster(team).slots).toEqual([
      {
        selectedPosition: 'BN',
        player: {
          playerId: '12',
          fullName: 'Bench Pitcher',
          eligiblePositions: ['BN', 'SP', 'P'],
          positionType: 'P',
        },
      },
      {
        selectedPosition: 'IL',
        player: {
          playerId: '13',
          fullName: 'IL Pitcher',
          eligiblePositions: ['IL'],
          positionType: 'P',
          status: 'IL60',
        },
      },
    ]);
  });
});

describe('batting stats mapping', () => {
  const cats: YahooStatCategory[] = [
    { stat_id: 7, name: 'Runs', display_name: 'R', position_type: 'B' },
    { stat_id: 12, name: 'Home Runs', display_name: 'HR', position_type: 'B' },
    { stat_id: 3, name: 'Batting Average', display_name: 'AVG', position_type: 'B' },
    { stat_id: 28, name: 'Wins', display_name: 'W', position_type: 'P' },
  ];

  it('builds columns from batting categories only, flagging rate stats as non-aggregatable', () => {
    expect(buildBattingStatColumns(cats)).toEqual([
      { key: '7', label: 'R', description: 'Runs', aggregatable: true },
      { key: '12', label: 'HR', description: 'Home Runs', aggregatable: true },
      { key: '3', label: 'AVG', description: 'Batting Average', aggregatable: false },
    ]);
  });

  it('flags pitching rate stats (ERA, WHIP) as non-aggregatable', () => {
    const pitchingCats: YahooStatCategory[] = [
      { stat_id: 28, name: 'Wins', display_name: 'W', position_type: 'P' },
      { stat_id: 26, name: 'Earned Run Average', display_name: 'ERA', position_type: 'P' },
      { stat_id: 27, name: 'WHIP', display_name: 'WHIP', position_type: 'P' },
    ];
    expect(buildPitchingStatColumns(pitchingCats)).toEqual([
      { key: '28', label: 'W', description: 'Wins', aggregatable: true },
      { key: '26', label: 'ERA', description: 'Earned Run Average', aggregatable: false },
      { key: '27', label: 'WHIP', description: 'WHIP', aggregatable: false },
    ]);
  });

  it('aligns a player stat line to the columns, filling gaps with "-"', () => {
    const columns = buildBattingStatColumns(cats);
    const player: YahooPlayer = {
      player_key: '431.p.1',
      player_id: '1',
      name: { full: 'Aaron Judge' },
      editorial_team_abbr: 'NYY',
      eligible_positions: ['OF'],
      player_stats: {
        coverage_type: 'season',
        coverage_value: '2026',
        stats: [
          { stat_id: '7', value: '84' },
          { stat_id: '12', value: '34' },
          // AVG (stat_id 3) intentionally absent -> "-"
        ],
      },
    };

    expect(mapPlayerStatLine(player, columns)).toEqual({
      player: {
        playerId: '1',
        fullName: 'Aaron Judge',
        mlbTeamAbbr: 'NYY',
        eligiblePositions: ['OF'],
        positionType: 'B',
      },
      stats: [
        { key: '7', value: '84' },
        { key: '12', value: '34' },
        { key: '3', value: '-' },
      ],
    });
  });
});

// Range-stats path: scoring-column builder + raw players-collection parser. Shapes
// mirror node_modules/yahoo-fantasy/tests/nock-data/leagueSettings.js (post-mapping)
// and the raw players;.../stats collection returned by yf.api().
describe('buildScoringColumns', () => {
  it('keeps enabled batting + pitching categories and drops display-only stats', () => {
    const cats: YahooStatCategory[] = [
      {
        stat_id: 60,
        name: 'H/AB',
        display_name: 'H/AB',
        position_type: 'B',
        enabled: '1',
        is_only_display_stat: '1',
      },
      { stat_id: 7, name: 'Runs', display_name: 'R', position_type: 'B', enabled: '1' },
      { stat_id: 12, name: 'Home Runs', display_name: 'HR', position_type: 'B', enabled: '1' },
      {
        stat_id: 50,
        name: 'Innings Pitched',
        display_name: 'IP',
        position_type: 'P',
        enabled: '1',
        is_only_display_stat: '1',
      },
      { stat_id: 28, name: 'Wins', display_name: 'W', position_type: 'P', enabled: '1' },
    ];
    expect(buildScoringColumns(cats)).toEqual([
      { key: '7', label: 'R', description: 'Runs' },
      { key: '12', label: 'HR', description: 'Home Runs' },
      { key: '28', label: 'W', description: 'Wins' },
    ]);
  });
});

describe('parseLeaguePlayersStats', () => {
  const columns = [
    { key: '7', label: 'R' },
    { key: '12', label: 'HR' },
    { key: '3', label: 'AVG' },
  ];

  const raw = {
    fantasy_content: {
      league: [
        { league_key: '431.l.111' },
        {
          players: {
            count: 2,
            '0': {
              player: [
                [
                  { player_key: '431.p.1' },
                  { player_id: '1' },
                  { name: { full: 'Aaron Judge' } },
                  { editorial_team_abbr: 'NYY' },
                  { position_type: 'B' },
                  { eligible_positions: [{ position: 'OF' }, { position: 'Util' }] },
                  {
                    headshot: {
                      url: 'https://s.yimg.com/xe/i/us/sp/v/mlb_cutout/players_l/10012020/9898.png',
                      size: 'small',
                    },
                  },
                ],
                {
                  player_stats: {
                    stats: [
                      { stat: { stat_id: '7', value: '2' } },
                      { stat: { stat_id: '12', value: '1' } },
                    ],
                  },
                },
              ],
            },
            '1': {
              player: [
                [
                  { player_key: '431.p.2' },
                  { player_id: '2' },
                  { name: { full: 'Bobby Witt Jr.' } },
                  { editorial_team_abbr: 'kc' },
                  { position_type: 'B' },
                  { eligible_positions: [{ position: 'SS' }] },
                  { status: 'DTD' },
                ],
                { player_stats: { stats: [{ stat: { stat_id: '7', value: '3' } }] } },
              ],
            },
          },
        },
      ],
    },
  };

  it('maps each raw player onto the columns, uppercasing team + filling gaps with "-"', () => {
    expect(parseLeaguePlayersStats(raw, columns)).toEqual([
      {
        player: {
          playerId: '1',
          fullName: 'Aaron Judge',
          mlbTeamAbbr: 'NYY',
          eligiblePositions: ['OF', 'Util'],
          positionType: 'B',
          headshotUrl: 'https://s.yimg.com/xe/i/us/sp/v/mlb_cutout/players_l/10012020/9898.png',
        },
        stats: [
          { key: '7', value: '2' },
          { key: '12', value: '1' },
          { key: '3', value: '-' },
        ],
      },
      {
        player: {
          playerId: '2',
          fullName: 'Bobby Witt Jr.',
          mlbTeamAbbr: 'KC',
          eligiblePositions: ['SS'],
          positionType: 'B',
          status: 'DTD',
        },
        stats: [
          { key: '7', value: '3' },
          { key: '12', value: '-' },
          { key: '3', value: '-' },
        ],
      },
    ]);
  });

  it('returns an empty array when the collection is absent', () => {
    expect(parseLeaguePlayersStats({}, columns)).toEqual([]);
  });
});

// getPlayerStats joins rostered players to their stats by player_key using this map,
// built from the league players/stats collection. Tolerates a missing stats node.
describe('parseLeaguePlayerStatMap', () => {
  it('keys stats by player_key and tolerates a player missing its stats node', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '469.l.1' },
          {
            players: {
              count: 2,
              '0': {
                player: [
                  [{ player_key: '469.p.1' }, { player_id: '1' }],
                  {
                    player_stats: {
                      stats: [
                        { stat: { stat_id: '7', value: '2' } },
                        { stat: { stat_id: '12', value: '1' } },
                      ],
                    },
                  },
                ],
              },
              // Yahoo omitted the stats node for this player - must not throw.
              '1': {
                player: [[{ player_key: '469.p.2' }, { player_id: '2' }]],
              },
            },
          },
        ],
      },
    };

    const map = parseLeaguePlayerStatMap(raw as Parameters<typeof parseLeaguePlayerStatMap>[0]);
    expect(map.size).toBe(2);
    expect(map.get('469.p.1')?.get('7')).toBe('2');
    expect(map.get('469.p.1')?.get('12')).toBe('1');
    expect(map.get('469.p.2')?.size).toBe(0);
  });

  it('returns an empty map when the collection is absent', () => {
    expect(parseLeaguePlayerStatMap({}).size).toBe(0);
  });
});

// League team-stats path: align a team's aggregated totals onto the scoring columns.
// Shape mirrors node_modules/yahoo-fantasy/tests/nock-data/teamStats.js (raw yf.api()).
describe('parseTeamStats', () => {
  const columns = [
    { key: '7', label: 'R' },
    { key: '12', label: 'HR' },
    { key: '3', label: 'AVG' },
  ];

  const raw = {
    fantasy_content: {
      team: [
        [{ team_key: '431.l.111.t.1' }, { team_id: '1' }, { name: 'Bronx Bombers' }],
        {
          team_stats: {
            coverage_type: 'season',
            stats: [
              { stat: { stat_id: '7', value: '736' } },
              { stat: { stat_id: '12', value: '182' } },
              // AVG (stat_id 3) intentionally absent -> "-"
            ],
          },
        },
      ],
    },
  };

  it('aligns a team\'s totals onto the columns, filling gaps with "-"', () => {
    expect(parseTeamStats(raw as Parameters<typeof parseTeamStats>[0], columns)).toEqual([
      { key: '7', value: '736' },
      { key: '12', value: '182' },
      { key: '3', value: '-' },
    ]);
  });

  it('returns all "-" when the team_stats node is absent', () => {
    expect(parseTeamStats({}, columns)).toEqual([
      { key: '7', value: '-' },
      { key: '12', value: '-' },
      { key: '3', value: '-' },
    ]);
  });
});

// Standings path: map Yahoo's mapped league.standings teams to our DTO, by rank.
// Shape mirrors node_modules/yahoo-fantasy/tests/nock-data/leagueStandings.js.
describe('parseLeagueTransactions', () => {
  const raw = {
    fantasy_content: {
      league: [
        { league_key: '431.l.111' },
        {
          transactions: {
            count: 4,
            // Newest add/drop (out of timestamp order to prove we sort desc).
            '0': {
              transaction: [
                { transaction_key: '431.l.111.tr.10', transaction_id: '10', type: 'add/drop', status: 'successful', timestamp: '1700000200' },
                {
                  players: {
                    count: 2,
                    '0': {
                      player: [
                        [
                          { player_key: '431.p.1' },
                          { player_id: '1' },
                          { name: { full: 'Jon Lester' } },
                          { editorial_team_abbr: 'chc' },
                          { display_position: 'SP' },
                          { position_type: 'P' },
                        ],
                        { transaction_data: [{ type: 'add', source_type: 'freeagents', destination_type: 'team', destination_team_key: '431.l.111.t.7', destination_team_name: 'TNTNT' }] },
                      ],
                    },
                    '1': {
                      player: [
                        [
                          { player_key: '431.p.2' },
                          { player_id: '2' },
                          { name: { full: 'Chris Young' } },
                          { editorial_team_abbr: 'KC' },
                          { display_position: 'SP' },
                          { position_type: 'P' },
                        ],
                        { transaction_data: { type: 'drop', source_type: 'team', source_team_key: '431.l.111.t.7', source_team_name: 'TNTNT', destination_type: 'waivers' } },
                      ],
                    },
                  },
                },
              ],
            },
            // A trade (older timestamp, so it should sort after the add/drop).
            '1': {
              transaction: [
                { transaction_key: '431.l.111.tr.9', transaction_id: '9', type: 'trade', status: 'successful', timestamp: '1700000100' },
                {
                  players: {
                    count: 1,
                    '0': {
                      player: [
                        [
                          { player_key: '431.p.3' },
                          { player_id: '3' },
                          { name: { full: 'Dee Gordon' } },
                          { editorial_team_abbr: 'Mia' },
                          { display_position: '2B,SS' },
                          { position_type: 'B' },
                        ],
                        { transaction_data: [{ type: 'trade', source_type: 'team', source_team_name: 'Jose Abreu', destination_type: 'team', destination_team_name: 'Bronx Bombers' }] },
                      ],
                    },
                  },
                },
              ],
            },
            // A commissioner move that must be filtered out entirely.
            '2': {
              transaction: [
                { transaction_key: '431.l.111.tr.8', transaction_id: '8', type: 'commish', status: 'successful', timestamp: '1700000300' },
                { players: { count: 0 } },
              ],
            },
            // A plain add (oldest).
            '3': {
              transaction: [
                { transaction_key: '431.l.111.tr.7', transaction_id: '7', type: 'add', status: 'successful', timestamp: '1700000050' },
                {
                  players: {
                    count: 1,
                    '0': {
                      player: [
                        [
                          { player_key: '431.p.4' },
                          { player_id: '4' },
                          { name: { full: 'Vance Worley' } },
                          { editorial_team_abbr: 'Pit' },
                          { display_position: 'SP' },
                          { position_type: 'P' },
                        ],
                        { transaction_data: [{ type: 'add', source_type: 'freeagents', destination_type: 'team', destination_team_name: 'The Beetle Bunch' }] },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };

  it('maps transactions newest-first, drops commish, and maps player movement + teams', () => {
    const dto = parseLeagueTransactions(
      raw as Parameters<typeof parseLeagueTransactions>[0],
      '431.l.111',
      25,
    );
    expect(dto.leagueId).toBe('431.l.111');
    // commish is filtered out (4 raw -> 3 kept), sorted by timestamp desc.
    expect(dto.transactions.map((t) => t.transactionId)).toEqual(['10', '9', '7']);

    const addDrop = dto.transactions[0]!;
    expect(addDrop.type).toBe('add/drop');
    expect(addDrop.players).toEqual([
      {
        playerId: '1',
        fullName: 'Jon Lester',
        mlbTeamAbbr: 'CHC',
        displayPosition: 'SP',
        positionType: 'P',
        movement: 'add',
        destinationTeamName: 'TNTNT',
      },
      {
        playerId: '2',
        fullName: 'Chris Young',
        mlbTeamAbbr: 'KC',
        displayPosition: 'SP',
        positionType: 'P',
        movement: 'drop',
        sourceTeamName: 'TNTNT',
      },
    ]);

    const trade = dto.transactions[1]!;
    expect(trade.type).toBe('trade');
    expect(trade.players[0]).toMatchObject({
      movement: 'trade',
      sourceTeamName: 'Jose Abreu',
      destinationTeamName: 'Bronx Bombers',
    });
  });

  it('honours the limit after filtering', () => {
    const dto = parseLeagueTransactions(
      raw as Parameters<typeof parseLeagueTransactions>[0],
      '431.l.111',
      1,
    );
    expect(dto.transactions).toHaveLength(1);
    expect(dto.transactions[0]!.transactionId).toBe('10');
  });

  it('returns an empty list when the collection is absent', () => {
    expect(parseLeagueTransactions({}, 'l', 25)).toEqual({ leagueId: 'l', transactions: [] });
  });
});

describe('MockFantasyProvider.getLeagueTransactions', () => {
  it('returns schema-valid transactions capped to count, newest first', async () => {
    const provider = new MockFantasyProvider();
    const dto = await provider.getLeagueTransactions({ accessToken: 'a', refreshToken: 'r' }, 'l', 3);
    expect(dto.transactions).toHaveLength(3);
    const timestamps = dto.transactions.map((t) => t.timestamp);
    expect([...timestamps]).toEqual([...timestamps].sort((a, b) => b - a));
    expect(dto.transactions.some((t) => t.type === 'trade')).toBe(true);
  });
});

describe('mapStandingsToDto', () => {
  it('maps rank, W/L/T, win %, games back, moves and orders by rank', () => {
    const teams: YahooTeam[] = [
      {
        team_key: '328.l.34014.t.5',
        team_id: '5',
        name: 'The Beetle Bunch',
        number_of_moves: '31',
        team_logos: [{ size: 'large', url: 'https://example.com/5.png' }],
        managers: [{ manager_id: '5', nickname: 'Beetle', is_current_login: '1' }],
        standings: {
          rank: 2,
          outcome_totals: { wins: '107', losses: '99', ties: '14', percentage: '.518' },
          games_back: '26.5',
        },
      },
      {
        team_key: '328.l.34014.t.4',
        team_id: '4',
        name: 'Jose Abreu',
        number_of_moves: '31',
        standings: {
          rank: 1,
          outcome_totals: { wins: '134', losses: '73', ties: '13', percentage: '.639' },
          games_back: '-',
        },
      },
    ];

    expect(mapStandingsToDto('328.l.34014', teams)).toEqual({
      leagueId: '328.l.34014',
      teams: [
        {
          teamId: '4',
          teamName: 'Jose Abreu',
          rank: 1,
          wins: 134,
          losses: 73,
          ties: 13,
          winPercentage: '.639',
          gamesBack: '-',
          moves: 31,
        },
        {
          teamId: '5',
          teamName: 'The Beetle Bunch',
          logoUrl: 'https://example.com/5.png',
          managerName: 'Beetle',
          rank: 2,
          wins: 107,
          losses: 99,
          ties: 14,
          winPercentage: '.518',
          gamesBack: '26.5',
          moves: 31,
        },
      ],
    });
  });

  it('omits optional fields when Yahoo does not provide standings (pre-season)', () => {
    const teams: YahooTeam[] = [{ team_key: 'k', team_id: '1', name: 'No Standings Yet' }];
    expect(mapStandingsToDto('l', teams)).toEqual({
      leagueId: 'l',
      teams: [{ teamId: '1', teamName: 'No Standings Yet' }],
    });
  });
});

describe('mapScoreboardToDto', () => {
  it('maps a matchup with per-team categories won, status flags, and logos', () => {
    const scoreboard: YahooScoreboard = {
      week: '14',
      matchups: [
        {
          week: '14',
          week_start: '2026-06-29',
          week_end: '2026-07-05',
          status: 'midevent',
          is_playoffs: '0',
          is_tied: '0',
          teams: [
            {
              team_key: 'l.t.1',
              team_id: '1',
              name: 'Bronx Bombers',
              team_logos: [{ size: 'large', url: 'https://example.com/1.png' }],
              points: { coverage_type: 'week', week: '14', total: '6' },
            },
            {
              team_key: 'l.t.2',
              team_id: '2',
              name: 'Windy City Heat',
              points: { coverage_type: 'week', week: '14', total: '4' },
            },
          ],
        },
      ],
    };

    expect(mapScoreboardToDto('328.l.34014', scoreboard)).toEqual({
      leagueId: '328.l.34014',
      week: 14,
      matchups: [
        {
          week: 14,
          status: 'midevent',
          weekStart: '2026-06-29',
          weekEnd: '2026-07-05',
          teams: [
            {
              teamId: '1',
              teamName: 'Bronx Bombers',
              logoUrl: 'https://example.com/1.png',
              categoriesWon: 6,
              categoriesLost: 4,
              categoriesTied: 0,
            },
            {
              teamId: '2',
              teamName: 'Windy City Heat',
              categoriesWon: 4,
              categoriesLost: 6,
              categoriesTied: 0,
            },
          ],
        },
      ],
    });
  });

  it('derives per-team category wins/losses/ties from stat_winners (incl. ties)', () => {
    const scoreboard: YahooScoreboard = {
      week: '14',
      matchups: [
        {
          week: '14',
          status: 'midevent',
          // The yahoo-fantasy client unwraps each `{ stat_winner: {...} }` entry.
          stat_winners: [
            { stat_id: '7', winner_team_key: 'l.t.1' },
            { stat_id: '8', winner_team_key: 'l.t.1' },
            { stat_id: '9', winner_team_key: 'l.t.1' },
            { stat_id: '10', winner_team_key: 'l.t.1' },
            { stat_id: '11', winner_team_key: 'l.t.1' },
            { stat_id: '12', winner_team_key: 'l.t.1' },
            { stat_id: '13', winner_team_key: 'l.t.2' },
            { stat_id: '14', winner_team_key: 'l.t.2' },
            { stat_id: '15', is_tied: '1' },
            { stat_id: '16', is_tied: '1' },
          ],
          teams: [
            {
              team_key: 'l.t.1',
              team_id: '1',
              name: 'Bronx Bombers',
              // Yahoo's points.total (6) intentionally disagrees; stat_winners wins.
              points: { coverage_type: 'week', week: '14', total: '6' },
            },
            {
              team_key: 'l.t.2',
              team_id: '2',
              name: 'Windy City Heat',
              points: { coverage_type: 'week', week: '14', total: '2' },
            },
          ],
        },
      ],
    };

    const dto = mapScoreboardToDto('l', scoreboard);
    expect(dto.matchups[0]?.teams).toEqual([
      { teamId: '1', teamName: 'Bronx Bombers', categoriesWon: 6, categoriesLost: 2, categoriesTied: 2 },
      { teamId: '2', teamName: 'Windy City Heat', categoriesWon: 2, categoriesLost: 6, categoriesTied: 2 },
    ]);
  });

  it('maps per-category stat winners to teamId (or a tie flag), keyed by stat_id', () => {
    const scoreboard: YahooScoreboard = {
      week: '14',
      matchups: [
        {
          week: '14',
          status: 'midevent',
          stat_winners: [
            { stat_id: '7', winner_team_key: 'l.t.1' },
            { stat_id: '13', winner_team_key: 'l.t.2' },
            { stat_id: '15', is_tied: '1' },
          ],
          teams: [
            { team_key: 'l.t.1', team_id: '1', name: 'Bronx Bombers' },
            { team_key: 'l.t.2', team_id: '2', name: 'Windy City Heat' },
          ],
        },
      ],
    };

    expect(mapScoreboardToDto('l', scoreboard).matchups[0]?.statWinners).toEqual([
      { statKey: '7', winnerTeamId: '1' },
      { statKey: '13', winnerTeamId: '2' },
      { statKey: '15', isTied: true },
    ]);
  });

  it('omits statWinners when Yahoo provides none', () => {
    const scoreboard: YahooScoreboard = {
      week: '14',
      matchups: [
        {
          week: '14',
          status: 'midevent',
          teams: [
            { team_key: 'l.t.1', team_id: '1', name: 'A' },
            { team_key: 'l.t.2', team_id: '2', name: 'B' },
          ],
        },
      ],
    };

    expect(mapScoreboardToDto('l', scoreboard).matchups[0]?.statWinners).toBeUndefined();
  });

  it('flags playoff/tied matchups and defaults missing points to zero', () => {
    const scoreboard: YahooScoreboard = {
      week: 20,
      matchups: [
        {
          status: 'preevent',
          is_playoffs: '1',
          is_tied: '1',
          teams: [
            { team_key: 'l.t.3', team_id: '3', name: 'A' },
            { team_key: 'l.t.4', team_id: '4', name: 'B' },
          ],
        },
      ],
    };

    expect(mapScoreboardToDto('l', scoreboard)).toEqual({
      leagueId: 'l',
      week: 20,
      matchups: [
        {
          week: 20,
          status: 'preevent',
          isPlayoffs: true,
          isTied: true,
          teams: [
            { teamId: '3', teamName: 'A', categoriesWon: 0, categoriesLost: 0, categoriesTied: 0 },
            { teamId: '4', teamName: 'B', categoriesWon: 0, categoriesLost: 0, categoriesTied: 0 },
          ],
        },
      ],
    });
  });

  it('returns an empty scoreboard for leagues with no matchups (roto/offseason)', () => {
    expect(mapScoreboardToDto('l', undefined)).toEqual({ leagueId: 'l', week: 0, matchups: [] });
  });
});
