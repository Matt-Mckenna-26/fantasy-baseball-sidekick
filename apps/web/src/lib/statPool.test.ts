import { describe, it, expect } from 'vitest';
import type { PlayerStatLine, StatColumn } from '@fcm/contracts';
import {
  scoringColumns,
  toCompareEntity,
  toDisplay,
  toNumericValue,
  toStatRow,
} from './statPool';

describe('toNumericValue', () => {
  it('parses numbers and numeric strings, and rejects missing/non-numeric', () => {
    expect(toNumericValue(30)).toBe(30);
    expect(toNumericValue('.281')).toBeCloseTo(0.281);
    expect(toNumericValue('-')).toBeNull();
    expect(toNumericValue('')).toBeNull();
    expect(toNumericValue('abc')).toBeNull();
    expect(toNumericValue(undefined)).toBeNull();
  });
});

describe('toDisplay', () => {
  it('shows the raw value, with a dash for missing', () => {
    expect(toDisplay(30)).toBe('30');
    expect(toDisplay('.281')).toBe('.281');
    expect(toDisplay(undefined)).toBe('-');
  });
});

describe('scoringColumns', () => {
  it('drops the H/AB display column', () => {
    const cols: StatColumn[] = [
      { key: 'HR', label: 'HR' },
      { key: 'hab', label: 'H/AB' },
      { key: 'AVG', label: 'AVG' },
    ];
    expect(scoringColumns(cols).map((c) => c.key)).toEqual(['HR', 'AVG']);
  });
});

const line: PlayerStatLine = {
  player: {
    playerId: 'p1',
    fullName: 'Aaron Judge',
    mlbTeamAbbr: 'NYY',
    eligiblePositions: ['OF'],
    headshotUrl: 'https://img.example/j.png',
  },
  stats: [
    { key: 'HR', value: 30 },
    { key: 'AVG', value: '.311' },
  ],
  owner: 'The Bombers',
};

describe('toStatRow', () => {
  it('flattens identity + numeric and display values per column', () => {
    const cols: StatColumn[] = [
      { key: 'HR', label: 'HR' },
      { key: 'AVG', label: 'AVG' },
    ];
    const row = toStatRow(line, cols);
    expect(row).toMatchObject({
      playerId: 'p1',
      fullName: 'Aaron Judge',
      position: 'OF',
      owner: 'The Bombers',
      HR: 30,
      HR__d: '30',
      AVG__d: '.311',
    });
    expect(row.AVG).toBeCloseTo(0.311);
  });

  it('prefers Yahoo display_position for the Pos column', () => {
    const withDisplay: PlayerStatLine = {
      ...line,
      player: { ...line.player, displayPosition: 'SP', eligiblePositions: ['SP', 'P'] },
    };
    expect(toStatRow(withDisplay, []).position).toBe('SP');
  });

  it('hides Util unless it is the only eligible position', () => {
    const withUtil: PlayerStatLine = {
      ...line,
      player: { ...line.player, eligiblePositions: ['OF', 'Util'] },
    };
    expect(toStatRow(withUtil, []).position).toBe('OF');

    const utilOnly: PlayerStatLine = {
      ...line,
      player: {
        ...line.player,
        displayPosition: 'Util',
        eligiblePositions: ['Util'],
      },
    };
    expect(toStatRow(utilOnly, []).position).toBe('Util');

    const displayWithUtil: PlayerStatLine = {
      ...line,
      player: {
        ...line.player,
        displayPosition: '1B,Util',
        eligiblePositions: ['1B', 'Util'],
      },
    };
    expect(toStatRow(displayWithUtil, []).position).toBe('1B');
  });

  it('marks unrostered players with a null owner', () => {
    const fa: PlayerStatLine = { ...line, owner: undefined };
    expect(toStatRow(fa, []).owner).toBeNull();
  });
});

describe('toCompareEntity', () => {
  it('maps a stat line to the shared compare-card entity shape', () => {
    expect(toCompareEntity(line)).toEqual({
      id: 'p1',
      name: 'Aaron Judge',
      kind: 'player',
      stats: line.stats,
      imageUrl: 'https://img.example/j.png',
      subtitle: 'The Bombers',
    });
  });
});
