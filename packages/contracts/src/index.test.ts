import { describe, it, expect } from 'vitest';
import {
  authStatusSchema,
  meLeaguesResponseSchema,
  leagueSummarySchema,
  apiErrorSchema,
} from './index.js';

describe('contracts schemas', () => {
  it('parses a valid league summary (with and without optional teamName)', () => {
    expect(leagueSummarySchema.parse({ leagueId: '1', name: 'A', season: '2026' })).toEqual({
      leagueId: '1',
      name: 'A',
      season: '2026',
    });
    const withTeam = leagueSummarySchema.parse({
      leagueId: '1',
      name: 'A',
      season: '2026',
      teamName: 'My Team',
    });
    expect(withTeam.teamName).toBe('My Team');
  });

  it('parses a valid me/leagues response', () => {
    const parsed = meLeaguesResponseSchema.parse({
      userGuid: 'GUID',
      leagues: [{ leagueId: '24281', name: 'FKL Baseball', season: '2026' }],
    });
    expect(parsed.leagues).toHaveLength(1);
  });

  it('rejects a me/leagues response with a malformed league', () => {
    expect(() =>
      meLeaguesResponseSchema.parse({ leagues: [{ leagueId: 1, name: 'A', season: '2026' }] }),
    ).toThrow();
  });

  it('parses auth status and api error envelopes', () => {
    expect(authStatusSchema.parse({ authenticated: true }).authenticated).toBe(true);
    expect(
      apiErrorSchema.parse({ error: { code: 'unauthorized', message: 'no' } }).error.code,
    ).toBe('unauthorized');
  });
});
