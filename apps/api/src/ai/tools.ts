import {
  statRangeSchema,
  teamStatBucketSchema,
  type StatRange,
  type TeamStatBucket,
} from '@fcm/contracts';
import type { FantasyProvider, FreeAgentsQuery } from '../fantasyProvider.js';
import type { YahooTokens } from '../tokenStore.js';
import type { OnTokensRefreshed } from '../yahooClient.js';
import { isLeagueAllowed } from '../closedBeta.js';
import { enrichPlayer, getPlayerNews, getProbableStarters } from '../mlbClient.js';
import { getPlayerAdvancedStats } from '../mlbAdvanced.js';
import { getBullpenRoles } from '../mlbBullpen.js';
import { withSgptRank } from '../sgptRank.js';
import { getScoredFreeAgents } from '../freeAgentValue.js';
import type { WebSearch } from '../exaClient.js';
import type { PlayerRegistry } from './playerRegistry.js';
import type { SourceRegistry } from './sourceRegistry.js';
import { TtlCache, TTL } from './cache.js';
import {
  snapshotFreeAgents,
  snapshotLeagueTeamStats,
  snapshotMatchups,
  snapshotPlayerLeaders,
  snapshotRosters,
  snapshotStandings,
  snapshotTeamPlayers,
  snapshotTransactions,
  snapshotValueScores,
} from './snapshots.js';

/** Context every tool executor receives (bound per chat request by the orchestrator). */
export interface ToolContext {
  provider: FantasyProvider;
  tokens: YahooTokens;
  leagueId?: string;
  onTokensRefreshed?: OnTokensRefreshed;
  cache: TtlCache;
  /** Collects the raw player identities each tool fetches, for post-reply mention resolution. */
  registry?: PlayerRegistry;
  /** Collects the web articles web_search returned, for post-reply citation badges. */
  sources?: SourceRegistry;
}

/** A read-only tool the model can call: a JSON-schema contract plus an executor. */
export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Whether the tool needs a selected, allowed league (Yahoo tools) vs public MLB. */
  needsLeague: boolean;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

/** Thrown when a tool cannot run (e.g. no league selected, or league not admitted). */
export class ToolError extends Error {}

/** Resolve the required, allowed leagueId or throw a clear ToolError (deny-by-default). */
function requireLeague(ctx: ToolContext): string {
  if (!ctx.leagueId) throw new ToolError('No league is selected for this conversation.');
  if (!isLeagueAllowed(ctx.leagueId))
    throw new ToolError('This league is not in the closed beta group.');
  return ctx.leagueId;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseRange(value: unknown, fallback: StatRange): StatRange {
  const parsed = statRangeSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

const rangeParam = {
  range: {
    type: 'string',
    enum: ['today', 'last7', 'last14', 'last21', 'last30', 'season'],
    description:
      'Time window for stats. Defaults to season. last14 and last21 are only available when the MLB stats source is enabled.',
  },
};

/** Optional dependencies that unlock extra tools when configured. */
export interface ToolDeps {
  /** When provided (Exa key set), the co-manager gains the `web_search` tool. */
  webSearch?: WebSearch;
}

/** Build the read-only tool registry. Pure factory so tests can inspect schemas. */
export function buildTools(deps: ToolDeps = {}): ChatTool[] {
  const { webSearch } = deps;
  return [
    {
      name: 'get_league_standings',
      description:
        "The league standings: each team's rank, wins, losses, win %, and games back. Use for playoff-odds and 'where do I stand' questions.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      needsLeague: true,
      async run(_args, ctx) {
        const leagueId = requireLeague(ctx);
        return ctx.cache.wrap(`${leagueId}:standings`, TTL.standings, async () =>
          snapshotStandings(
            await ctx.provider.getLeagueStandings(ctx.tokens, leagueId, ctx.onTokensRefreshed),
          ),
        );
      },
    },
    {
      name: 'get_matchups',
      description:
        'Head-to-head matchups for the current fantasy week, with per-team categories won/lost/tied. Use for weekly outlook and playoff-race questions.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      needsLeague: true,
      async run(_args, ctx) {
        const leagueId = requireLeague(ctx);
        return ctx.cache.wrap(`${leagueId}:matchups`, TTL.matchups, async () =>
          snapshotMatchups(
            await ctx.provider.getLeagueMatchups(ctx.tokens, leagueId, ctx.onTokensRefreshed),
          ),
        );
      },
    },
    {
      name: 'get_league_rosters',
      description:
        "Every fantasy team's roster (players and their positions). Use to find trade partners, compare rosters, or locate a specific manager's players.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      needsLeague: true,
      async run(_args, ctx) {
        const leagueId = requireLeague(ctx);
        return ctx.cache.wrap(`${leagueId}:rosters`, TTL.rosters, async () => {
          const dto = await ctx.provider.getLeagueRosters(
            ctx.tokens,
            leagueId,
            ctx.onTokensRefreshed,
          );
          ctx.registry?.addPlayers(dto.teams.flatMap((t) => t.slots.map((s) => s.player)));
          return snapshotRosters(dto);
        });
      },
    },
    {
      name: 'get_league_team_stats',
      description:
        "Aggregated scoring-category totals for every fantasy team over a bucket ('season', a week number, or last2weeks/last3weeks/last4weeks). Use for 'which categories should I target' and team-strength comparisons.",
      parameters: {
        type: 'object',
        properties: {
          bucket: {
            type: 'string',
            description:
              "'season' (default), a fantasy week number, or last2weeks/last3weeks/last4weeks.",
          },
        },
        additionalProperties: false,
      },
      needsLeague: true,
      async run(args, ctx) {
        const leagueId = requireLeague(ctx);
        const raw = asString(args.bucket) ?? 'season';
        const candidate: unknown = /^\d+$/.test(raw) ? Number(raw) : raw;
        const parsed = teamStatBucketSchema.safeParse(candidate);
        const bucket: TeamStatBucket = parsed.success ? parsed.data : 'season';
        return ctx.cache.wrap(`${leagueId}:teamStats:${String(bucket)}`, TTL.teamStats, async () =>
          snapshotLeagueTeamStats(
            await ctx.provider.getLeagueTeamStats(
              ctx.tokens,
              leagueId,
              bucket,
              ctx.onTokensRefreshed,
            ),
          ),
        );
      },
    },
    {
      name: 'get_team_stats',
      description:
        "One fantasy team's players with their scoring-category values over a window. Use for start/sit and drop candidates. teamId comes from get_league_rosters or get_league_standings.",
      parameters: {
        type: 'object',
        properties: {
          teamId: { type: 'string', description: "The fantasy team's id." },
          ...rangeParam,
        },
        required: ['teamId'],
        additionalProperties: false,
      },
      needsLeague: true,
      async run(args, ctx) {
        const leagueId = requireLeague(ctx);
        const teamId = asString(args.teamId);
        if (!teamId) throw new ToolError('teamId is required for get_team_stats.');
        const range = parseRange(args.range, 'last30');
        return ctx.cache.wrap(`${leagueId}:team:${teamId}:${range}`, TTL.teamStats, async () => {
          const dto = await ctx.provider.getTeamRangeStats(
            ctx.tokens,
            leagueId,
            teamId,
            range,
            ctx.onTokensRefreshed,
          );
          ctx.registry?.addPlayers(dto.players.map((p) => p.player));
          return snapshotTeamPlayers(dto);
        });
      },
    },
    {
      name: 'get_league_player_stats',
      description:
        'The top rostered players league-wide (batting and pitching leaders) over a window. Use to gauge player value and benchmark against replacement level.',
      parameters: { type: 'object', properties: { ...rangeParam }, additionalProperties: false },
      needsLeague: true,
      async run(args, ctx) {
        const leagueId = requireLeague(ctx);
        const range = parseRange(args.range, 'season');
        return ctx.cache.wrap(`${leagueId}:players:${range}`, TTL.playerStats, async () => {
          const dto = withSgptRank(
            await ctx.provider.getPlayerStats(ctx.tokens, leagueId, range, ctx.onTokensRefreshed),
          );
          ctx.registry?.addPlayers(
            dto.batting.players.map((p) => p.player),
            'B',
          );
          ctx.registry?.addPlayers(
            dto.pitching.players.map((p) => p.player),
            'P',
          );
          return snapshotPlayerLeaders(dto);
        });
      },
    },
    {
      name: 'get_player_value',
      description:
        "Value+ scores for specific players by name. Value+ (returned as sgptPlus / sgptRank) is a single composite index (100 = league average, higher is better) from each player's percentiles across the LEAGUE'S scoring categories; sgptRank spans hitters and pitchers on ONE scale. ALWAYS call this for trades and player-vs-player value compares (including hitter vs pitcher) - Value+ is an important anchor, then explain category fit, role, form, and luck. Also use for add/drop and start/sit when overall value matters. Returns each requested player with sgptPlus, sgptRank, and their category stats; unmatched names are listed separately.",
      parameters: {
        type: 'object',
        properties: {
          names: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Full names of the players to value/compare (rostered players). For unrostered players, use get_free_agents, which now also returns Value+.',
          },
          ...rangeParam,
        },
        required: ['names'],
        additionalProperties: false,
      },
      needsLeague: true,
      async run(args, ctx) {
        const leagueId = requireLeague(ctx);
        const names = Array.isArray(args.names)
          ? args.names.map((n) => asString(n)).filter((n): n is string => Boolean(n))
          : [];
        if (names.length === 0) throw new ToolError('names is required for get_player_value.');
        const range = parseRange(args.range, 'season');
        const dto = await ctx.cache.wrap(`${leagueId}:sgpt:${range}`, TTL.playerStats, async () =>
          withSgptRank(
            await ctx.provider.getPlayerStats(ctx.tokens, leagueId, range, ctx.onTokensRefreshed),
          ),
        );
        // Register the whole pool so any player the reply tags resolves to a stat card.
        ctx.registry?.addPlayers(
          dto.batting.players.map((p) => p.player),
          'B',
        );
        ctx.registry?.addPlayers(
          dto.pitching.players.map((p) => p.player),
          'P',
        );
        return snapshotValueScores(dto, names);
      },
    },
    {
      name: 'get_free_agents',
      description:
        "Unrostered (or waiver-available) players for the league over a window, split into batting and pitching, each with Value+ (sgptPlus/sgptRank) scored against your ROSTERED pool - so a pickup's value is directly comparable to the players you already have (e.g. it would slot in around #45 among rostered). Sorted best-Value+ first. Use for pickup/streaming targets. Optionally filter by position. Note: Value+ is cumulative/backward-looking, so a low-inning or recently injured arm can be unscored or understated - lean on ROS projections (web_search) there.",
      parameters: {
        type: 'object',
        properties: {
          ...rangeParam,
          position: { type: 'string', description: 'Filter to a position, e.g. SP, OF, 2B.' },
          availability: {
            type: 'string',
            enum: ['FA', 'A'],
            description: 'FA = free agents only (default); A = available (free agents + waivers).',
          },
        },
        additionalProperties: false,
      },
      needsLeague: true,
      async run(args, ctx) {
        const leagueId = requireLeague(ctx);
        const range = parseRange(args.range, 'last30');
        const availability = args.availability === 'A' ? 'A' : 'FA';
        const position = asString(args.position);
        const query: FreeAgentsQuery = { range, availability, ...(position ? { position } : {}) };
        const key = `${leagueId}:freeAgents:${range}:${availability}:${position ?? 'all'}`;
        return ctx.cache.wrap(key, TTL.freeAgents, async () => {
          // Score free agents' Value+ against the rostered pool, reusing get_player_value's
          // cached pool (same `${leagueId}:sgpt:${range}` entry) to avoid a duplicate fetch.
          const dto = await getScoredFreeAgents(
            ctx.provider,
            ctx.tokens,
            leagueId,
            query,
            ctx.onTokensRefreshed,
            {
              loadRostered: (r) =>
                ctx.cache.wrap(`${leagueId}:sgpt:${r}`, TTL.playerStats, async () =>
                  withSgptRank(
                    await ctx.provider.getPlayerStats(ctx.tokens, leagueId, r, ctx.onTokensRefreshed),
                  ),
                ),
            },
          );
          ctx.registry?.addPlayers(
            dto.batting.players.map((p) => p.player),
            'B',
          );
          ctx.registry?.addPlayers(
            dto.pitching.players.map((p) => p.player),
            'P',
          );
          return snapshotFreeAgents(dto);
        });
      },
    },
    {
      name: 'get_recent_transactions',
      description:
        'Recent league roster moves (adds, drops/waivers, and trades), newest first, each with the date, teams, and players involved. Use to see how rosters have changed lately - who was just picked up off waivers, dropped, or traded - before advising on pickups, trades, or category strategy.',
      parameters: {
        type: 'object',
        properties: {
          count: {
            type: 'number',
            description: 'How many recent transactions to return (default 25, max 50).',
          },
        },
        additionalProperties: false,
      },
      needsLeague: true,
      async run(args, ctx) {
        const leagueId = requireLeague(ctx);
        const raw = typeof args.count === 'number' ? Math.trunc(args.count) : 25;
        const count = Math.min(Math.max(raw, 1), 50);
        return ctx.cache.wrap(`${leagueId}:transactions:${count}`, TTL.transactions, async () => {
          const dto = await ctx.provider.getLeagueTransactions(
            ctx.tokens,
            leagueId,
            count,
            ctx.onTokensRefreshed,
          );
          // Register the moved players so [[p:Name]] mentions in the reply resolve to
          // identities. Transactions carry no eligible positions, so default to [].
          ctx.registry?.addPlayers(
            dto.transactions.flatMap((tx) =>
              tx.players.map((p) => ({
                playerId: p.playerId,
                fullName: p.fullName,
                eligiblePositions: [],
                ...(p.mlbTeamAbbr ? { mlbTeamAbbr: p.mlbTeamAbbr } : {}),
                ...(p.positionType ? { positionType: p.positionType } : {}),
              })),
            ),
          );
          return snapshotTransactions(dto);
        });
      },
    },
    {
      name: 'get_player_mlb_stats',
      description:
        'Real current-season MLB stats (from the public MLB Stats API) for a specific player by name, plus team and position. Use to enrich analysis of a named player. Returns {matched:false} when no confident match.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Player's full name." },
          team: { type: 'string', description: 'Optional MLB team abbreviation to disambiguate.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      needsLeague: false,
      async run(args, ctx) {
        const name = asString(args.name);
        if (!name) throw new ToolError('name is required for get_player_mlb_stats.');
        const team = asString(args.team);
        return ctx.cache.wrap(`mlb:stats:${name.toLowerCase()}:${team ?? ''}`, TTL.mlb, async () =>
          enrichPlayer(name, { ...(team ? { teamAbbr: team } : {}) }),
        );
      },
    },
    {
      name: 'get_player_advanced_stats',
      description:
        "Advanced / expected ('luck') season stats for a player by name, from the public MLB Stats API. Pairs surface results with their Statcast-expected counterparts (AVG vs xBA, SLG vs xSLG, xwOBA) plus BABIP, K%/BB% (hitters) or K/9, BB/9, HR/9 (pitchers), and a buy-low/sell-high read. Use to judge whether a hot or cold stretch is real, or to spot regression risk and buy-low targets. Season-level only. Returns {matched:false} when no confident match.",
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Player's full name." },
          team: { type: 'string', description: 'Optional MLB team abbreviation to disambiguate.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      needsLeague: false,
      async run(args, ctx) {
        const name = asString(args.name);
        if (!name) throw new ToolError('name is required for get_player_advanced_stats.');
        const team = asString(args.team);
        return ctx.cache.wrap(
          `mlb:advanced:${name.toLowerCase()}:${team ?? ''}`,
          TTL.advanced,
          async () => getPlayerAdvancedStats(name, { ...(team ? { teamAbbr: team } : {}) }),
        );
      },
    },
    {
      name: 'get_bullpen_roles',
      description:
        "A team's bullpen save-role hierarchy (closer / setup / middle) inferred from recent relief usage - saves, save opportunities, games finished, and holds over the last ~30 days, from the public MLB Stats API. Use before recommending any reliever for saves (SV, SV+H) or holds (HD) so you name the pitcher actually getting the chances, and to flag committees. Takes an MLB team abbreviation (e.g. NYY, LAD).",
      parameters: {
        type: 'object',
        properties: {
          team: { type: 'string', description: 'MLB team abbreviation, e.g. NYY, LAD, SD.' },
        },
        required: ['team'],
        additionalProperties: false,
      },
      needsLeague: false,
      async run(args, ctx) {
        const team = asString(args.team);
        if (!team) throw new ToolError('team is required for get_bullpen_roles.');
        return ctx.cache.wrap(`mlb:bullpen:${team.toLowerCase()}`, TTL.bullpen, async () =>
          getBullpenRoles(team),
        );
      },
    },
    {
      name: 'get_player_news',
      description:
        'Recent MLB roster transactions for a player (IL moves, activations, call-ups, trades) as free news, from the public MLB Stats API. Use to check availability/injury context before recommending a player.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: "Player's full name." },
          team: { type: 'string', description: 'Optional MLB team abbreviation to disambiguate.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      needsLeague: false,
      async run(args, ctx) {
        const name = asString(args.name);
        if (!name) throw new ToolError('name is required for get_player_news.');
        const team = asString(args.team);
        return ctx.cache.wrap(`mlb:news:${name.toLowerCase()}:${team ?? ''}`, TTL.mlb, async () =>
          getPlayerNews(name, { ...(team ? { teamAbbr: team } : {}) }),
        );
      },
    },
    {
      name: 'get_probable_starters',
      description:
        'Announced probable starting pitchers for upcoming MLB games over the next N days (default 7, max 7), grouped by date, from the public MLB Stats API. Each entry gives the pitcher, their team, the opponent, and home/away. Use for streaming and two-start-pitcher planning, or to see which starters a hitter will face. Optionally filter to one MLB team.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'How many days ahead to include, counting today (default 7, max 7).',
          },
          team: {
            type: 'string',
            description: 'Optional MLB team abbreviation to filter to, e.g. NYY, LAD.',
          },
        },
        additionalProperties: false,
      },
      needsLeague: false,
      async run(args, ctx) {
        const raw = typeof args.days === 'number' ? Math.trunc(args.days) : 7;
        const days = Math.min(Math.max(raw, 1), 7);
        const team = asString(args.team);
        return ctx.cache.wrap(
          `mlb:probables:${days}:${team?.toLowerCase() ?? 'all'}`,
          TTL.mlb,
          async () => getProbableStarters({ days, ...(team ? { teamAbbr: team } : {}) }),
        );
      },
    },
    // web_search is only offered when an Exa key is configured (deps.webSearch injected).
    ...(webSearch
      ? [
          {
            name: 'web_search',
            description:
              "Search the public web for CURRENT baseball/fantasy context the Yahoo and MLB tools can't provide: this week's sleepers/busts/streamers, a player's CURRENT MLB team, recent trades/signings, injury rumors and beat-writer news, and expert rankings. Your own training data on rosters and roles is stale - use this instead of guessing (e.g. which team a player is on now). Always put the current month and year in the query (e.g. 'fantasy baseball sleepers August 2026', 'what team does Pete Alonso play for 2026'). Do NOT use this for league standings, rosters, matchups, or scoring-category stats - those come from the Yahoo tools. Cite results in your reply with [[s:N]] using each result's `index`.",
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description:
                    'Natural-language web search query. Include the current month and year for time-sensitive questions.',
                },
                recencyDays: {
                  type: 'number',
                  description:
                    'Optional: only return results published within this many days (e.g. 14 for "this week"). Omit for the default ~9-month window.',
                },
              },
              required: ['query'],
              additionalProperties: false,
            },
            needsLeague: false,
            async run(args: Record<string, unknown>, ctx: ToolContext) {
              const query = asString(args.query);
              if (!query) throw new ToolError('query is required for web_search.');
              const recencyDays =
                typeof args.recencyDays === 'number' && args.recencyDays > 0
                  ? Math.trunc(args.recencyDays)
                  : undefined;
              const snapshot = await ctx.cache.wrap(
                `web:${query.toLowerCase()}:${recencyDays ?? ''}`,
                TTL.webSearch,
                async () => {
                  try {
                    return await webSearch(query, recencyDays ? { recencyDays } : {});
                  } catch {
                    // Don't leak the Exa error/key to the model; surface a clean tool error.
                    throw new ToolError('Web search is unavailable right now.');
                  }
                },
              );
              // Assign stable citation indexes and hand the model results it can cite as [[s:N]].
              const results = ctx.sources?.add(snapshot.results) ?? snapshot.results;
              return { query: snapshot.query, results };
            },
          },
        ]
      : []),
  ];
}
