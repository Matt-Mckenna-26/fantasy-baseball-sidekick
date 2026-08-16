import { describe, it, expect } from 'vitest';
import type { StatColumn } from '@fcm/contracts';
import {
  aggregateSplits,
  mapBattingGameLog,
  mapColumns,
  mapPitchingGameLog,
  resolvePersonId,
  windowBounds,
  type AggregatedStats,
} from './mlbStats.js';

describe('resolvePersonId', () => {
  const byName = new Map([
    ['jose ramirez', [{ id: 2, teamAbbr: 'CLE' }]],
    ['will smith', [
      { id: 10, teamAbbr: 'LAD' },
      { id: 11, teamAbbr: 'KC' },
    ]],
  ]);

  it('matches by normalized name, ignoring accents/case', () => {
    expect(resolvePersonId(byName, 'José Ramírez')).toBe(2);
  });

  it('uses the team hint to break ties on duplicate names', () => {
    expect(resolvePersonId(byName, 'Will Smith', 'KC')).toBe(11);
    expect(resolvePersonId(byName, 'Will Smith', 'LAD')).toBe(10);
  });

  it('falls back to the first candidate when the team hint does not match', () => {
    expect(resolvePersonId(byName, 'Will Smith', 'NYY')).toBe(10);
  });

  it('returns undefined for an unknown name (never guesses)', () => {
    expect(resolvePersonId(byName, 'Aaron Judge')).toBeUndefined();
  });
});

describe('windowBounds', () => {
  it('returns trailing inclusive date ranges ending today', () => {
    expect(windowBounds('today', '2024-07-15')).toEqual({ start: '2024-07-15', end: '2024-07-15' });
    expect(windowBounds('last7', '2024-07-15')).toEqual({ start: '2024-07-09', end: '2024-07-15' });
    expect(windowBounds('last14', '2024-07-15')).toEqual({ start: '2024-07-02', end: '2024-07-15' });
    expect(windowBounds('last21', '2024-07-15')).toEqual({ start: '2024-06-25', end: '2024-07-15' });
    expect(windowBounds('last30', '2024-07-15')).toEqual({ start: '2024-06-16', end: '2024-07-15' });
  });

  it('treats season as unbounded', () => {
    expect(windowBounds('season', '2024-07-15')).toBe('season');
  });
});

describe('aggregateSplits (hitting)', () => {
  const splits = [
    { date: '2024-07-01', stat: { atBats: 4, hits: 2, doubles: 1, homeRuns: 1, totalBases: 6, baseOnBalls: 1, rbi: 3, runs: 2, stolenBases: 1, caughtStealing: 0, hitByPitch: 0, sacFlies: 0 } },
    { date: '2024-07-10', stat: { atBats: 3, hits: 1, doubles: 0, homeRuns: 0, totalBases: 1, baseOnBalls: 2, rbi: 0, runs: 1, stolenBases: 0, caughtStealing: 1, hitByPitch: 1, sacFlies: 0 } },
    // Outside a last7 window ending 2024-07-15 (before 2024-07-09).
    { date: '2024-06-20', stat: { atBats: 5, hits: 5, homeRuns: 2, totalBases: 11 } },
  ];

  it('sums only the games inside the window', () => {
    // last7 ending 2024-07-15 spans 2024-07-09..07-15, so only the 07-10 game qualifies
    // (07-01 and 06-20 fall outside).
    const agg = aggregateSplits(splits, 'hitting', windowBounds('last7', '2024-07-15'));
    expect(agg.totals.get('atBats')).toBe(3);
    expect(agg.totals.get('hits')).toBe(1);
    expect(agg.totals.get('baseOnBalls')).toBe(2);
    expect(agg.totals.get('totalBases')).toBe(1);
  });

  it('sums every game for a season window', () => {
    const agg = aggregateSplits(splits, 'hitting', 'season');
    expect(agg.totals.get('atBats')).toBe(12);
    expect(agg.totals.get('homeRuns')).toBe(3);
  });
});

describe('aggregateSplits (pitching QS derivation)', () => {
  const splits = [
    // Quality start: 6.0 IP (18 outs), 2 ER.
    { date: '2024-07-01', stat: { gamesStarted: 1, outs: 18, earnedRuns: 2, strikeOuts: 7, baseOnBalls: 1, hits: 4, wins: 1 } },
    // Not a QS: 6 IP but 4 ER.
    { date: '2024-07-06', stat: { gamesStarted: 1, outs: 18, earnedRuns: 4, strikeOuts: 5, baseOnBalls: 2, hits: 6 } },
    // Not a QS: only 5.2 IP (17 outs), 1 ER.
    { date: '2024-07-11', stat: { gamesStarted: 1, outs: 17, earnedRuns: 1, strikeOuts: 6, baseOnBalls: 0, hits: 3, wins: 1 } },
    // Relief appearance (no start) - never counts toward QS.
    { date: '2024-07-12', stat: { gamesStarted: 0, outs: 3, earnedRuns: 0, strikeOuts: 1 } },
  ];

  it('counts a start as a QS only when IP>=6 and ER<=3', () => {
    const agg = aggregateSplits(splits, 'pitching', 'season');
    expect(agg.qualityStarts).toBe(1);
    expect(agg.outs).toBe(56);
    expect(agg.totals.get('wins')).toBe(2);
    expect(agg.totals.get('earnedRuns')).toBe(7);
  });
});

describe('mapColumns', () => {
  const hittingAgg: AggregatedStats = {
    group: 'hitting',
    totals: new Map([
      ['atBats', 100],
      ['hits', 32],
      ['totalBases', 60],
      ['baseOnBalls', 10],
      ['hitByPitch', 2],
      ['sacFlies', 1],
      ['homeRuns', 8],
      ['stolenBases', 5],
      ['caughtStealing', 2],
    ]),
    outs: 0,
    qualityStarts: 0,
  };

  it('recomputes hitting rate stats and formats them like Yahoo', () => {
    const columns: StatColumn[] = [
      { key: '1', label: 'AVG', aggregatable: false },
      { key: '2', label: 'OBP', aggregatable: false },
      { key: '3', label: 'SLG', aggregatable: false },
      { key: '4', label: 'HR', aggregatable: true },
      { key: '5', label: 'NSB', aggregatable: true },
      { key: '6', label: 'H/AB', aggregatable: false },
    ];
    const unmapped = new Set<string>();
    const values = mapColumns(columns, hittingAgg, unmapped);
    // AVG = 32/100 = .320
    expect(values[0]!.value).toBe('.320');
    // OBP = (32+10+2)/(100+10+2+1) = 44/113 = .389...
    expect(values[1]!.value).toBe('.389');
    // SLG = 60/100 = .600
    expect(values[2]!.value).toBe('.600');
    expect(values[3]!.value).toBe(8);
    // NSB = SB - CS = 5 - 2
    expect(values[4]!.value).toBe(3);
    // H/AB is a Yahoo display stat: hits/at-bats.
    expect(values[5]!.value).toBe('32/100');
    expect(unmapped.size).toBe(0);
  });

  it('recomputes pitching rate stats and maps QS', () => {
    const pitchingAgg: AggregatedStats = {
      group: 'pitching',
      totals: new Map([
        ['earnedRuns', 20],
        ['baseOnBalls', 15],
        ['hits', 45],
        ['strikeOuts', 80],
        ['saves', 3],
        ['holds', 4],
      ]),
      outs: 180, // 60 IP
      qualityStarts: 6,
    };
    const columns: StatColumn[] = [
      { key: '1', label: 'ERA', aggregatable: false },
      { key: '2', label: 'WHIP', aggregatable: false },
      { key: '3', label: 'QS', aggregatable: true },
      { key: '4', label: 'IP', aggregatable: true },
      { key: '5', label: 'SV+H', aggregatable: true },
      { key: '6', label: 'K/9', aggregatable: false },
    ];
    const unmapped = new Set<string>();
    const values = mapColumns(columns, pitchingAgg, unmapped);
    // ERA = 27*20/180 = 3.00
    expect(values[0]!.value).toBe('3.00');
    // WHIP = 3*(15+45)/180 = 1.00
    expect(values[1]!.value).toBe('1.00');
    expect(values[2]!.value).toBe(6);
    // 180 outs = 60.0 IP
    expect(values[3]!.value).toBe('60.0');
    expect(values[4]!.value).toBe(7);
    // K/9 = 27*80/180 = 12.00
    expect(values[5]!.value).toBe('12.00');
  });

  it('blanks and records unmapped categories, and blanks unmatched players', () => {
    const columns: StatColumn[] = [
      { key: '1', label: 'HR', aggregatable: true },
      { key: '2', label: 'WeirdCustomCat', aggregatable: true },
    ];
    const unmapped = new Set<string>();
    const values = mapColumns(columns, hittingAgg, unmapped);
    expect(values[1]!.value).toBe('-');
    expect(unmapped.has('WeirdCustomCat')).toBe(true);

    // Unmatched player (null agg) -> every column blank.
    const blank = mapColumns(columns, null, new Set<string>());
    expect(blank.every((v) => v.value === '-')).toBe(true);
  });
});

describe('mapBattingGameLog', () => {
  it('drops dateless splits, newest first, and computes game AVG', () => {
    const lines = mapBattingGameLog(
      [
        { date: '2026-07-01', isHome: false, opponent: { abbreviation: 'tor' }, stat: { atBats: 4, hits: 1, homeRuns: 0, runs: 0, rbi: 0, baseOnBalls: 0, strikeOuts: 1, stolenBases: 0, doubles: 0, triples: 0 } },
        { stat: { atBats: 99, hits: 99 } },
        { date: '2026-07-04', isHome: true, opponent: { abbreviation: 'BOS' }, game: { gamePk: 1 }, stat: { atBats: 4, hits: 2, homeRuns: 1, runs: 2, rbi: 3, baseOnBalls: 1, strikeOuts: 0, stolenBases: 1, doubles: 1, triples: 0 } },
      ],
      10,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]?.date).toBe('2026-07-04');
    expect(lines[0]?.opponent).toBe('BOS');
    expect(lines[0]?.home).toBe(true);
    expect(lines[0]?.hr).toBe(1);
    expect(lines[0]?.avg).toBe('.500');
    expect(lines[1]?.opponent).toBe('TOR');
    expect(lines[1]?.home).toBe(false);
  });

  it('respects the limit after sorting', () => {
    const splits = [
      { date: '2026-07-01', stat: { atBats: 1, hits: 0 } },
      { date: '2026-07-03', stat: { atBats: 1, hits: 1 } },
      { date: '2026-07-02', stat: { atBats: 1, hits: 0 } },
    ];
    const lines = mapBattingGameLog(splits, 2);
    expect(lines.map((l) => l.date)).toEqual(['2026-07-03', '2026-07-02']);
  });
});

describe('mapPitchingGameLog', () => {
  it('maps IP from outs, picks a W decision, and keeps pitch count', () => {
    const [line] = mapPitchingGameLog(
      [
        {
          date: '2026-07-03',
          isHome: false,
          opponent: { abbreviation: 'HOU' },
          stat: {
            outs: 21,
            hits: 4,
            runs: 1,
            earnedRuns: 1,
            baseOnBalls: 1,
            strikeOuts: 9,
            homeRuns: 0,
            wins: 1,
            numberOfPitches: 98,
          },
        },
      ],
      10,
    );
    expect(line?.ip).toBe('7.0');
    expect(line?.decision).toBe('W');
    expect(line?.so).toBe(9);
    expect(line?.pitches).toBe(98);
    expect(line?.home).toBe(false);
  });

  it('prefers inningsPitched string over outs', () => {
    const [line] = mapPitchingGameLog(
      [{ date: '2026-07-01', stat: { inningsPitched: '6.1', outs: 99, earnedRuns: 2 } }],
      5,
    );
    expect(line?.ip).toBe('6.1');
  });
});
