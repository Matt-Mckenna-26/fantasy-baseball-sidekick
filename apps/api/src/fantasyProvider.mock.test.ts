import { describe, it, expect } from 'vitest';
import {
  leagueRostersResponseSchema,
  leagueStandingsResponseSchema,
  leagueTeamStatsResponseSchema,
  meLeaguesResponseSchema,
  playerStatsResponseSchema,
} from '@fcm/contracts';
import type { AppConfig } from './config.js';
import { createFantasyProvider } from './fantasyProvider.js';
import { MockFantasyProvider } from './fantasyProvider.mock.js';

const tokens = { accessToken: 'a', refreshToken: 'r' };

const baseConfig = {
  yahooClientId: 'id',
  yahooClientSecret: 'secret',
  yahooRedirectUri: 'https://localhost:5173/auth/yahoo/callback',
  webAppUrl: 'https://localhost:5173',
  sessionSecret: 'x'.repeat(16),
  port: 8787,
} satisfies Omit<AppConfig, 'dataMode'>;

describe('createFantasyProvider', () => {
  it('returns the mock provider when dataMode is mock', () => {
    const provider = createFantasyProvider({ ...baseConfig, dataMode: 'mock' });
    expect(provider).toBeInstanceOf(MockFantasyProvider);
  });

  it('returns a non-mock provider when dataMode is live', () => {
    const provider = createFantasyProvider({ ...baseConfig, dataMode: 'live' });
    expect(provider).not.toBeInstanceOf(MockFantasyProvider);
  });
});

describe('MockFantasyProvider', () => {
  const provider = new MockFantasyProvider();

  it('returns DTO-valid leagues', async () => {
    const result = await provider.getMyLeagues();
    expect(() => meLeaguesResponseSchema.parse(result)).not.toThrow();
    expect(result.leagues.length).toBeGreaterThan(0);
  });

  it('returns DTO-valid rosters echoing the requested leagueId', async () => {
    const result = await provider.getLeagueRosters(tokens, '99999');
    expect(() => leagueRostersResponseSchema.parse(result)).not.toThrow();
    expect(result.leagueId).toBe('99999');
    expect(result.teams[0]?.slots.length).toBeGreaterThan(0);
  });

  it('returns DTO-valid batting and pitching tables with aligned columns', async () => {
    const result = await provider.getPlayerStats(tokens, '24281', 'season');
    expect(() => playerStatsResponseSchema.parse(result)).not.toThrow();

    for (const table of [result.batting, result.pitching]) {
      const columnKeys = table.columns.map((c) => c.key);
      expect(table.players.length).toBeGreaterThan(0);
      for (const line of table.players) {
        expect(line.stats.map((s) => s.key)).toEqual(columnKeys);
      }
    }
  });

  it('returns DTO-valid league team stats bucketed by fantasy week', async () => {
    const season = await provider.getLeagueTeamStats(tokens, '24281', 'season');
    expect(() => leagueTeamStatsResponseSchema.parse(season)).not.toThrow();
    expect(season.teams.length).toBeGreaterThan(1);
    expect(season.bucket).toBe('season');
    expect(season.weeks.length).toBeGreaterThan(1);

    const combinedKeys = [...season.battingColumns, ...season.pitchingColumns].map((c) => c.key);
    for (const team of season.teams) {
      expect(team.stats.map((s) => s.key)).toEqual(combinedKeys);
    }

    // Counting stats accumulate over the season, so a single week is lower than the total.
    const week = season.weeks[0]!;
    const single = await provider.getLeagueTeamStats(tokens, '24281', week);
    expect(single.bucket).toBe(week);
    const seasonR = Number(season.teams[0]?.stats.find((s) => s.key === 'R')?.value);
    const weekR = Number(single.teams[0]?.stats.find((s) => s.key === 'R')?.value);
    expect(weekR).toBeLessThan(seasonR);
  });

  it('aggregates a multi-week window server-side (counting summed, rate averaged)', async () => {
    const window = await provider.getLeagueTeamStats(tokens, '24281', 'last3weeks');
    expect(() => leagueTeamStatsResponseSchema.parse(window)).not.toThrow();
    expect(window.bucket).toBe('last3weeks');
    expect(window.aggregatedWeeks).toHaveLength(3);

    // A 3-week window sums more runs than any single week within it.
    const oneWeek = await provider.getLeagueTeamStats(tokens, '24281', window.aggregatedWeeks![0]!);
    const windowR = Number(window.teams[0]?.stats.find((s) => s.key === 'R')?.value);
    const oneWeekR = Number(oneWeek.teams[0]?.stats.find((s) => s.key === 'R')?.value);
    expect(windowR).toBeGreaterThan(oneWeekR);

    // Rate stats are averaged, so they stay in a plausible range (not summed).
    const avg = Number(window.teams[0]?.stats.find((s) => s.key === 'AVG')?.value);
    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThan(1);
  });

  it('returns DTO-valid standings ordered by rank', async () => {
    const result = await provider.getLeagueStandings(tokens, '24281');
    expect(() => leagueStandingsResponseSchema.parse(result)).not.toThrow();
    expect(result.teams.length).toBeGreaterThan(1);
    const ranks = result.teams.map((t) => t.rank ?? 0);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(result.teams[0]?.gamesBack).toBe('-');
  });
});
