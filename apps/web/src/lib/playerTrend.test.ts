import { describe, it, expect } from 'vitest';
import type { PlayerStatsResponse, StatRange } from '@fcm/contracts';
import { buildPlayerTrendSeries, type PlayerStatsByRange } from './playerTrend';

function statsResponse(
  batters: { id: string; name: string; stats: Record<string, string | number> }[],
): PlayerStatsResponse {
  return {
    leagueId: '1',
    batting: {
      columns: [{ key: 'HR', label: 'HR' }],
      players: batters.map((b) => ({
        player: { playerId: b.id, fullName: b.name, eligiblePositions: ['OF'] },
        stats: Object.entries(b.stats).map(([key, value]) => ({ key, value })),
      })),
    },
    pitching: { columns: [], players: [] },
  };
}

function byRange(entries: Partial<Record<StatRange, PlayerStatsResponse>>): PlayerStatsByRange {
  return entries;
}

describe('buildPlayerTrendSeries', () => {
  it('plots Last 30 -> Last 7 percentiles and season as a separate baseline', () => {
    // A four-player pool so percentiles are distinct: best -> ~88th, worst -> ~13th.
    const pool = (values: Record<string, number>) =>
      statsResponse([
        { id: 'p1', name: 'Alpha', stats: { HR: values.p1! } },
        { id: 'p2', name: 'Beta', stats: { HR: values.p2! } },
        { id: 'x1', name: 'Filler1', stats: { HR: values.x1! } },
        { id: 'x2', name: 'Filler2', stats: { HR: values.x2! } },
      ]);
    const cache = byRange({
      season: pool({ p1: 40, p2: 10, x1: 20, x2: 30 }),
      last30: pool({ p1: 8, p2: 6, x1: 1, x2: 2 }),
      last7: pool({ p1: 1, p2: 9, x1: 2, x2: 3 }),
    });

    const { rows, seasonBaseline } = buildPlayerTrendSeries(cache, 'batting', 'HR', ['p1', 'p2'], false);

    // Line covers only the recent windows, oldest -> newest.
    expect(rows.map((r) => r.label)).toEqual(['Last 30', 'Last 7']);
    // p1 leads last30 (top of pool) then drops to the bottom in last7.
    expect(rows[0]!.p1).toBe(88);
    expect(rows[1]!.p1).toBe(13);
    // p2 sits second in last30 then leads in last7 (heating up).
    expect(rows[0]!.p2).toBe(63);
    expect(rows[1]!.p2).toBe(88);
    // Season is a separate baseline (p1 best -> 88th, p2 worst -> 13th).
    expect(seasonBaseline.p1).toBe(88);
    expect(seasonBaseline.p2).toBe(13);
  });

  it('yields null for a selected player missing a value, and no baseline without season', () => {
    const cache = byRange({
      last7: statsResponse([
        { id: 'p1', name: 'Alpha', stats: { HR: '-' } },
        { id: 'p2', name: 'Beta', stats: { HR: 5 } },
      ]),
    });

    const { rows, seasonBaseline } = buildPlayerTrendSeries(
      cache,
      'batting',
      'HR',
      ['p1', 'missing'],
      false,
    );

    expect(rows.map((r) => r.label)).toEqual(['Last 7']);
    expect(rows[0]!.p1).toBeNull();
    expect(rows[0]!.missing).toBeNull();
    expect(seasonBaseline.p1).toBeUndefined();
  });
});
