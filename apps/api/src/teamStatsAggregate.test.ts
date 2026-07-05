import { describe, it, expect } from 'vitest';
import type { StatColumn, StatValue } from '@fcm/contracts';
import { aggregateWeeklyTeamStats, resolveWindowWeeks } from './teamStatsAggregate.js';

describe('resolveWindowWeeks', () => {
  it('takes the most-recent N weeks (and all of them when fewer exist)', () => {
    expect(resolveWindowWeeks([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
    expect(resolveWindowWeeks([1, 2], 4)).toEqual([1, 2]);
    expect(resolveWindowWeeks([1, 2, 3], 0)).toEqual([]);
    expect(resolveWindowWeeks([], 2)).toEqual([]);
  });
});

describe('aggregateWeeklyTeamStats', () => {
  const columns: StatColumn[] = [
    { key: 'R', label: 'R', aggregatable: true },
    { key: 'AVG', label: 'AVG', aggregatable: false },
    { key: 'ERA', label: 'ERA', aggregatable: false },
    { key: '60', label: 'H/AB', aggregatable: true },
    { key: '50', label: 'IP', aggregatable: true },
  ];

  it('sums counting stats, averages rates, and handles ratios and innings', () => {
    const weekly: StatValue[][] = [
      [
        { key: 'R', value: '10' },
        { key: 'AVG', value: '.300' },
        { key: 'ERA', value: '3.00' },
        { key: '60', value: '10/40' },
        { key: '50', value: '12.1' },
      ],
      [
        { key: 'R', value: '20' },
        { key: 'AVG', value: '.200' },
        { key: 'ERA', value: '5.00' },
        { key: '60', value: '5/20' },
        { key: '50', value: '6.2' },
      ],
    ];

    expect(aggregateWeeklyTeamStats(weekly, columns)).toEqual([
      { key: 'R', value: '30' }, // summed
      { key: 'AVG', value: '.250' }, // averaged, leading-dot style preserved
      { key: 'ERA', value: '4.00' }, // averaged to 2 decimals
      { key: '60', value: '15/60' }, // ratio summed component-wise
      { key: '50', value: '19.0' }, // innings summed in thirds (12.1 + 6.2 = 19.0)
    ]);
  });

  it('ignores missing weekly values and returns "-" when a stat is absent every week', () => {
    const cols: StatColumn[] = [
      { key: 'HR', label: 'HR', aggregatable: true },
      { key: 'SB', label: 'SB', aggregatable: true },
      { key: 'K', label: 'K', aggregatable: true },
    ];
    const weekly: StatValue[][] = [
      [
        { key: 'HR', value: '-' },
        { key: 'SB', value: '2' },
      ],
      [
        { key: 'HR', value: '3' },
        { key: 'SB', value: '-' },
      ],
    ];

    expect(aggregateWeeklyTeamStats(weekly, cols)).toEqual([
      { key: 'HR', value: '3' },
      { key: 'SB', value: '2' },
      { key: 'K', value: '-' },
    ]);
  });
});
