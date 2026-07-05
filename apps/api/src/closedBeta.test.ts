import { describe, it, expect } from 'vitest';
import { isLeagueAllowed, leagueIdFromKey } from './closedBeta.js';

describe('closed-beta allowlist', () => {
  it('reduces a season-scoped league_key to its stable league_id', () => {
    expect(leagueIdFromKey('469.l.101214')).toBe('101214');
    expect(leagueIdFromKey('101214')).toBe('101214');
  });

  it('admits "The Show" by league_key or bare league_id', () => {
    expect(isLeagueAllowed('469.l.101214')).toBe(true);
    expect(isLeagueAllowed('101214')).toBe(true);
  });

  it('admits "The Show" across seasons (different game prefix)', () => {
    expect(isLeagueAllowed('458.l.101214')).toBe(true);
  });

  it('denies leagues not on the allowlist', () => {
    expect(isLeagueAllowed('469.l.212934')).toBe(false);
    expect(isLeagueAllowed('999999')).toBe(false);
  });
});
