import { describe, it, expect } from 'vitest';
import type { StatColumn } from '@fcm/contracts';
import { buildStatPercentiles, buildStatRanks } from './percentile';

const rows = [{ x: 0.1 }, { x: 0.2 }, { x: 0.3 }];

describe('percentile direction', () => {
  it('honors an explicit higherIsBetter:false over the label heuristic', () => {
    // Label "XBA" isn't in any heuristic set, so only the explicit flag decides direction.
    const col: StatColumn = { key: 'x', label: 'xBA', higherIsBetter: false };
    const pct = buildStatPercentiles(rows, [col], false).get('x')!;
    // Lower is better -> the smallest value is the hottest (highest percentile).
    expect(pct(0.1)).toBeGreaterThan(pct(0.3));
  });

  it('honors an explicit higherIsBetter:true over the label heuristic', () => {
    const col: StatColumn = { key: 'x', label: 'xBA', higherIsBetter: true };
    const pct = buildStatPercentiles(rows, [col], false).get('x')!;
    expect(pct(0.3)).toBeGreaterThan(pct(0.1));
  });

  it('ranks lowest value 1st when higherIsBetter:false', () => {
    const col: StatColumn = { key: 'x', label: 'BB/9', higherIsBetter: false };
    const rank = buildStatRanks(rows, [col], true).get('x')!;
    expect(rank(0.1)).toEqual({ rank: 1, total: 3 });
    expect(rank(0.3)).toEqual({ rank: 3, total: 3 });
  });

  it('falls back to the label heuristic when the flag is absent', () => {
    // ERA (pitching) is lower-is-better by the heuristic, with no explicit flag.
    const col: StatColumn = { key: 'x', label: 'ERA' };
    const pct = buildStatPercentiles(rows, [col], true).get('x')!;
    expect(pct(0.1)).toBeGreaterThan(pct(0.3));
  });
});
