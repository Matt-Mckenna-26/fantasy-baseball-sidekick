import { describe, it, expect } from 'vitest';
import type { PlayerStatsResponse } from '@fcm/contracts';
import { withSgptRank } from './sgptRank.js';

function line(playerId: string, fullName: string, stats: Record<string, number>) {
  return {
    player: { playerId, fullName, eligiblePositions: [] },
    stats: Object.entries(stats).map(([key, value]) => ({ key, value })),
  };
}

describe('withSgptRank', () => {
  it('indexes each pool to 100 = league average and ranks across hitters + pitchers', () => {
    const res: PlayerStatsResponse = {
      leagueId: 'L',
      batting: {
        columns: [
          { key: 'HR', label: 'HR' },
          { key: 'AVG', label: 'AVG' },
        ],
        players: [
          line('b1', 'Slugger', { HR: 40, AVG: 0.32 }),
          line('b2', 'Average Joe', { HR: 20, AVG: 0.27 }),
          line('b3', 'Scrub', { HR: 5, AVG: 0.22 }),
        ],
      },
      pitching: {
        columns: [
          { key: 'W', label: 'W' },
          { key: 'ERA', label: 'ERA' },
        ],
        players: [
          line('p1', 'Ace', { W: 15, ERA: 2.5 }),
          line('p2', 'Mid', { W: 9, ERA: 3.8 }),
        ],
      },
    };

    const out = withSgptRank(res);
    const batters = out.batting.players;
    const pitchers = out.pitching.players;

    // Every player got a score within their pool.
    for (const p of [...batters, ...pitchers]) {
      expect(typeof p.sgptPlus).toBe('number');
      expect(typeof p.sgptRank).toBe('number');
    }

    // The best hitter and best pitcher both index well above the 100 pool average.
    expect(batters[0]!.sgptPlus!).toBeGreaterThan(100);
    expect(batters[2]!.sgptPlus!).toBeLessThan(100);
    expect(pitchers[0]!.sgptPlus!).toBeGreaterThan(pitchers[1]!.sgptPlus!);

    // Cross-position rank is a single 1..N sequence spanning both pools.
    const ranks = [...batters, ...pitchers].map((p) => p.sgptRank!).sort((a, b) => a - b);
    expect(ranks[0]).toBe(1);
    expect(new Set(ranks).size).toBeGreaterThan(1);
  });

  it('inverts lower-is-better categories (a low ERA scores as elite)', () => {
    const res: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [{ key: 'ERA', label: 'ERA' }],
        players: [
          line('p1', 'Low ERA', { ERA: 2.0 }),
          line('p2', 'High ERA', { ERA: 6.0 }),
        ],
      },
    };
    const out = withSgptRank(res);
    const low = out.pitching.players.find((p) => p.player.playerId === 'p1')!;
    const high = out.pitching.players.find((p) => p.player.playerId === 'p2')!;
    expect(low.sgptPlus!).toBeGreaterThan(high.sgptPlus!);
    expect(low.sgptRank!).toBeLessThan(high.sgptRank!);
  });

  it('leaves players with no scored categories unscored and does not mutate the input', () => {
    const res: PlayerStatsResponse = {
      leagueId: 'L',
      batting: {
        columns: [{ key: 'HR', label: 'HR' }],
        players: [line('b1', 'Has HR', { HR: 10 }), line('b2', 'No Stats', {})],
      },
      pitching: { columns: [], players: [] },
    };
    const out = withSgptRank(res);
    expect(out.batting.players[0]!.sgptPlus).toBeDefined();
    expect(out.batting.players[1]!.sgptPlus).toBeUndefined();
    expect(out.batting.players[1]!.sgptRank).toBeUndefined();
    // Input untouched.
    expect((res.batting.players[0] as { sgptPlus?: number }).sgptPlus).toBeUndefined();
  });
});
