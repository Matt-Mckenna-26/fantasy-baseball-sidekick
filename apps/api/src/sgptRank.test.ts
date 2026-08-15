import { describe, it, expect } from 'vitest';
import type { PlayerStatsResponse } from '@fcm/contracts';
import { buildSgptModel, withSgptRank } from './sgptRank.js';

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
        players: [line('p1', 'Ace', { W: 15, ERA: 2.5 }), line('p2', 'Mid', { W: 9, ERA: 3.8 })],
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
        players: [line('p1', 'Low ERA', { ERA: 2.0 }), line('p2', 'High ERA', { ERA: 6.0 })],
      },
    };
    const out = withSgptRank(res);
    const low = out.pitching.players.find((p) => p.player.playerId === 'p1')!;
    const high = out.pitching.players.find((p) => p.player.playerId === 'p2')!;
    expect(low.sgptPlus!).toBeGreaterThan(high.sgptPlus!);
    expect(low.sgptRank!).toBeLessThan(high.sgptRank!);
  });

  it('does not score IP as a category (adding the IP column leaves Value+ unchanged)', () => {
    const withoutIp: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [{ key: 'ERA', label: 'ERA' }],
        players: [line('p1', 'Ace', { ERA: 2.0 }), line('p2', 'Back-end', { ERA: 4.0 })],
      },
    };
    const withIp: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [
          { key: 'ERA', label: 'ERA' },
          { key: 'IP', label: 'IP' },
        ],
        // Equal (qualifying) innings so both are scored; IP must not move the number.
        players: [
          line('p1', 'Ace', { ERA: 2.0, IP: 100 }),
          line('p2', 'Back-end', { ERA: 4.0, IP: 100 }),
        ],
      },
    };

    const a = withSgptRank(withoutIp).pitching.players;
    const b = withSgptRank(withIp).pitching.players;
    expect(b[0]!.sgptPlus).toBe(a[0]!.sgptPlus);
    expect(b[1]!.sgptPlus).toBe(a[1]!.sgptPlus);
  });

  it('uses IP as a minimum-innings gate: tiny samples are unranked, real relievers still score', () => {
    const res: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [
          { key: 'ERA', label: 'ERA' },
          { key: 'IP', label: 'IP' },
        ],
        players: [
          line('sp', 'Workhorse', { ERA: 3.0, IP: 200 }), // top IP → threshold = 40
          line('rp', 'Elite Closer', { ERA: 1.0, IP: 50 }), // above the gate, qualifies
          line('cup', 'Cup of Coffee', { ERA: 0.0, IP: 5 }), // below the gate, no Value+
        ],
      },
    };

    const out = withSgptRank(res).pitching.players;
    const sp = out.find((p) => p.player.playerId === 'sp')!;
    const rp = out.find((p) => p.player.playerId === 'rp')!;
    const cup = out.find((p) => p.player.playerId === 'cup')!;

    expect(cup.sgptPlus).toBeUndefined();
    expect(cup.sgptRank).toBeUndefined();
    expect(typeof sp.sgptPlus).toBe('number');
    // A dominant reliever (low ERA, IP not scored) outranks the average-ERA workhorse.
    expect(rp.sgptPlus!).toBeGreaterThan(sp.sgptPlus!);
    expect(rp.sgptRank!).toBe(1);
  });

  it('does not punish relievers for a role-exclusive cat they never accrue (adding QS=0 leaves Value+ unchanged)', () => {
    // Two relievers scored on shared skills + Saves. Neither throws Quality Starts.
    const withoutQs: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [
          { key: 'ERA', label: 'ERA' },
          { key: 'K', label: 'K' },
          { key: 'IP', label: 'IP' },
          { key: 'SV', label: 'SV' },
        ],
        players: [
          line('rp1', 'Elite Closer', { ERA: 2.0, K: 90, IP: 60, SV: 40 }),
          line('rp2', 'Back-end RP', { ERA: 4.0, K: 50, IP: 60, SV: 15 }),
        ],
      },
    };
    // Same relievers, but the league also scores Quality Starts - which neither reliever has.
    // A starter-only cat at 0 must be treated as N/A, not a bottom percentile, so it can't move
    // the relievers' Value+.
    const withQs: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [
          { key: 'ERA', label: 'ERA' },
          { key: 'K', label: 'K' },
          { key: 'IP', label: 'IP' },
          { key: 'SV', label: 'SV' },
          { key: 'QS', label: 'QS' },
        ],
        players: [
          line('rp1', 'Elite Closer', { ERA: 2.0, K: 90, IP: 60, SV: 40, QS: 0 }),
          line('rp2', 'Back-end RP', { ERA: 4.0, K: 50, IP: 60, SV: 15, QS: 0 }),
        ],
      },
    };

    const a = withSgptRank(withoutQs).pitching.players;
    const b = withSgptRank(withQs).pitching.players;
    expect(b[0]!.sgptPlus).toBe(a[0]!.sgptPlus);
    expect(b[1]!.sgptPlus).toBe(a[1]!.sgptPlus);
  });

  it('scores a role-exclusive cat only among pitchers who accrue it (a closer isn\u2019t buried by a starter\u2019s Saves=0)', () => {
    // A dominant closer (elite ERA + Saves) and an ace starter (elite ERA + Quality Starts).
    // Saves are percentiled among save-getters only, so the starter's SV=0 doesn't inflate the
    // closer's Saves percentile, and the closer's QS=0 doesn't sink them below the starter.
    const res: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [
          { key: 'ERA', label: 'ERA' },
          { key: 'IP', label: 'IP' },
          { key: 'SV', label: 'SV' },
          { key: 'QS', label: 'QS' },
        ],
        players: [
          line('closer', 'Shutdown Closer', { ERA: 1.5, IP: 60, SV: 38, QS: 0 }),
          line('starter', 'Ace Starter', { ERA: 3.2, IP: 190, SV: 0, QS: 20 }),
        ],
      },
    };

    const out = withSgptRank(res).pitching.players;
    const closer = out.find((p) => p.player.playerId === 'closer')!;
    const starter = out.find((p) => p.player.playerId === 'starter')!;

    // Both are scored (Saves/QS each have one participant), and the better-ERA closer isn't
    // dragged under the starter by a Quality-Starts floor.
    expect(typeof closer.sgptPlus).toBe('number');
    expect(typeof starter.sgptPlus).toBe('number');
    expect(closer.sgptPlus!).toBeGreaterThan(starter.sgptPlus!);
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

describe('buildSgptModel().scoreExternal (free agents vs the rostered pool)', () => {
  it('scores a free agent on the SAME scale as the rostered pool it was built from', () => {
    const rostered: PlayerStatsResponse = {
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
      pitching: { columns: [], players: [] },
    };
    const freeAgents: PlayerStatsResponse = {
      leagueId: 'L',
      batting: {
        columns: [
          { key: 'HR', label: 'HR' },
          { key: 'AVG', label: 'AVG' },
        ],
        // A FA whose line matches the best rostered hitter should score identically and rank #1.
        players: [line('fa1', 'Wire Slugger', { HR: 40, AVG: 0.32 })],
      },
      pitching: { columns: [], players: [] },
    };

    const model = buildSgptModel(rostered);
    const rosteredBest = withSgptRank(rostered).batting.players.find(
      (p) => p.player.playerId === 'b1',
    )!;
    const fa = model.scoreExternal(freeAgents).batting.players[0]!;

    expect(fa.sgptPlus).toBe(rosteredBest.sgptPlus);
    // Ranked against the rostered distribution: a top-tier line slots in at #1.
    expect(fa.sgptRank).toBe(1);
  });

  it('applies the rostered min-innings gate to free-agent pitchers (tiny samples unscored)', () => {
    const rostered: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [
          { key: 'ERA', label: 'ERA' },
          { key: 'IP', label: 'IP' },
        ],
        // Busiest arm throws 200 IP → gate = 40 IP.
        players: [
          line('sp', 'Workhorse', { ERA: 3.0, IP: 200 }),
          line('rp', 'Setup', { ERA: 2.5, IP: 60 }),
        ],
      },
    };
    const freeAgents: PlayerStatsResponse = {
      leagueId: 'L',
      batting: { columns: [], players: [] },
      pitching: {
        columns: [
          { key: 'ERA', label: 'ERA' },
          { key: 'IP', label: 'IP' },
        ],
        players: [
          line('faGood', 'Rosterable RP', { ERA: 1.8, IP: 50 }), // clears the 40-IP gate
          line('faTiny', 'Cup of Coffee', { ERA: 0.0, IP: 5 }), // below the gate → no Value+
        ],
      },
    };

    const out = buildSgptModel(rostered).scoreExternal(freeAgents).pitching.players;
    const good = out.find((p) => p.player.playerId === 'faGood')!;
    const tiny = out.find((p) => p.player.playerId === 'faTiny')!;

    expect(typeof good.sgptPlus).toBe('number');
    expect(tiny.sgptPlus).toBeUndefined();
    expect(tiny.sgptRank).toBeUndefined();
  });

  it('does not mutate the free-agent input', () => {
    const rostered: PlayerStatsResponse = {
      leagueId: 'L',
      batting: {
        columns: [{ key: 'HR', label: 'HR' }],
        players: [line('b1', 'Slugger', { HR: 30 }), line('b2', 'Scrub', { HR: 6 })],
      },
      pitching: { columns: [], players: [] },
    };
    const freeAgents: PlayerStatsResponse = {
      leagueId: 'L',
      batting: {
        columns: [{ key: 'HR', label: 'HR' }],
        players: [line('fa1', 'Wire Bat', { HR: 18 })],
      },
      pitching: { columns: [], players: [] },
    };

    const out = buildSgptModel(rostered).scoreExternal(freeAgents);
    expect(out.batting.players[0]!.sgptPlus).toBeDefined();
    // Original FA line is untouched.
    expect((freeAgents.batting.players[0] as { sgptPlus?: number }).sgptPlus).toBeUndefined();
  });
});
