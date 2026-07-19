import { describe, it, expect } from 'vitest';
import { mapPersonToEnrichment, mapTransactions, pickBestPersonMatch } from './mlbClient.js';

describe('MLB player enrichment mappers', () => {
  it('matches by normalized name, ignoring accents/case/punctuation', () => {
    const people = [
      { id: 1, fullName: 'Someone Else' },
      { id: 2, fullName: 'José Ramírez', currentTeam: { abbreviation: 'CLE' } },
    ];
    const match = pickBestPersonMatch(people, 'jose ramirez');
    expect(match?.id).toBe(2);
  });

  it('prefers the team-matching candidate when a hint is given', () => {
    const people = [
      { id: 10, fullName: 'Will Smith', currentTeam: { abbreviation: 'LAD' } },
      { id: 11, fullName: 'Will Smith', currentTeam: { abbreviation: 'KC' } },
    ];
    expect(pickBestPersonMatch(people, 'Will Smith', 'KC')?.id).toBe(11);
    expect(pickBestPersonMatch(people, 'Will Smith', 'LAD')?.id).toBe(10);
  });

  it('returns undefined when no name matches', () => {
    expect(pickBestPersonMatch([{ id: 1, fullName: 'Nobody' }], 'Aaron Judge')).toBeUndefined();
  });

  it('maps a hydrated person to compact hitting stats', () => {
    const person = {
      id: 592450,
      fullName: 'Aaron Judge',
      currentTeam: { abbreviation: 'NYY' },
      primaryPosition: { abbreviation: 'RF' },
      batSide: { code: 'R' },
      stats: [
        {
          group: { displayName: 'hitting' },
          type: { displayName: 'season' },
          splits: [{ stat: { homeRuns: 30, rbi: 70, avg: '.320', ops: '1.050', ignored: { x: 1 } } }],
        },
      ],
    };
    const enriched = mapPersonToEnrichment(person, 'Aaron Judge');
    expect(enriched.matched).toBe(true);
    expect(enriched.team).toBe('NYY');
    expect(enriched.hitting).toMatchObject({ homeRuns: 30, avg: '.320' });
    // Non-curated keys are dropped to keep the payload token-small.
    expect(enriched.hitting).not.toHaveProperty('ignored');
    expect(enriched.pitching).toBeUndefined();
  });

  it('reports not matched for an empty/absent person', () => {
    expect(mapPersonToEnrichment(undefined, 'Nobody')).toEqual({ matched: false, query: 'Nobody' });
  });

  it('maps raw transactions to a compact list', () => {
    const raw = {
      transactions: [
        {
          date: '2026-06-30',
          typeDesc: 'Status Change',
          description: 'Placed on the 10-day IL.',
          person: { fullName: 'Aaron Judge' },
          team: { abbreviation: 'NYY' },
        },
      ],
    };
    expect(mapTransactions(raw)).toEqual([
      {
        date: '2026-06-30',
        type: 'Status Change',
        description: 'Placed on the 10-day IL.',
        player: 'Aaron Judge',
        team: 'NYY',
      },
    ]);
  });
});
