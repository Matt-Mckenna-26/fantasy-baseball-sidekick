import type {
  LlmMessage,
  LlmProvider,
  LlmResult,
  LlmToolCall,
  LlmToolSchema,
} from './llmProvider.js';

/**
 * Deterministic, offline LLM provider. It does NOT reason - it routes the latest user
 * message to a fixed set of read-only tools by keyword, then, once tool results are
 * present, emits a grounded summary referencing them. This keeps local dev + tests fully
 * offline and exercises the exact tool-calling loop the Azure provider drives, so the
 * orchestrator is validated without any network or key.
 */

interface Rule {
  test: RegExp;
  /** Tool names to call, in order, with static args. */
  calls: { name: string; args: Record<string, unknown> }[];
}

// Order matters: earlier rules win. Every referenced tool is optional - only those
// actually registered (passed in `tools`) are emitted.
const RULES: Rule[] = [
  // Current-web questions route to web_search first (only fires when the tool is registered,
  // i.e. an Exa key is set); the free-agent scan then grounds any names in this league.
  {
    test: /(sleeper|bust|breakout|streamer|current team|which team|what team|who (?:does|do) .+ play for|latest news|rumor|signing|traded|call-?up)/,
    calls: [
      { name: 'web_search', args: { query: 'fantasy baseball sleepers this week' } },
      { name: 'get_free_agents', args: { range: 'last30' } },
    ],
  },
  {
    test: /trade/,
    calls: [
      { name: 'get_league_rosters', args: {} },
      { name: 'get_league_team_stats', args: {} },
    ],
  },
  {
    test: /(playoff|standing|make it|clinch)/,
    calls: [
      { name: 'get_league_standings', args: {} },
      { name: 'get_matchups', args: {} },
    ],
  },
  {
    test: /(categor|target|improve|climb)/,
    calls: [
      { name: 'get_league_team_stats', args: {} },
      { name: 'get_league_standings', args: {} },
    ],
  },
  {
    test: /(free agent|waiver|pick ?up|unrostered|add|streaming|stream)/,
    calls: [{ name: 'get_free_agents', args: { range: 'last30' } }],
  },
  {
    test: /(drop|cut|bench|who should i start|start)/,
    calls: [{ name: 'get_league_rosters', args: {} }],
  },
  { test: /(matchup|opponent|this week)/, calls: [{ name: 'get_matchups', args: {} }] },
];

const DEFAULT_CALLS = [{ name: 'get_league_standings', args: {} }];

function lastUserContent(messages: LlmMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') return m.content;
  }
  return '';
}

/** Pull a short, grounded fact out of a tool-result JSON payload, best-effort. */
function factFrom(content: string): string | undefined {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    if (Array.isArray((data as { teams?: unknown[] }).teams)) {
      const teams = (data as { teams: { team?: string; rank?: number }[] }).teams;
      const leader = teams.find((t) => t.rank === 1) ?? teams[0];
      if (leader?.team) return `${leader.team} tops the group`;
    }
    const batting = (data as { batting?: { name?: string }[] }).batting;
    if (Array.isArray(batting) && batting[0]?.name) {
      return `${batting[0].name} leads the available bats`;
    }
  } catch {
    // Non-JSON or unexpected shape - skip the fact.
  }
  return undefined;
}

/** Detect a web_search result payload and return its lowest citation index, if any. */
function sourceIndexFrom(content: string): number | undefined {
  try {
    const data = JSON.parse(content) as { results?: { index?: number; url?: string }[] };
    const first = Array.isArray(data.results)
      ? data.results.find((r) => typeof r.index === 'number' && typeof r.url === 'string')
      : undefined;
    return first?.index;
  } catch {
    return undefined;
  }
}

/** Collect a few player names from tool-result payloads so the mock can tag them ([[p:Name]]). */
function playerNamesFrom(content: string): string[] {
  try {
    const data = JSON.parse(content) as Record<string, unknown>;
    const names: string[] = [];
    for (const key of ['batting', 'pitching', 'players'] as const) {
      const arr = (data as Record<string, { name?: string }[] | undefined>)[key];
      if (Array.isArray(arr) && arr[0]?.name) names.push(arr[0].name);
    }
    return names;
  } catch {
    return [];
  }
}

export class MockLlmProvider implements LlmProvider {
  complete(messages: LlmMessage[], tools: LlmToolSchema[]): Promise<LlmResult> {
    const toolNames = new Set(tools.map((t) => t.name));
    const toolResults = messages.filter((m) => m.role === 'tool');

    // Phase 2: results are in - summarize deterministically and finish (no more calls).
    if (toolResults.length > 0) {
      const facts = toolResults
        .map((m) => factFrom(m.content))
        .filter((f): f is string => Boolean(f));
      const detail = facts.length > 0 ? ` Notably, ${facts.join('; ')}.` : '';
      // Tag up to 3 unique players so the client renders their rank cards.
      const names = [...new Set(toolResults.flatMap((m) => playerNamesFrom(m.content)))].slice(
        0,
        3,
      );
      const watch =
        names.length > 0 ? ` Keep an eye on ${names.map((n) => `[[p:${n}]]`).join(', ')}.` : '';
      // Cite the first web source (if any) so the client renders a citation pill + badge.
      const srcIdx = toolResults
        .map((m) => sourceIndexFrom(m.content))
        .find((i) => i !== undefined);
      const cite =
        srcIdx !== undefined ? ` Per recent reporting[[s:${srcIdx}]], watch the wire.` : '';
      const content =
        `Here's my read based on your league data.${detail}${watch}${cite} This is analysis only - ` +
        `make any moves in Yahoo yourself. Ask a follow-up for a deeper dive on a player or category.`;
      return Promise.resolve({ content, toolCalls: [] });
    }

    // Phase 1: no tools have run yet - route the question to read-only tools.
    const text = lastUserContent(messages).toLowerCase();
    const rule = RULES.find((r) => r.test.test(text));
    const planned = (rule?.calls ?? DEFAULT_CALLS).filter((c) => toolNames.has(c.name));
    // If none of the routed tools are available (e.g. no league selected), answer directly.
    if (planned.length === 0) {
      return Promise.resolve({
        content:
          'I can help with your roster, standings, matchups, trades, and waiver targets once ' +
          'a league is selected. What would you like to dig into?',
        toolCalls: [],
      });
    }
    const toolCalls: LlmToolCall[] = planned.map((c, i) => ({
      id: `mock-call-${i}`,
      name: c.name,
      arguments: JSON.stringify(c.args),
    }));
    return Promise.resolve({ content: '', toolCalls });
  }

  /** Mirror `complete`, emitting the final answer as a single delta so the streaming path is exercised offline. */
  async stream(
    messages: LlmMessage[],
    tools: LlmToolSchema[],
    onDelta: (text: string) => void,
  ): Promise<LlmResult> {
    const result = await this.complete(messages, tools);
    if (result.toolCalls.length === 0 && result.content) onDelta(result.content);
    return result;
  }
}
