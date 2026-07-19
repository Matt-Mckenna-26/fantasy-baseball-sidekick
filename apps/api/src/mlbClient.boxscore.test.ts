import { describe, it, expect } from 'vitest';
import { mapBoxScore } from './mlbClient.js';

const raw = {
  teams: {
    home: {
      team: { name: 'Kansas City Royals', abbreviation: 'KC' },
      teamStats: { batting: { runs: 5, hits: 11 }, fielding: { errors: 0 } },
      batters: [672580, 677951],
      pitchers: [425844],
      players: {
        ID672580: {
          person: { fullName: 'Maikel Garcia' },
          position: { abbreviation: '3B' },
          battingOrder: '100',
          stats: {
            batting: { atBats: 4, runs: 0, hits: 0, rbi: 0, homeRuns: 0, baseOnBalls: 0, strikeOuts: 1 },
          },
          seasonStats: { batting: { avg: '.272' } },
        },
        // A substitute who entered in the 2 spot ("201" -> slot 2).
        ID677951: {
          person: { fullName: 'Bobby Witt Jr.' },
          position: { abbreviation: 'SS' },
          battingOrder: '201',
          stats: {
            batting: { atBats: 5, runs: 2, hits: 3, rbi: 1, homeRuns: 1, baseOnBalls: 0, strikeOuts: 1 },
          },
          seasonStats: { batting: { avg: '.311' } },
        },
        ID425844: {
          person: { fullName: 'Zack Greinke' },
          position: { abbreviation: 'P' },
          stats: {
            pitching: {
              note: '(W, 2-15)',
              inningsPitched: '5.0',
              hits: 4,
              runs: 1,
              earnedRuns: 1,
              baseOnBalls: 2,
              strikeOuts: 2,
              homeRuns: 0,
            },
          },
          seasonStats: { pitching: { era: '5.06' } },
        },
      },
    },
    away: {
      team: { name: 'Detroit Tigers', abbreviation: 'DET' },
      teamStats: { batting: { runs: 1, hits: 4 }, fielding: { errors: 1 } },
      batters: [],
      pitchers: [664199],
      players: {
        // A reliever with a save note ("S" -> "SV").
        ID664199: {
          person: { fullName: 'Some Closer' },
          position: { abbreviation: 'P' },
          stats: {
            pitching: {
              note: '(S, 12)',
              inningsPitched: '1.0',
              hits: 0,
              runs: 0,
              earnedRuns: 0,
              baseOnBalls: 0,
              strikeOuts: 2,
              homeRuns: 0,
            },
          },
          seasonStats: { pitching: { era: '2.10' } },
        },
      },
    },
  },
};

describe('mapBoxScore', () => {
  it('maps batters and pitchers in order with season rate stats', () => {
    const box = mapBoxScore(raw, 745804);
    expect(box.gamePk).toBe(745804);

    expect(box.home.teamAbbr).toBe('KC');
    expect(box.home.teamName).toBe('Kansas City Royals');
    expect(box.home.runs).toBe(5);
    expect(box.home.hits).toBe(11);
    expect(box.home.errors).toBe(0);

    expect(box.home.batters).toHaveLength(2);
    expect(box.home.batters[0]).toMatchObject({
      fullName: 'Maikel Garcia',
      position: '3B',
      battingOrder: 1,
      ab: 4,
      so: 1,
      avg: '.272',
    });
    // "201" collapses to lineup slot 2.
    expect(box.home.batters[1]?.battingOrder).toBe(2);
    expect(box.home.batters[1]?.hr).toBe(1);

    expect(box.home.pitchers[0]).toMatchObject({
      fullName: 'Zack Greinke',
      decision: 'W',
      ip: '5.0',
      er: 1,
      so: 2,
      era: '5.06',
    });
  });

  it('normalizes save/hold decisions and tolerates empty batter lists', () => {
    const box = mapBoxScore(raw, 1);
    expect(box.away.batters).toHaveLength(0);
    expect(box.away.errors).toBe(1);
    expect(box.away.pitchers[0]?.decision).toBe('SV');
  });

  it('omits battingOrder when the slot code is missing or out of range', () => {
    const box = mapBoxScore(
      {
        teams: {
          home: {
            team: { name: 'Test', abbreviation: 'NYY' },
            batters: [1],
            pitchers: [],
            players: {
              ID1: {
                person: { fullName: 'Pinch Runner' },
                stats: { batting: { atBats: 0, runs: 0, hits: 0, rbi: 0, homeRuns: 0, baseOnBalls: 0, strikeOuts: 0 } },
              },
            },
          },
        },
      },
      2,
    );
    expect(box.home.batters[0]?.battingOrder).toBeUndefined();
  });
});
