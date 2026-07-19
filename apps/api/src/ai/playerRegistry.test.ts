import { describe, it, expect } from 'vitest';
import type { Player } from '@fcm/contracts';
import { PlayerRegistry, normalizeName } from './playerRegistry.js';

function player(overrides: Partial<Player> & { playerId: string; fullName: string }): Player {
  return { eligiblePositions: [], ...overrides };
}

describe('normalizeName', () => {
  it('lowercases, collapses whitespace, and strips punctuation', () => {
    expect(normalizeName('Aaron  Judge')).toBe('aaron judge');
    expect(normalizeName("D'Angelo  Ortiz")).toBe('dangelo ortiz');
  });

  it('strips accents and generational suffixes', () => {
    expect(normalizeName('José Ramírez')).toBe('jose ramirez');
    expect(normalizeName('Ronald Acuña Jr.')).toBe('ronald acuna');
  });
});

describe('PlayerRegistry', () => {
  it('resolves tagged names to identities, deduped by playerId and in mention order', () => {
    const reg = new PlayerRegistry();
    reg.addPlayer(player({ playerId: '1', fullName: 'Aaron Judge', mlbTeamAbbr: 'NYY' }), 'B');
    reg.addPlayer(player({ playerId: '2', fullName: 'Gerrit Cole' }), 'P');

    const resolved = reg.resolve(['Gerrit Cole', 'aaron judge', 'Gerrit Cole']);
    expect(resolved.map((p) => p.playerId)).toEqual(['2', '1']);
    expect(resolved[0]).toMatchObject({ playerId: '2', fullName: 'Gerrit Cole', positionType: 'P' });
    expect(resolved[1]).toMatchObject({ playerId: '1', mlbTeamAbbr: 'NYY', positionType: 'B' });
  });

  it('matches names tagged with accents/suffixes against the stored player', () => {
    const reg = new PlayerRegistry();
    reg.addPlayer(player({ playerId: '9', fullName: 'Ronald Acuna Jr.' }), 'B');
    expect(reg.resolve(['Ronald Acuña Jr.']).map((p) => p.playerId)).toEqual(['9']);
  });

  it('infers position type from eligible positions when not given', () => {
    const reg = new PlayerRegistry();
    reg.addPlayer(player({ playerId: '3', fullName: 'Some Pitcher', eligiblePositions: ['SP'] }));
    expect(reg.resolve(['Some Pitcher'])[0]?.positionType).toBe('P');
  });

  it('ignores players missing an id or name, and unknown tagged names', () => {
    const reg = new PlayerRegistry();
    reg.addPlayer(player({ playerId: '', fullName: 'No Id' }));
    expect(reg.resolve(['No Id', 'Nobody Known'])).toEqual([]);
  });
});
