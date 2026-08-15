import { describe, it, expect, vi } from 'vitest';
import { MockFantasyProvider } from '../fantasyProvider.mock.js';
import type { YahooTokens } from '../tokenStore.js';
import type { WebSearch } from '../exaClient.js';
import { buildTools, ToolError, type ToolContext } from './tools.js';
import { SourceRegistry } from './sourceRegistry.js';
import { TtlCache } from './cache.js';

const tokens: YahooTokens = { accessToken: 'a', refreshToken: 'r' };
const tools = buildTools();
const byName = new Map(tools.map((t) => [t.name, t]));

function ctx(leagueId?: string): ToolContext {
  return {
    provider: new MockFantasyProvider(),
    tokens,
    cache: new TtlCache(),
    ...(leagueId ? { leagueId } : {}),
  };
}

describe('chat tools', () => {
  it('every tool exposes a JSON-schema object for its parameters', () => {
    for (const tool of tools) {
      expect(tool.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('Yahoo tools deny when no league is selected', async () => {
    await expect(byName.get('get_league_standings')!.run({}, ctx())).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('Yahoo tools deny leagues outside the closed beta', async () => {
    await expect(
      byName.get('get_league_standings')!.run({}, ctx('469.l.999999')),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('get_free_agents returns a compact snapshot for an allowed league', async () => {
    const out = (await byName
      .get('get_free_agents')!
      .run({ range: 'last30' }, ctx('469.l.101214'))) as {
      range: string;
      batting: unknown[];
    };
    expect(out.range).toBe('last30');
    expect(Array.isArray(out.batting)).toBe(true);
  });

  it('get_recent_transactions returns a compact snapshot for an allowed league', async () => {
    const out = (await byName
      .get('get_recent_transactions')!
      .run({ count: 3 }, ctx('469.l.101214'))) as {
      transactions: unknown[];
    };
    expect(Array.isArray(out.transactions)).toBe(true);
    expect(out.transactions.length).toBeLessThanOrEqual(3);
  });

  it('get_recent_transactions denies when no league is selected', async () => {
    await expect(byName.get('get_recent_transactions')!.run({}, ctx())).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('get_team_stats requires a teamId', async () => {
    await expect(byName.get('get_team_stats')!.run({}, ctx('469.l.101214'))).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('get_league_player_stats leaders carry the Value+ score and cross-position rank', async () => {
    const out = (await byName
      .get('get_league_player_stats')!
      .run({ range: 'season' }, ctx('469.l.101214'))) as {
      batting: { name: string; sgptPlus?: number; sgptRank?: number }[];
    };
    const scored = out.batting.find((p) => typeof p.sgptPlus === 'number');
    expect(scored).toBeDefined();
    expect(typeof scored!.sgptRank).toBe('number');
  });

  it('get_player_value requires at least one name and needs a league', async () => {
    expect(byName.get('get_player_value')?.needsLeague).toBe(true);
    await expect(
      byName.get('get_player_value')!.run({ names: [] }, ctx('469.l.101214')),
    ).rejects.toBeInstanceOf(ToolError);
    await expect(
      byName.get('get_player_value')!.run({ names: ['x'] }, ctx()),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('get_player_value returns Value+ lines for matched players and lists unmatched names', async () => {
    const leaders = (await byName
      .get('get_league_player_stats')!
      .run({ range: 'season' }, ctx('469.l.101214'))) as {
      batting: { name: string }[];
      pitching: { name: string }[];
    };
    const known = leaders.batting[0]?.name ?? leaders.pitching[0]?.name;
    expect(known).toBeTruthy();

    const out = (await byName
      .get('get_player_value')!
      .run({ names: [known, 'Definitely Not A Real Player'] }, ctx('469.l.101214'))) as {
      players: { name: string; pos: string; sgptPlus?: number; sgptRank?: number }[];
      unmatched?: string[];
    };
    expect(out.players.length).toBe(1);
    expect(out.players[0]?.name).toBe(known);
    expect(typeof out.players[0]?.sgptPlus).toBe('number');
    expect(out.unmatched).toContain('Definitely Not A Real Player');
  });

  it('exposes public MLB advanced-stat and bullpen tools that need no league', () => {
    expect(byName.get('get_player_advanced_stats')?.needsLeague).toBe(false);
    expect(byName.get('get_bullpen_roles')?.needsLeague).toBe(false);
  });

  it('get_player_advanced_stats requires a name', async () => {
    await expect(byName.get('get_player_advanced_stats')!.run({}, ctx())).rejects.toBeInstanceOf(
      ToolError,
    );
  });

  it('get_bullpen_roles requires a team', async () => {
    await expect(byName.get('get_bullpen_roles')!.run({}, ctx())).rejects.toBeInstanceOf(ToolError);
  });

  it('caches league-wide reads (second call served from cache)', async () => {
    const provider = new MockFantasyProvider();
    let calls = 0;
    const spied = new Proxy(provider, {
      get(target, prop, receiver) {
        if (prop === 'getLeagueStandings') {
          return (...args: Parameters<typeof provider.getLeagueStandings>) => {
            calls += 1;
            return Reflect.get(target, prop, receiver).apply(target, args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const context: ToolContext = {
      provider: spied,
      tokens,
      cache: new TtlCache(),
      leagueId: '469.l.101214',
    };
    await byName.get('get_league_standings')!.run({}, context);
    await byName.get('get_league_standings')!.run({}, context);
    expect(calls).toBe(1);
  });
});

describe('web_search tool', () => {
  const snapshot = {
    query: 'fantasy baseball sleepers August 2026',
    results: [
      {
        title: 'Sleepers',
        url: 'https://espn.com/sleepers',
        publishedDate: '2026-08-10',
        highlights: ['buy low'],
      },
    ],
  };

  function ctxWithSources(): ToolContext & { sources: SourceRegistry } {
    return {
      provider: new MockFantasyProvider(),
      tokens,
      cache: new TtlCache(),
      sources: new SourceRegistry(),
    };
  }

  it('is omitted entirely when no web search dependency is configured', () => {
    const names = new Set(buildTools().map((t) => t.name));
    expect(names.has('web_search')).toBe(false);
  });

  it('is offered (no league needed) when a web search dependency is injected', () => {
    const webSearch: WebSearch = vi.fn(async () => snapshot);
    const tool = buildTools({ webSearch }).find((t) => t.name === 'web_search');
    expect(tool).toBeDefined();
    expect(tool!.needsLeague).toBe(false);
  });

  it('requires a query', async () => {
    const webSearch: WebSearch = vi.fn(async () => snapshot);
    const tool = buildTools({ webSearch }).find((t) => t.name === 'web_search')!;
    await expect(tool.run({}, ctxWithSources())).rejects.toBeInstanceOf(ToolError);
  });

  it('calls the injected search, records sources with citation indexes, and caches repeats', async () => {
    const webSearch = vi.fn(async () => snapshot);
    const tool = buildTools({ webSearch }).find((t) => t.name === 'web_search')!;
    const ctx = ctxWithSources();

    const out = (await tool.run({ query: snapshot.query }, ctx)) as {
      results: { index: number; url: string }[];
    };
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(out.results[0]).toMatchObject({ index: 1, url: 'https://espn.com/sleepers' });
    expect(ctx.sources.list()).toEqual([
      {
        index: 1,
        title: 'Sleepers',
        url: 'https://espn.com/sleepers',
        domain: 'espn.com',
        publishedDate: '2026-08-10',
      },
    ]);

    // Identical query within the turn is served from cache (no second Exa call).
    await tool.run({ query: snapshot.query }, ctx);
    expect(webSearch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a clean ToolError (not the raw Exa error) when search fails', async () => {
    const webSearch: WebSearch = vi.fn(async () => {
      throw new Error('boom secret-key leak');
    });
    const tool = buildTools({ webSearch }).find((t) => t.name === 'web_search')!;
    await expect(tool.run({ query: 'x' }, ctxWithSources())).rejects.toBeInstanceOf(ToolError);
  });
});
