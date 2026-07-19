import { describe, it, expect } from 'vitest';
import { MockFantasyProvider } from '../fantasyProvider.mock.js';
import type { YahooTokens } from '../tokenStore.js';
import {
  snapshotFreeAgents,
  snapshotLeagueTeamStats,
  snapshotMatchups,
  snapshotPlayerLeaders,
  snapshotRosters,
  snapshotStandings,
  snapshotTeamPlayers,
  snapshotTransactions,
} from './snapshots.js';

const provider = new MockFantasyProvider();
const tokens: YahooTokens = { accessToken: 'a', refreshToken: 'r' };
const LEAGUE = '469.l.101214';

describe('AI snapshots', () => {
  it('standings snapshot keeps analytical fields + teamId for tool chaining', async () => {
    const snap = snapshotStandings(await provider.getLeagueStandings(tokens, LEAGUE));
    expect(snap.teams.length).toBeGreaterThan(0);
    const first = snap.teams[0]!;
    expect(first).toHaveProperty('team');
    expect(first).toHaveProperty('rank');
    // teamId is intentionally present so the model can resolve "my team" -> get_team_stats.
    expect(first).toHaveProperty('teamId');
    // But UI-only noise stays out of the model context.
    expect(JSON.stringify(snap)).not.toContain('logoUrl');
  });

  it('matchups snapshot keeps week + per-team category counts', async () => {
    const snap = snapshotMatchups(await provider.getLeagueMatchups(tokens, LEAGUE));
    expect(snap.week).toBeGreaterThan(0);
    expect(snap.matchups[0]?.teams[0]).toHaveProperty('won');
  });

  it('rosters snapshot lists players as "Name (POS)", carries teamId, and caps size', async () => {
    const snap = snapshotRosters(await provider.getLeagueRosters(tokens, LEAGUE), 3);
    expect(snap.teams[0]?.teamId).toBeTruthy();
    expect(snap.teams[0]?.players.length).toBeLessThanOrEqual(3);
    expect(snap.teams[0]?.players[0]).toMatch(/\(.+\)$/);
  });

  it('team stats snapshot maps stat keys to labels', async () => {
    const snap = snapshotTeamPlayers(await provider.getTeamRangeStats(tokens, LEAGUE, '1', 'season'));
    expect(snap.players[0]).toHaveProperty('name');
    // At least one rostered player carries labelled category values.
    const withStats = snap.players.find((p) => Object.keys(p.stats).length > 0);
    expect(withStats).toBeDefined();
  });

  it('league team stats snapshot exposes labelled columns', async () => {
    const snap = snapshotLeagueTeamStats(await provider.getLeagueTeamStats(tokens, LEAGUE, 'season'));
    expect(snap.columns).toContain('HR');
    expect(snap.teams[0]?.stats).toHaveProperty('HR');
  });

  it('player leaders snapshot caps to N per group by rank', async () => {
    const dto = await provider.getPlayerStats(tokens, LEAGUE, 'season');
    const snap = snapshotPlayerLeaders(dto, 3);
    expect(snap.batting.length).toBeLessThanOrEqual(3);
    // Sorted by overall rank ascending (best first).
    const ranks = snap.batting.map((p) => p.rank ?? Infinity);
    expect([...ranks]).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('transactions snapshot compacts date/type/adds/drops/teams and drops ids', async () => {
    const dto = await provider.getLeagueTransactions(tokens, LEAGUE, 25);
    const snap = snapshotTransactions(dto);
    expect(snap.transactions.length).toBeGreaterThan(0);
    const first = snap.transactions[0]!;
    expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first).toHaveProperty('type');
    expect(Array.isArray(first.adds)).toBe(true);
    expect(Array.isArray(first.drops)).toBe(true);
    expect(Array.isArray(first.teams)).toBe(true);
    // An add/drop move surfaces both an added and a dropped player.
    const addDrop = snap.transactions.find((t) => t.type === 'add/drop');
    expect(addDrop?.adds.length).toBeGreaterThan(0);
    expect(addDrop?.drops.length).toBeGreaterThan(0);
    // Player ids are stripped to save tokens.
    expect(JSON.stringify(snap)).not.toContain('playerId');
  });

  it('free-agent snapshot returns range + capped batting/pitching', async () => {
    const dto = await provider.getFreeAgents(tokens, LEAGUE, { range: 'last30' });
    const snap = snapshotFreeAgents(dto, 2);
    expect(snap.range).toBe('last30');
    expect(snap.batting.length).toBeLessThanOrEqual(2);
    // Free agents never carry an owner.
    expect(snap.batting.every((p) => !('owner' in p))).toBe(true);
  });
});
