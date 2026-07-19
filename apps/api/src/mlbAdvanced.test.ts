import { describe, it, expect } from 'vitest';
import {
  ADVANCED_HITTING_COLUMNS,
  ADVANCED_PITCHING_COLUMNS,
  extractAdvancedValues,
  mapPersonToAdvanced,
} from './mlbAdvanced.js';

/** Build hydrated stat groups (as the batched /people call returns) for one group. */
function statGroups(
  group: 'hitting' | 'pitching',
  byType: Record<string, Record<string, unknown>>,
) {
  return Object.entries(byType).map(([type, stat]) => ({
    group: { displayName: group },
    type: { displayName: type },
    splits: [{ stat }],
  }));
}

/** Build a hydrated /people person with the given per-group season/expected/advanced stats. */
function person(
  overrides: {
    id?: number;
    position?: string;
    hitting?: Record<string, Record<string, unknown>>;
    pitching?: Record<string, Record<string, unknown>>;
  } = {},
) {
  const groups: unknown[] = [];
  for (const [group, byType] of Object.entries({
    hitting: overrides.hitting,
    pitching: overrides.pitching,
  })) {
    if (!byType) continue;
    for (const [type, stat] of Object.entries(byType)) {
      groups.push({
        group: { displayName: group },
        type: { displayName: type },
        splits: [{ stat }],
      });
    }
  }
  return {
    id: overrides.id ?? 1,
    fullName: 'Test Player',
    currentTeam: { abbreviation: 'NYY' },
    primaryPosition: { abbreviation: overrides.position ?? 'RF' },
    stats: groups,
  };
}

describe('mapPersonToAdvanced', () => {
  it('returns matched:false with no metrics when there is no person', () => {
    expect(mapPersonToAdvanced(undefined, 'Nobody')).toEqual({
      query: 'Nobody',
      matched: false,
      metrics: [],
    });
  });

  it('maps a hitter and flags an overperformer as sell-high', () => {
    const out = mapPersonToAdvanced(
      person({
        position: 'RF',
        hitting: {
          season: { avg: '.320', slg: '.560', babip: '.360' },
          expectedStatistics: { avg: '.280', slg: '.500', woba: '.360' },
          seasonAdvanced: {
            iso: '.240',
            strikeoutsPerPlateAppearance: '.220',
            walksPerPlateAppearance: '.100',
          },
        },
      }),
      'Test Player',
    );
    expect(out.matched).toBe(true);
    expect(out.group).toBe('hitting');
    const avg = out.metrics.find((m) => m.key === 'avg');
    expect(avg).toMatchObject({ actual: 0.32, expected: 0.28, higherIsBetter: true });
    expect(out.metrics.map((m) => m.key)).toContain('babip');
    expect(out.luck?.lean).toBe('sell');
  });

  it('maps a pitcher and flags harder-than-shown contact as buy-low', () => {
    const out = mapPersonToAdvanced(
      person({
        position: 'P',
        pitching: {
          season: {
            avg: '.260',
            slg: '.420',
            babip: '.330',
            strikeoutsPer9Inn: '9.50',
            walksPer9Inn: '2.10',
            homeRunsPer9: '1.10',
          },
          expectedStatistics: { avg: '.220', slg: '.380', woba: '.300' },
          seasonAdvanced: {},
        },
      }),
      'Test Pitcher',
    );
    expect(out.group).toBe('pitching');
    const baa = out.metrics.find((m) => m.key === 'baa');
    expect(baa).toMatchObject({ actual: 0.26, expected: 0.22, higherIsBetter: false });
    expect(out.metrics.find((m) => m.key === 'k9')?.actual).toBe(9.5);
    expect(out.luck?.lean).toBe('buy');
  });

  it('omits luck when no expected pair is available', () => {
    const out = mapPersonToAdvanced(
      person({ position: 'RF', hitting: { season: { avg: '.280', babip: '.300' } } }),
      'No Expected',
    );
    expect(out.luck).toBeUndefined();
    expect(out.metrics.find((m) => m.key === 'babip')?.actual).toBe(0.3);
  });
});

describe('advanced league columns', () => {
  it('flags K% as lower-is-better and BB% as higher-is-better for hitters', () => {
    const k = ADVANCED_HITTING_COLUMNS.find((c) => c.key === 'K%');
    const bb = ADVANCED_HITTING_COLUMNS.find((c) => c.key === 'BB%');
    expect(k?.higherIsBetter).toBe(false);
    expect(bb?.higherIsBetter).toBe(true);
    // Every advanced column is a rate/composite, so none aggregate.
    expect(ADVANCED_HITTING_COLUMNS.every((c) => c.aggregatable === false)).toBe(true);
  });

  it('flags pitching BAA/BB-9 as lower-is-better and K/9 as higher-is-better, and keeps IP for volume filters', () => {
    const ip = ADVANCED_PITCHING_COLUMNS.find((c) => c.key === 'IP');
    const baa = ADVANCED_PITCHING_COLUMNS.find((c) => c.key === 'BAA');
    const k9 = ADVANCED_PITCHING_COLUMNS.find((c) => c.key === 'K/9');
    const bb9 = ADVANCED_PITCHING_COLUMNS.find((c) => c.key === 'BB/9');
    expect(ip?.aggregatable).toBe(true);
    expect(ip?.higherIsBetter).toBe(true);
    expect(baa?.higherIsBetter).toBe(false);
    expect(k9?.higherIsBetter).toBe(true);
    expect(bb9?.higherIsBetter).toBe(false);
    expect(ADVANCED_PITCHING_COLUMNS[0]?.key).toBe('IP');
  });
});

describe('extractAdvancedValues', () => {
  it('formats hitting values as sortable display strings (rates ".314", K% as "23.6")', () => {
    const values = extractAdvancedValues(
      statGroups('hitting', {
        season: { avg: '.331', slg: '.560', babip: '.376' },
        expectedStatistics: { avg: '.314', slg: '.500', woba: '.475' },
        seasonAdvanced: {
          iso: '.240',
          strikeoutsPerPlateAppearance: '.236',
          walksPerPlateAppearance: '.100',
        },
      }),
      'hitting',
    );
    expect(values.get('AVG')).toBe('.331');
    expect(values.get('xBA')).toBe('.314');
    expect(values.get('xwOBA')).toBe('.475');
    expect(values.get('K%')).toBe('23.6');
    expect(values.get('BB%')).toBe('10.0');
    // Every value must parse back to a finite number for percentile sorting.
    for (const v of values.values()) expect(Number.isFinite(Number(v))).toBe(true);
  });

  it('formats pitching per-nine values with two decimals, keeps IP notation, and omits absent stats', () => {
    const values = extractAdvancedValues(
      statGroups('pitching', {
        season: {
          inningsPitched: '145.1',
          avg: '.200',
          strikeoutsPer9Inn: '11.10',
          walksPer9Inn: '1.52',
        },
        expectedStatistics: { avg: '.215' },
      }),
      'pitching',
    );
    expect(values.get('IP')).toBe('145.1');
    expect(values.get('BAA')).toBe('.200');
    expect(values.get('xBA')).toBe('.215');
    expect(values.get('K/9')).toBe('11.10');
    expect(values.get('BB/9')).toBe('1.52');
    // HR/9 had no source value, so it's skipped entirely (rendered as "-" downstream).
    expect(values.has('HR/9')).toBe(false);
  });
});
