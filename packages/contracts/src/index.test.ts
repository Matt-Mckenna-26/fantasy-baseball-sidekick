import { describe, it, expect } from 'vitest';
import {
  authStatusSchema,
  meLeaguesResponseSchema,
  leagueSummarySchema,
  apiErrorSchema,
  playerSchema,
  leagueRostersResponseSchema,
  playerStatsResponseSchema,
  chatRequestSchema,
  chatResponseSchema,
  teamStatsResponseSchema,
  leagueTeamStatsResponseSchema,
  leagueStandingsResponseSchema,
  leagueMatchupsResponseSchema,
  mlbGamesResponseSchema,
  playerGameKey,
  normalizePlayerName,
  isPitcherRosterSlot,
  inferPlayerPositionType,
} from './index.js';

describe('contracts schemas', () => {
  it('parses a valid league summary (with and without optional teamName)', () => {
    expect(leagueSummarySchema.parse({ leagueId: '1', name: 'A', season: '2026' })).toEqual({
      leagueId: '1',
      name: 'A',
      season: '2026',
    });
    const withTeam = leagueSummarySchema.parse({
      leagueId: '1',
      name: 'A',
      season: '2026',
      teamName: 'My Team',
    });
    expect(withTeam.teamName).toBe('My Team');
  });

  it('parses a valid me/leagues response', () => {
    const parsed = meLeaguesResponseSchema.parse({
      userGuid: 'GUID',
      leagues: [{ leagueId: '24281', name: 'FKL Baseball', season: '2026' }],
    });
    expect(parsed.leagues).toHaveLength(1);
  });

  it('rejects a me/leagues response with a malformed league', () => {
    expect(() =>
      meLeaguesResponseSchema.parse({ leagues: [{ leagueId: 1, name: 'A', season: '2026' }] }),
    ).toThrow();
  });

  it('parses auth status and api error envelopes', () => {
    expect(authStatusSchema.parse({ authenticated: true }).authenticated).toBe(true);
    expect(
      apiErrorSchema.parse({ error: { code: 'unauthorized', message: 'no' } }).error.code,
    ).toBe('unauthorized');
  });

  it('parses a player and rejects one missing eligiblePositions', () => {
    const player = playerSchema.parse({
      playerId: '10001',
      fullName: 'Aaron Judge',
      mlbTeamAbbr: 'NYY',
      eligiblePositions: ['OF', 'Util'],
      status: 'DTD',
    });
    expect(player.eligiblePositions).toContain('OF');
    expect(() => playerSchema.parse({ playerId: '1', fullName: 'X' })).toThrow();
  });

  it('parses a league rosters response with nested slots', () => {
    const parsed = leagueRostersResponseSchema.parse({
      leagueId: '24281',
      teams: [
        {
          teamId: '1',
          teamName: 'Bombers',
          slots: [
            {
              selectedPosition: 'OF',
              player: { playerId: '10001', fullName: 'Aaron Judge', eligiblePositions: ['OF'] },
            },
          ],
        },
      ],
    });
    expect(parsed.teams[0]?.slots[0]?.player.fullName).toBe('Aaron Judge');
  });

  it('parses a stats response with separate batting and pitching tables', () => {
    const parsed = playerStatsResponseSchema.parse({
      leagueId: '24281',
      batting: {
        columns: [
          { key: 'AVG', label: 'AVG' },
          { key: 'HR', label: 'HR' },
        ],
        players: [
          {
            player: { playerId: '10001', fullName: 'Aaron Judge', eligiblePositions: ['OF'] },
            stats: [
              { key: 'AVG', value: '.311' },
              { key: 'HR', value: 58 },
            ],
            overallRank: 1,
          },
        ],
      },
      pitching: {
        columns: [{ key: 'W', label: 'W' }],
        players: [
          {
            player: { playerId: '20002', fullName: 'Tarik Skubal', eligiblePositions: ['SP'] },
            stats: [{ key: 'W', value: 11 }],
          },
        ],
      },
    });
    expect(parsed.batting.columns).toHaveLength(2);
    expect(parsed.batting.players[0]?.stats[1]?.value).toBe(58);
    expect(parsed.batting.players[0]?.overallRank).toBe(1);
    expect(parsed.pitching.players[0]?.player.fullName).toBe('Tarik Skubal');
  });

  it('parses a team range-stats response and rejects an invalid range', () => {
    const parsed = teamStatsResponseSchema.parse({
      leagueId: '431.l.111',
      teamId: '3',
      range: 'last7',
      battingColumns: [{ key: 'HR', label: 'HR' }],
      pitchingColumns: [{ key: 'ERA', label: 'ERA' }],
      players: [
        {
          player: { playerId: '10001', fullName: 'Aaron Judge', eligiblePositions: ['OF'] },
          stats: [{ key: 'HR', value: 4 }],
        },
      ],
    });
    expect(parsed.range).toBe('last7');
    expect(parsed.battingColumns[0]?.key).toBe('HR');
    expect(parsed.players[0]?.stats[0]?.value).toBe(4);
    expect(() =>
      teamStatsResponseSchema.parse({
        leagueId: '1',
        teamId: '3',
        range: 'last14',
        battingColumns: [],
        pitchingColumns: [],
        players: [],
      }),
    ).toThrow();
  });

  it('parses a league team-stats response bucketed by week and rejects a bad bucket', () => {
    const parsed = leagueTeamStatsResponseSchema.parse({
      leagueId: '431.l.111',
      bucket: 14,
      weeks: [1, 2, 3, 14],
      battingColumns: [{ key: 'HR', label: 'HR' }],
      pitchingColumns: [{ key: 'ERA', label: 'ERA' }],
      teams: [
        {
          teamId: '1',
          teamName: 'Bronx Bombers',
          logoUrl: 'https://example.com/logo.png',
          stats: [
            { key: 'HR', value: 42 },
            { key: 'ERA', value: '3.21' },
          ],
        },
      ],
    });
    expect(parsed.bucket).toBe(14);
    expect(parsed.weeks).toContain(14);
    expect(parsed.teams[0]?.teamName).toBe('Bronx Bombers');
    expect(parsed.teams[0]?.stats[0]?.value).toBe(42);

    // 'season' is a valid bucket alongside week numbers.
    expect(
      leagueTeamStatsResponseSchema.parse({
        leagueId: '1',
        bucket: 'season',
        weeks: [],
        battingColumns: [],
        pitchingColumns: [],
        teams: [],
      }).bucket,
    ).toBe('season');

    expect(() =>
      leagueTeamStatsResponseSchema.parse({
        leagueId: '1',
        bucket: 'lastweek',
        weeks: [],
        battingColumns: [],
        pitchingColumns: [],
        teams: [],
      }),
    ).toThrow();
  });

  it('parses a multi-week window bucket with aggregatedWeeks', () => {
    const parsed = leagueTeamStatsResponseSchema.parse({
      leagueId: '431.l.111',
      bucket: 'last3weeks',
      weeks: [1, 2, 3, 4, 5],
      aggregatedWeeks: [3, 4, 5],
      battingColumns: [],
      pitchingColumns: [],
      teams: [],
    });
    expect(parsed.bucket).toBe('last3weeks');
    expect(parsed.aggregatedWeeks).toEqual([3, 4, 5]);
  });

  it('parses a standings response with optional result fields', () => {
    const parsed = leagueStandingsResponseSchema.parse({
      leagueId: '431.l.111',
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
        { teamId: '5', teamName: 'The Beetle Bunch' },
      ],
    });
    expect(parsed.teams).toHaveLength(2);
    expect(parsed.teams[0]?.rank).toBe(1);
    expect(parsed.teams[1]?.wins).toBeUndefined();
  });

  it('parses a matchups response with optional playoff/tie flags', () => {
    const parsed = leagueMatchupsResponseSchema.parse({
      leagueId: '431.l.111',
      week: 14,
      matchups: [
        {
          week: 14,
          status: 'midevent',
          weekStart: '2026-06-29',
          weekEnd: '2026-07-05',
          teams: [
            { teamId: '1', teamName: 'Bronx Bombers', categoriesWon: 6 },
            { teamId: '2', teamName: 'Windy City Heat', categoriesWon: 4 },
          ],
        },
      ],
    });
    expect(parsed.matchups).toHaveLength(1);
    expect(parsed.matchups[0]?.status).toBe('midevent');
    expect(parsed.matchups[0]?.isPlayoffs).toBeUndefined();
    expect(parsed.matchups[0]?.teams[0]?.categoriesWon).toBe(6);
  });

  it('rejects an unknown matchup status', () => {
    expect(() =>
      leagueMatchupsResponseSchema.parse({
        leagueId: 'l',
        week: 1,
        matchups: [{ week: 1, status: 'live', teams: [] }],
      }),
    ).toThrow();
  });

  it('normalizes player names for lineup matching', () => {
    expect(normalizePlayerName('J.T. Realmuto')).toBe('jt realmuto');
    expect(normalizePlayerName('Luis García Jr.')).toBe('luis garcia');
    expect(playerGameKey('NYY', 'Aaron Judge')).toBe('NYY|aaron judge');
    expect(playerGameKey('wsn', 'CJ Abrams')).toBe('WSN|cj abrams');
  });

  it('parses an MLB games response with live and scheduled games', () => {
    const parsed = mlbGamesResponseSchema.parse({
      date: '2026-07-04',
      games: [
        {
          gamePk: 745804,
          state: 'live',
          detail: 'In Progress',
          homeAbbr: 'NYY',
          awayAbbr: 'BOS',
          homeScore: 3,
          awayScore: 2,
          inning: 5,
          inningState: 'Top',
        },
        {
          gamePk: 745805,
          state: 'scheduled',
          detail: 'Scheduled',
          startTime: '2026-07-04T23:05:00Z',
          homeAbbr: 'LAD',
          awayAbbr: 'SF',
        },
      ],
    });
    expect(parsed.games).toHaveLength(2);
    expect(parsed.games[0]?.inningState).toBe('Top');
  });

  it('parses a chat request and response, rejecting empty message lists', () => {
    const req = chatRequestSchema.parse({
      leagueId: '24281',
      messages: [{ role: 'user', content: 'Who should I start at 2B?' }],
    });
    expect(req.messages).toHaveLength(1);
    expect(() => chatRequestSchema.parse({ messages: [] })).toThrow();

    const res = chatResponseSchema.parse({
      message: {
        id: 'm1',
        role: 'assistant',
        content: 'Start Player A.',
        createdAt: new Date().toISOString(),
      },
    });
    expect(res.message.role).toBe('assistant');
  });

  it('classifies BN/IL pitchers without treating IL/BN as batter positions', () => {
    expect(
      inferPlayerPositionType({
        eligiblePositions: ['IL', 'SP', 'P'],
      }),
    ).toBe('P');
    expect(
      inferPlayerPositionType({
        displayPosition: 'RP',
        eligiblePositions: ['IL'],
      }),
    ).toBe('P');
    expect(
      isPitcherRosterSlot({
        selectedPosition: 'BN',
        player: {
          playerId: '2',
          fullName: 'Tarik Skubal',
          eligiblePositions: ['BN', 'SP', 'P'],
        },
      }),
    ).toBe(true);
    expect(
      isPitcherRosterSlot({
        selectedPosition: 'IL',
        player: {
          playerId: '11',
          fullName: 'Injured Pitcher',
          eligiblePositions: ['IL'],
          positionType: 'P',
          status: 'IL60',
        },
      }),
    ).toBe(true);
    expect(
      isPitcherRosterSlot({
        selectedPosition: 'IL',
        player: {
          playerId: '10',
          fullName: 'Injured Hitter',
          eligiblePositions: ['IL'],
          positionType: 'B',
          status: 'IL10',
        },
      }),
    ).toBe(false);
  });
});
