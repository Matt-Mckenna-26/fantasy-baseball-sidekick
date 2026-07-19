import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  LeagueFreeAgentsResponse,
  PlayerStatsResponse,
  StatRange,
} from '@fcm/contracts';
import type { AppConfig } from './config.js';
import type { FantasyProvider, FreeAgentsQuery } from './fantasyProvider.js';
import { createFantasyProvider } from './fantasyProvider.js';
import { MlbStatsProvider } from './mlbStatsProvider.js';
import type { YahooTokens } from './tokenStore.js';

const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 0 } as unknown as YahooTokens;

/** A minimal Yahoo-shaped stats response: identity + owner + rank + Yahoo stat values. */
function yahooPlayerStats(): PlayerStatsResponse {
  return {
    leagueId: 'L1',
    batting: {
      columns: [
        { key: '7', label: 'HR', aggregatable: true },
        { key: '8', label: 'AVG', aggregatable: false },
      ],
      players: [
        {
          player: { playerId: 'p1', fullName: 'Aaron Judge', mlbTeamAbbr: 'NYY' } as never,
          overallRank: 1,
          owner: 'Team A',
          stats: [
            { key: '7', value: 40 },
            { key: '8', value: '.300' },
          ],
        } as never,
      ],
    },
    pitching: { columns: [], players: [] },
  } as unknown as PlayerStatsResponse;
}

describe('createFantasyProvider wrapping', () => {
  it('wraps the base provider only when statsSource is mlb', () => {
    const yahooCfg = { dataMode: 'mock', statsSource: 'yahoo' } as unknown as AppConfig;
    const mlbCfg = { dataMode: 'mock', statsSource: 'mlb' } as unknown as AppConfig;
    expect(createFantasyProvider(yahooCfg)).not.toBeInstanceOf(MlbStatsProvider);
    expect(createFantasyProvider(mlbCfg)).toBeInstanceOf(MlbStatsProvider);
  });
});

describe('MlbStatsProvider', () => {
  beforeEach(() => {
    // No MLB matches: identity + game-log fetches all return empty, so every player is
    // "unmatched" and its stat VALUES become "-". That isolates the merge behavior.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves Yahoo identity/owner/rank/columns and only replaces stat values', async () => {
    const base: Partial<FantasyProvider> = {
      getPlayerStats: vi.fn(async () => yahooPlayerStats()),
    };
    const provider = new MlbStatsProvider(base as FantasyProvider);

    const out = await provider.getPlayerStats(tokens, 'L1', 'last14');

    const row = out.batting.players[0]!;
    // Identity + Yahoo state untouched.
    expect(row.player.playerId).toBe('p1');
    expect(row.overallRank).toBe(1);
    expect(row.owner).toBe('Team A');
    expect(out.batting.columns).toHaveLength(2);
    // Values replaced by MLB source (blanked here since the player was unmatched).
    expect(row.stats.map((s) => s.value)).toEqual(['-', '-']);
  });

  it('requests Yahoo scaffolding at season for the MLB-only last14 window', async () => {
    const getPlayerStats = vi.fn(async () => yahooPlayerStats());
    const provider = new MlbStatsProvider({ getPlayerStats } as unknown as FantasyProvider);

    await provider.getPlayerStats(tokens, 'L1', 'last14');

    // Yahoo can't serve last14, so the scaffold is fetched at 'season'.
    const requestedRange = getPlayerStats.mock.calls[0]![2] as StatRange;
    expect(requestedRange).toBe('season');
  });

  it('reports the requested window on free-agent responses', async () => {
    const scaffold: LeagueFreeAgentsResponse = {
      leagueId: 'L1',
      range: 'season',
      availability: 'FA',
      batting: { columns: [], players: [] },
      pitching: { columns: [], players: [] },
    } as unknown as LeagueFreeAgentsResponse;
    const getFreeAgents = vi.fn(async () => scaffold);
    const provider = new MlbStatsProvider({ getFreeAgents } as unknown as FantasyProvider);

    const query: FreeAgentsQuery = { range: 'last14', availability: 'FA' };
    const out = await provider.getFreeAgents(tokens, 'L1', query);

    expect(out.range).toBe('last14');
    // Base was queried with a Yahoo-serviceable range for the player set.
    const passedQuery = getFreeAgents.mock.calls[0]![2] as FreeAgentsQuery;
    expect(passedQuery.range).toBe('season');
  });

  it('delegates non-stat methods straight to the base provider', async () => {
    const getLeagueStandings = vi.fn(async () => ({ leagueId: 'L1' }) as never);
    const provider = new MlbStatsProvider({ getLeagueStandings } as unknown as FantasyProvider);
    await provider.getLeagueStandings(tokens, 'L1');
    expect(getLeagueStandings).toHaveBeenCalledTimes(1);
  });
});
