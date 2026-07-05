import { describe, it, expect } from 'vitest';
import type { LeagueTeamStatsResponse } from '@fcm/contracts';
import { buildTrendSeries, toNumericValue, trailingWeeks } from './teamTrend';

function weekResponse(
  week: number,
  teams: { teamId: string; teamName: string; stats: Record<string, string | number> }[],
): LeagueTeamStatsResponse {
  return {
    leagueId: '1',
    bucket: week,
    weeks: [1, 2, 3, 4, 5, 6, 7, 8],
    battingColumns: [{ key: 'HR', label: 'HR' }],
    pitchingColumns: [],
    teams: teams.map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      stats: Object.entries(t.stats).map(([key, value]) => ({ key, value })),
    })),
  };
}

describe('trailingWeeks', () => {
  it('returns the last N weeks in order', () => {
    expect(trailingWeeks([1, 2, 3, 4, 5, 6, 7, 8], 6)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it('returns all weeks when fewer than N exist', () => {
    expect(trailingWeeks([1, 2, 3], 6)).toEqual([1, 2, 3]);
  });

  it('returns nothing for a non-positive count', () => {
    expect(trailingWeeks([1, 2, 3], 0)).toEqual([]);
  });
});

describe('toNumericValue', () => {
  it('parses numbers and numeric strings', () => {
    expect(toNumericValue(5)).toBe(5);
    expect(toNumericValue('3.14')).toBe(3.14);
  });

  it('treats "-", blanks, non-numbers, and undefined as null', () => {
    expect(toNumericValue('-')).toBeNull();
    expect(toNumericValue('')).toBeNull();
    expect(toNumericValue('abc')).toBeNull();
    expect(toNumericValue(undefined)).toBeNull();
    expect(toNumericValue(Number.NaN)).toBeNull();
  });
});

describe('buildTrendSeries', () => {
  it('maps each week to per-team values for the chosen metric, sorted ascending', () => {
    const responses = [
      weekResponse(5, [
        { teamId: '1', teamName: 'Alpha', stats: { HR: 3 } },
        { teamId: '2', teamName: 'Beta', stats: { HR: 1 } },
      ]),
      weekResponse(4, [
        { teamId: '1', teamName: 'Alpha', stats: { HR: 2 } },
        { teamId: '2', teamName: 'Beta', stats: { HR: 4 } },
      ]),
    ];

    const series = buildTrendSeries(responses, 'HR', 5);

    expect(series.map((r) => r.week)).toEqual([4, 5]);
    expect(series[0]).toMatchObject({ week: 4, label: 'Wk 4', '1': 2, '2': 4 });
    expect(series[1]).toMatchObject({ week: 5, label: 'This wk', '1': 3, '2': 1 });
  });

  it('yields null for a team missing a value that week', () => {
    const responses = [
      weekResponse(1, [
        { teamId: '1', teamName: 'Alpha', stats: { HR: '-' } },
        { teamId: '2', teamName: 'Beta', stats: {} },
      ]),
    ];

    const series = buildTrendSeries(responses, 'HR');

    expect(series[0]!['1']).toBeNull();
    expect(series[0]!['2']).toBeNull();
  });

  it('ignores non-weekly (season/window) responses', () => {
    const seasonResponse: LeagueTeamStatsResponse = {
      ...weekResponse(1, [{ teamId: '1', teamName: 'Alpha', stats: { HR: 9 } }]),
      bucket: 'season',
    };

    expect(buildTrendSeries([seasonResponse], 'HR')).toEqual([]);
  });
});
