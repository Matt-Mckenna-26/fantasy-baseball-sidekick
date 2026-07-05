import { describe, it, expect } from 'vitest';
import type { RosterSlot, StatColumn, StatValue } from '@fcm/contracts';
import { computeRosterTotals, NO_TOTAL } from './rosterTotals';

function slot(playerId: string): RosterSlot {
  return {
    selectedPosition: 'Util',
    player: { playerId, fullName: `Player ${playerId}`, eligiblePositions: ['Util'] },
  };
}

const columns: StatColumn[] = [
  { key: 'HR', label: 'HR', aggregatable: true },
  { key: 'R', label: 'R', aggregatable: true },
  { key: 'AVG', label: 'AVG', aggregatable: false },
  { key: '60', label: 'H/AB', aggregatable: true },
];

const battingRateColumns: StatColumn[] = [
  { key: '3', label: 'AVG', aggregatable: false },
  { key: '4', label: 'OBP', aggregatable: false },
  { key: '5', label: 'SLG', aggregatable: false },
  { key: '55', label: 'OPS', aggregatable: false },
  { key: '60', label: 'H/AB', aggregatable: true },
  { key: '18', label: 'BB', aggregatable: true },
];

const pitchingRateColumns: StatColumn[] = [
  { key: '26', label: 'ERA', aggregatable: false },
  { key: '27', label: 'WHIP', aggregatable: false },
  { key: '50', label: 'IP', aggregatable: true },
];

function statsByPlayer(
  entries: Record<string, Record<string, StatValue['value']>>,
): Map<string, Map<string, StatValue['value']>> {
  return new Map(Object.entries(entries).map(([id, stats]) => [id, new Map(Object.entries(stats))]));
}

describe('computeRosterTotals', () => {
  it('sums counting stats and dashes rate stats without H/AB', () => {
    const totals = computeRosterTotals(
      [slot('1'), slot('2')],
      columns,
      statsByPlayer({ '1': { HR: 10, R: 30, AVG: '.300' }, '2': { HR: 5, R: 20, AVG: '.250' } }),
    );
    expect(totals.get('HR')).toBe(15);
    expect(totals.get('R')).toBe(50);
    expect(totals.get('AVG')).toBe(NO_TOTAL);
  });

  it('skips "-" and missing values', () => {
    const totals = computeRosterTotals(
      [slot('1'), slot('2'), slot('3')],
      columns,
      statsByPlayer({ '1': { HR: 4 }, '2': { HR: '-' }, '3': {} }),
    );
    expect(totals.get('HR')).toBe(4);
  });

  it('parses numeric strings', () => {
    const totals = computeRosterTotals(
      [slot('1'), slot('2')],
      columns,
      statsByPlayer({ '1': { R: '12' }, '2': { R: '8' } }),
    );
    expect(totals.get('R')).toBe(20);
  });

  it('returns zero for an empty roster', () => {
    const totals = computeRosterTotals([], columns, statsByPlayer({}));
    expect(totals.get('HR')).toBe(0);
    expect(totals.get('AVG')).toBe(NO_TOTAL);
  });

  it('sums H/AB ratios component-wise', () => {
    const totals = computeRosterTotals(
      [slot('1'), slot('2')],
      columns,
      statsByPlayer({
        '1': { '60': '10/40' },
        '2': { '60': '5/20' },
      }),
    );
    expect(totals.get('60')).toBe('15/60');
  });

  it('pools AVG from summed H/AB', () => {
    const totals = computeRosterTotals(
      [slot('1'), slot('2')],
      columns,
      statsByPlayer({
        '1': { AVG: '.300', '60': '30/100' },
        '2': { AVG: '.200', '60': '10/50' },
      }),
    );
    expect(totals.get('AVG')).toBe('.267');
  });

  it('pools SLG, OBP, and OPS from H/AB and PA components', () => {
    const totals = computeRosterTotals(
      [slot('1'), slot('2')],
      battingRateColumns,
      statsByPlayer({
        '1': { '60': '10/40', '5': '.500', '4': '.400', '18': '5' },
        '2': { '60': '5/20', '5': '.250', '4': '.300', '18': '2' },
      }),
    );
    expect(totals.get('5')).toBe('.417');
    expect(totals.get('4')).toBe('.367');
    expect(totals.get('55')).toBe('.784');
  });

  it('pools ERA and WHIP from IP-weighted components', () => {
    const totals = computeRosterTotals(
      [slot('1'), slot('2')],
      pitchingRateColumns,
      statsByPlayer({
        '1': { '50': '6.0', '26': '3.00', '27': '1.00' },
        '2': { '50': '3.0', '26': '6.00', '27': '2.00' },
      }),
    );
    expect(totals.get('26')).toBe('4.00');
    expect(totals.get('27')).toBe('1.33');
  });

  it('pools OPS from H/AB when OBP and SLG columns are absent', () => {
    const opsOnlyColumns: StatColumn[] = [
      { key: 'OPS', label: 'OPS', aggregatable: false },
      { key: '60', label: 'H/AB', aggregatable: true },
    ];
    const totals = computeRosterTotals(
      [slot('1'), slot('2')],
      opsOnlyColumns,
      statsByPlayer({
        '1': { OPS: '.900', '60': '30/100' },
        '2': { OPS: '.700', '60': '10/50' },
      }),
    );
    expect(totals.get('OPS')).toBe('.833');
  });
});
