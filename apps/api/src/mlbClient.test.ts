import { describe, it, expect } from 'vitest';
import { mapScheduleToGames, normalizeTeamAbbr } from './mlbClient.js';
import { playerGameKey } from '@fcm/contracts';

// Trimmed capture of the real statsapi.mlb.com schedule payload (hydrate=team,linescore),
// covering a final, a live, and a scheduled game plus an abbreviation that needs
// normalizing (MLB "WSH" -> Yahoo "WAS").
const sample = {
  dates: [
    {
      games: [
        {
          gamePk: 777245,
          gameDate: '2026-07-04T15:05:00Z',
          status: { abstractGameState: 'Final', detailedState: 'Final' },
          teams: {
            away: {
              score: 11,
              team: { abbreviation: 'BOS' },
              probablePitcher: { id: 678394, fullName: 'Brayan Bello' },
            },
            home: {
              score: 2,
              team: { abbreviation: 'WSH' },
              probablePitcher: { id: 647336, fullName: 'Michael Soroka' },
            },
          },
          linescore: { currentInning: 9, inningState: 'Bottom' },
          lineups: {
            homePlayers: [
              { id: 682928, fullName: 'CJ Abrams' },
              { id: 695578, fullName: 'James Wood' },
            ],
            awayPlayers: [
              { id: 680776, fullName: 'Jarren Duran' },
              { id: 701350, fullName: 'Roman Anthony' },
              { id: 647351, fullName: 'Abraham Toro' },
            ],
          },
        },
        {
          gamePk: 777300,
          gameDate: '2026-07-04T23:10:00Z',
          status: { abstractGameState: 'Live', detailedState: 'In Progress' },
          teams: {
            away: { score: 2, team: { abbreviation: 'NYY' } },
            home: { score: 3, team: { abbreviation: 'TB' } },
          },
          linescore: { currentInning: 5, inningState: 'Top' },
        },
        {
          gamePk: 777400,
          gameDate: '2026-07-05T00:40:00Z',
          status: { abstractGameState: 'Preview', detailedState: 'Scheduled' },
          teams: {
            away: { team: { abbreviation: 'AZ' } },
            home: { team: { abbreviation: 'LAD' } },
          },
        },
      ],
    },
  ],
};

describe('normalizeTeamAbbr', () => {
  it('canonicalizes MLB aliases to the Yahoo convention', () => {
    expect(normalizeTeamAbbr('AZ')).toBe('ARI');
    expect(normalizeTeamAbbr('wsh')).toBe('WAS');
    expect(normalizeTeamAbbr('NYY')).toBe('NYY');
  });
});

describe('mapScheduleToGames', () => {
  it('maps final/live/scheduled games with normalized abbreviations', () => {
    const result = mapScheduleToGames(sample, '2026-07-04');
    expect(result.date).toBe('2026-07-04');
    expect(result.games).toHaveLength(3);

    const [final, live, scheduled] = result.games;
    expect(final).toMatchObject({
      gamePk: 777245,
      state: 'final',
      detail: 'Final',
      awayAbbr: 'BOS',
      homeAbbr: 'WAS',
      awayScore: 11,
      homeScore: 2,
      probablePitchers: [
        playerGameKey('BOS', 'Brayan Bello'),
        playerGameKey('WSH', 'Michael Soroka'),
      ],
      battingOrder: {
        [playerGameKey('WSH', 'CJ Abrams')]: 1,
        [playerGameKey('WSH', 'James Wood')]: 2,
        [playerGameKey('BOS', 'Jarren Duran')]: 1,
        [playerGameKey('BOS', 'Roman Anthony')]: 2,
        [playerGameKey('BOS', 'Abraham Toro')]: 3,
      },
    });
    // Inning info is dropped for non-live games.
    expect(final?.inning).toBeUndefined();

    expect(live).toMatchObject({
      state: 'live',
      awayAbbr: 'NYY',
      homeAbbr: 'TB',
      inning: 5,
      inningState: 'Top',
    });

    expect(scheduled).toMatchObject({
      state: 'scheduled',
      detail: 'Scheduled',
      awayAbbr: 'ARI',
      homeAbbr: 'LAD',
      startTime: '2026-07-05T00:40:00Z',
    });
    expect(scheduled?.homeScore).toBeUndefined();
  });

  it('skips games missing a gamePk or team abbreviations', () => {
    const partial = {
      dates: [
        {
          games: [
            {
              gamePk: 1,
              status: {},
              teams: { away: { team: {} }, home: { team: { abbreviation: 'NYY' } } },
            },
          ],
        },
      ],
    };
    expect(mapScheduleToGames(partial, '2026-07-04').games).toHaveLength(0);
  });
});
