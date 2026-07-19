import { describe, it, expect } from 'vitest';
import { assignBullpenRoles } from './mlbBullpen.js';

interface Usage {
  name: string;
  appearances: number;
  gamesStarted: number;
  saves: number;
  saveOpps: number;
  holds: number;
  blownSaves: number;
  gamesFinished: number;
}

function usage(name: string, o: Partial<Usage> = {}): Usage {
  return {
    name,
    appearances: 10,
    gamesStarted: 0,
    saves: 0,
    saveOpps: 0,
    holds: 0,
    blownSaves: 0,
    gamesFinished: 0,
    ...o,
  };
}

describe('assignBullpenRoles', () => {
  it('names the recent saves leader the closer and the holds leader setup', () => {
    const out = assignBullpenRoles(
      [
        usage('Closer Guy', { saves: 8, saveOpps: 9, gamesFinished: 10, blownSaves: 1 }),
        usage('Setup Guy', { holds: 7, gamesFinished: 1 }),
        usage('Middle Guy', { holds: 2 }),
        usage('Starter', { appearances: 6, gamesStarted: 6 }),
      ],
      'NYY',
      'last30',
    );
    const role = (n: string) => out.relievers.find((r) => r.name === n)?.role;
    expect(role('Closer Guy')).toBe('closer');
    expect(role('Setup Guy')).toBe('setup');
    expect(role('Middle Guy')).toBe('middle');
    // Pure starter (no relief usage) is excluded from the bullpen hierarchy.
    expect(out.relievers.find((r) => r.name === 'Starter')).toBeUndefined();
    expect(out.note).toBeUndefined();
  });

  it('flags a committee when a second arm shares the save load', () => {
    const out = assignBullpenRoles(
      [
        usage('Arm A', { saves: 4, saveOpps: 5, gamesFinished: 6 }),
        usage('Arm B', { saves: 4, saveOpps: 4, gamesFinished: 5 }),
      ],
      'SD',
      'last30',
    );
    expect(out.note).toMatch(/committee/i);
  });

  it('notes no clear closer when nobody has saves or games finished', () => {
    const out = assignBullpenRoles(
      [usage('Middle A', { holds: 1 }), usage('Middle B', { holds: 1 })],
      'ATH',
      'last30',
    );
    expect(out.relievers.every((r) => r.role !== 'closer')).toBe(true);
    expect(out.note).toMatch(/no clear closer/i);
  });
});
