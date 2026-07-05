import { describe, it, expect } from 'vitest';
import type { LeagueTeamStatsResponse, StatColumn } from '@fcm/contracts';
import { pickWeekStatLeaders } from './statLeaders';

const BATTING: StatColumn[] = [
  { key: 'HR', label: 'HR' },
  { key: 'AVG', label: 'AVG' },
];
const PITCHING: StatColumn[] = [
  { key: 'W', label: 'W' },
  { key: 'ERA', label: 'ERA' },
  { key: 'WHIP', label: 'WHIP' },
  { key: 'IP', label: 'IP' },
];

function team(
  teamId: string,
  values: Record<string, number | string>,
): LeagueTeamStatsResponse['teams'][number] {
  return {
    teamId,
    teamName: `Team ${teamId}`,
    stats: Object.entries(values).map(([key, value]) => ({ key, value })),
  };
}

function response(teams: LeagueTeamStatsResponse['teams']): LeagueTeamStatsResponse {
  return {
    leagueId: 'L',
    bucket: 14,
    weeks: [14],
    battingColumns: BATTING,
    pitchingColumns: PITCHING,
    teams,
  };
}

/** Deterministic rng so selection is reproducible across runs (not an identity shuffle). */
const noShuffle = () => 0;

describe('pickWeekStatLeaders', () => {
  it('emits an even hot/cold split of best- and worst-in-category tiles', () => {
    const data = response([
      team('1', { HR: 5, AVG: '.300', W: 2, ERA: '3.50' }),
      team('2', { HR: 9, AVG: '.250', W: 4, ERA: '2.10' }),
    ]);
    const tiles = pickWeekStatLeaders(data, 2, noShuffle);
    expect(tiles.filter((t) => t.tone === 'hot')).toHaveLength(2);
    expect(tiles.filter((t) => t.tone === 'cold')).toHaveLength(2);
    // Each category appears at most once across all tiles.
    expect(new Set(tiles.map((t) => t.statKey)).size).toBe(tiles.length);
  });

  it('hot picks the best team and cold the worst for higher-is-better stats', () => {
    const data = response([team('1', { HR: 5 }), team('2', { HR: 9 })]);
    const tiles = pickWeekStatLeaders(data, 1, noShuffle);
    const hr = tiles.filter((t) => t.statKey === 'HR');
    expect(hr.find((t) => t.tone === 'hot')).toMatchObject({ teamId: '2', value: '9' });
  });

  it('inverts lower-is-better pitching stats (best value is hot, worst is cold)', () => {
    // Team 2 has the lower (better) ERA and WHIP, so it is the hot pick for whichever
    // of the two a tile lands on; team 1 (higher = worse) is the cold pick.
    const data = response([
      team('1', { ERA: '4.20', WHIP: '1.40' }),
      team('2', { ERA: '2.75', WHIP: '1.10' }),
    ]);
    const tiles = pickWeekStatLeaders(data, 1, noShuffle);
    for (const tile of tiles) {
      expect(tile.teamId).toBe(tile.tone === 'hot' ? '2' : '1');
    }
    expect(tiles).toHaveLength(2);
  });

  it('never chooses the IP category', () => {
    const data = response([
      team('1', { HR: 5, AVG: '.300', W: 2, ERA: '3.50', IP: '40.0' }),
      team('2', { HR: 9, AVG: '.250', W: 4, ERA: '2.10', IP: '52.1' }),
    ]);
    const tiles = pickWeekStatLeaders(data, 3, noShuffle);
    expect(tiles.some((t) => t.statKey === 'IP')).toBe(false);
  });

  it('skips categories without at least two comparable values', () => {
    const data = response([
      team('1', { HR: 5, AVG: '-', W: 2, ERA: '-' }),
      team('2', { HR: 9, AVG: '-', W: 4, ERA: '-' }),
    ]);
    const keys = new Set(pickWeekStatLeaders(data, 3, noShuffle).map((t) => t.statKey));
    expect(keys).toEqual(new Set(['HR', 'W']));
  });

  it('carries the leading team logo through when present', () => {
    const withLogo = {
      ...team('2', { HR: 9 }),
      logoUrl: 'https://example.com/logo.png',
    };
    const data = response([team('1', { HR: 5 }), withLogo]);
    const hot = pickWeekStatLeaders(data, 1, noShuffle).find((t) => t.tone === 'hot');
    expect(hot).toMatchObject({ teamId: '2', logoUrl: 'https://example.com/logo.png' });
  });
});
