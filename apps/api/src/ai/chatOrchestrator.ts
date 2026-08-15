import type { ChatMessage, ChatTurn, ChatUsage, MentionedPlayer } from '@fcm/contracts';
import type { FantasyProvider } from '../fantasyProvider.js';
import type { YahooTokens } from '../tokenStore.js';
import type { OnTokensRefreshed } from '../yahooClient.js';
import type { LlmMessage, LlmProvider, LlmResult, LlmToolSchema, LlmUsage } from './llmProvider.js';
import { buildTools, ToolError, type ChatTool, type ToolContext } from './tools.js';
import { PlayerRegistry } from './playerRegistry.js';
import { TtlCache } from './cache.js';

/** Bounds that keep token spend + latency predictable (see plan-of-record AI design).
 * Rounds allow multi-step chains (e.g. standings -> rosters -> team stats -> free agents)
 * to complete without the model punting back to the user. */
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY_TURNS = 12;
const MAX_INPUT_CHARS = 4000;
const MAX_TOOL_RESULT_CHARS = 4000;

/**
 * High-level co-manager persona. The goal is always insightful, realistic, grounded
 * analysis; the model must call tools for facts and must never invent data or claim to
 * have made a roster move (the app is read-only).
 */
export const SYSTEM_PROMPT = [
  'You are "TheShowGPT", an AI co-manager for the user\'s Yahoo fantasy baseball team. Your',
  'goal is always to deliver insightful, realistic, and grounded analysis and advice, using',
  'every piece of available context (league settings, standings, matchups, rosters, category-',
  'and player-level stats, recent trends, injuries, and MLB context).',
  '',
  'Operating principles:',
  '- Ground every claim in data. Call the read-only tools for rosters, standings, matchups, team/player category stats, free agents, recent league transactions (adds, drops/waivers, trades), and MLB enrichment (real season stats and recent transactions) before advising. Never invent stats, players, standings, or transactions. If data is missing, say so.',
  '- Be fully autonomous. Never ask the user for information you can obtain yourself with tools (team ids, rosters, standings, stats, player data, injury news). Gather what you need across as many tool calls as it takes, THEN answer. The league is already selected for you - do not ask which league.',
  "- Chain tools when one result feeds the next. To analyze the user's own team, first call get_league_rosters (or get_league_standings) and match the user's team name to its teamId, then call get_team_stats with that teamId. Never stop to ask the user for a teamId - look it up.",
  '- For saves/holds: before recommending any reliever for saves (SV, SV+H) or holds (HD), call get_bullpen_roles for that pitcher\'s MLB team and recommend the arm actually getting the chances (the derived closer/setup). Only call someone "the closer" when the usage supports it, and flag committees/unsettled situations instead of guessing.',
  '- Judge luck before trusting a hot or cold line: for a featured hitter or pitcher, call get_player_advanced_stats and compare results to the expected numbers (AVG vs xBA, SLG vs xSLG, BABIP). Frame over-performers as regression/sell-high risks and under-performers with strong underlying contact as buy-low targets, rather than taking surface stats at face value.',
  "- Always weigh Value+ in trades and player comparisons: whenever the user asks about a trade, swap, buy/sell, or which player is more valuable - including a hitter vs a pitcher - call get_player_value for every named player involved before advising. Value+ (fields sgptPlus / sgptRank) is a single index (100 = league average, higher is better) from percentiles across THIS league's scoring categories; its rank spans hitters and pitchers on one scale. Cite each player's Value+ score and overall rank early in the answer. Value+ is important but not the only factor - also weigh category fit for THIS team, role/playing time, recent form, luck (advanced/expected stats), injury risk, and positional need. Do not invent Value+ for players the tool did not return.",
  "- Only ask a clarifying question as a last resort when the request is genuinely ambiguous about the user's INTENT - never for data you can retrieve.",
  '- Be realistic and honest about uncertainty. Distinguish signal from small-sample noise, and treat outlooks (like playoff odds) as probabilities, not guarantees.',
  '- READ-ONLY: you recommend moves; the user executes them in Yahoo. Never claim to have made a change.',
  '- Be concise and decision-first: lead with the recommendation, then the 1-3 reasons that matter most, citing concrete numbers.',
  '',
  'Format every reply as clean, scannable Markdown for a chat UI:',
  '- Open with a bold one-sentence answer or recommendation (e.g. "**Drop Player X.**").',
  '- Group supporting detail under short "###" section headers (e.g. "### Why", "### Alternatives", "### Watch").',
  '- Use bullet lists where each bullet is one idea, leading with a bold label and the key number(s) (e.g. "- **Power:** 22 HR, .540 SLG - your biggest need.").',
  '- Use a compact Markdown table ONLY when comparing 3+ options across the same columns (e.g. candidates x categories).',
  '- Keep it tight: no walls of text, no restating the question, no raw HTML. Bold the player/team names and numbers that drive the decision.',
  '- Player tags: the FIRST time you feature a specific player (a recommendation, comparison, drop/add/trade target, or notable performer), wrap their name in a tag: [[p:Full Name]] - e.g. "[[p:Aaron Judge]] anchors your power". Use the exact full name from the tool data, tag only real players the tools returned (never teams), and tag each player at most once. The app renders a stat card for tagged players.',
  '',
  'How to think (Socratic self-questioning): before answering, silently work through the',
  'questions below. Do NOT dump the full Q&A on the user - surface only the conclusions and',
  'the few numbers that justify them.',
  '',
  'Ask yourself, "What makes this a great fantasy TEAM?"',
  '- Which categories does this format reward, and is the roster balanced across all of them, or strong in a few while punting others? Is any punt intentional and viable, or an accidental hole?',
  '- Where does the team win, lose, and tie in a typical week? Which 1-2 categories are the cheapest to flip from a loss to a win?',
  '- Is it built on a stable floor (reliable everyday contributors) or a fragile ceiling (boom/bust, injury-prone, part-time)? What is the risk profile?',
  '- How is positional scarcity handled (C, MI, SP vs RP, elite closers)? Is value concentrated in stars or spread thin?',
  '- Does it exploit volume (games, PAs, innings, two-start weeks, save opportunities), or leave points on the table?',
  '- Given standings and remaining schedule, should it play to win now, target specific categories, or sell for the future?',
  '',
  'Ask yourself, "What makes this a great fantasy PLAYER for THIS team?"',
  '- What is their Value+ (call get_player_value) relative to alternatives - important overall anchor, then dig into categories.',
  '- What does the player contribute per category, and does it fill a need or pile onto a strength?',
  '- Is the value from rate stats (AVG/OBP/OPS, ERA/WHIP) or counting stats (HR/R/RBI/SB, W/K/SV)? Rate stats dilute; counting stats depend on volume and role.',
  '- Is the role secure (everyday lineup spot, top-of-order ABs, rotation slot, the 9th-inning job)? Playing time is often the biggest value driver.',
  '- What does recent form (last7/last30) say versus the season line - improving, regressing, steady? Is a hot streak real or variance?',
  '- What is the surrounding context (lineup, park, matchup, IL/DTD status) and how does it affect near-term expectations?',
  "- What is the player's value above replacement at their position versus what's freely available on waivers?",
  '',
  "Always tie advice back to this specific team's categories, needs, and situation. If a tool returns no match or missing data, say so plainly instead of guessing.",
].join('\n');

export interface RunChatParams {
  messages: ChatTurn[];
  leagueId?: string;
  /** The user's own team name in this league (so the bot knows "my team" without asking). */
  teamName?: string;
  /** The league's display name, for natural references. */
  leagueName?: string;
  tokens: YahooTokens;
  onTokensRefreshed?: OnTokensRefreshed;
  provider: FantasyProvider;
  llm: LlmProvider;
  /** Injectable for tests; defaults to the full registry. */
  tools?: ChatTool[];
  /** Injectable for tests; defaults to a fresh per-request cache. */
  cache?: TtlCache;
  /**
   * Fired as each read-only tool starts and finishes, so the route can stream live
   * activity to the UI. 'start' carries the model's `args`; 'end' carries the outcome and
   * the tool's (already-truncated) `result`, so the UI can offer an expandable detail. This
   * is the same authenticated user's own league data - never tokens or another user's data.
   */
  onToolEvent?: (event: {
    name: string;
    phase: 'start' | 'end';
    ok?: boolean;
    args?: string;
    result?: string;
  }) => void;
  /**
   * Fired with each chunk of the assistant's reply text as it streams, so the route can
   * forward the answer token-by-token. Only set when the provider supports streaming.
   */
  onAssistantDelta?: (text: string) => void;
  /**
   * Fired to discard any streamed text buffered so far, when a completion that emitted
   * preamble text turns out to be a tool-calling step (that text was not the answer).
   */
  onResetAssistant?: () => void;
}

export interface ChatResult {
  message: ChatMessage;
  toolsUsed: string[];
  usage?: ChatUsage;
  /** Players the reply featured (via [[p:Name]] tags), resolved to Yahoo player identities. */
  playersMentioned?: MentionedPlayer[];
}

/** Matches a player tag the model emits: [[p:Full Name]]. */
const MENTION_RE = /\[\[p:([^\]]+)\]\]/g;

function extractMentionNames(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(MENTION_RE)) {
    const name = m[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

/** Remove the tag syntax, leaving the plain player name in the rendered reply. */
function stripMentionMarkers(content: string): string {
  return content.replace(MENTION_RE, '$1');
}

/**
 * Index just past a balanced JSON object/array starting at `start` (respecting strings and
 * escapes), or -1 if it never closes. Used to carve out embedded JSON without a full parser.
 */
function jsonSpanEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** A parsed JSON value that looks like leaked tool plumbing: a non-empty object, or an
 *  array of objects (tool results and function-call payloads; never ordinary prose). */
function looksLikeToolPayload(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return (
      value.length > 0 &&
      value.every((e) => e !== null && typeof e === 'object' && !Array.isArray(e))
    );
  }
  return Object.keys(value).length > 0;
}

/**
 * Some models occasionally narrate a tool call by emitting the raw function-call JSON and/or
 * the tool-result payload as literal reply text instead of using the structured tool-calling
 * channel. That JSON is internal plumbing - never the answer - so strip any bare, balanced
 * JSON object/array that parses cleanly, leaving fenced/inline code and ordinary prose intact.
 * The tool inputs/outputs are still surfaced to the UI via the structured `tool` events.
 */
export function stripLeakedToolJson(content: string): string {
  let out = '';
  let i = 0;
  const n = content.length;
  while (i < n) {
    if (content.startsWith('```', i)) {
      const close = content.indexOf('```', i + 3);
      const stop = close === -1 ? n : close + 3;
      out += content.slice(i, stop);
      i = stop;
      continue;
    }
    if (content[i] === '`') {
      const close = content.indexOf('`', i + 1);
      const stop = close === -1 ? n : close + 1;
      out += content.slice(i, stop);
      i = stop;
      continue;
    }
    const ch = content[i];
    if (ch === '{' || ch === '[') {
      const end = jsonSpanEnd(content, i);
      if (end !== -1) {
        try {
          if (looksLikeToolPayload(JSON.parse(content.slice(i, end)))) {
            i = end;
            // Swallow a space that now sits between the text before and after the removed
            // JSON, so the gap doesn't leave a stray double space.
            if (out.endsWith(' ')) {
              while (i < n && (content[i] === ' ' || content[i] === '\t')) i++;
            }
            continue;
          }
        } catch {
          // Not valid JSON - fall through and keep the character as prose.
        }
      }
    }
    out += ch;
    i++;
  }
  // Tidy the newline gaps left where JSON was removed.
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toSchema(tool: ChatTool): LlmToolSchema {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

/** Trim a user/assistant turn to the input cap so history stays token-bounded. */
function cap(content: string): string {
  return content.length > MAX_INPUT_CHARS ? `${content.slice(0, MAX_INPUT_CHARS)}...` : content;
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Sum optional token counts across LLM calls; undefined when nothing was reported. */
function addUsage(total: ChatUsage | undefined, next: LlmUsage | undefined): ChatUsage | undefined {
  if (!next) return total;
  const base = total ?? {};
  return {
    promptTokens: (base.promptTokens ?? 0) + (next.promptTokens ?? 0),
    completionTokens: (base.completionTokens ?? 0) + (next.completionTokens ?? 0),
    totalTokens: (base.totalTokens ?? 0) + (next.totalTokens ?? 0),
  };
}

/**
 * A context line identifying the signed-in user's own team, so the co-manager treats
 * "my team"/"I"/"me" as this team and never asks who the user is. Derived from what the
 * authenticated UI already knows (the selected league + the user's team in it).
 */
function userContext(params: RunChatParams): string {
  const team = params.teamName ? `the fantasy team "${params.teamName}"` : 'their fantasy team';
  const league = params.leagueName ? ` in the league "${params.leagueName}"` : '';
  return (
    `The user is the manager of ${team}${league}. When they say "my team", "I", "me", or ` +
    '"us", they mean this team. Do not ask which team they manage - you already know.'
  );
}

function finalMessage(content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      content.trim() ||
      "I couldn't put together an answer just now. Try rephrasing, or ask about your roster, standings, or waiver targets.",
    createdAt: new Date().toISOString(),
  };
}

/** Assemble the final result: strip player tags from the text and resolve them to identities. */
function buildResult(
  rawContent: string,
  toolsUsed: Set<string>,
  usage: ChatUsage | undefined,
  registry: PlayerRegistry,
): ChatResult {
  const players = registry.resolve(extractMentionNames(rawContent));
  return {
    message: finalMessage(stripMentionMarkers(stripLeakedToolJson(rawContent))),
    toolsUsed: [...toolsUsed],
    ...(usage ? { usage } : {}),
    ...(players.length > 0 ? { playersMentioned: players } : {}),
  };
}

/**
 * Run one chat turn: assemble the prompt, let the model call read-only tools in a bounded
 * loop, and return the grounded reply plus which tools ran and the token usage.
 */
export async function runChat(params: RunChatParams): Promise<ChatResult> {
  const allTools = params.tools ?? buildTools();
  const cache = params.cache ?? new TtlCache();
  // With no league selected, only public (MLB) tools are offered; Yahoo tools need a league.
  const tools = params.leagueId ? allTools : allTools.filter((t) => !t.needsLeague);
  const toolByName = new Map(tools.map((t) => [t.name, t]));
  const toolSchemas = tools.map(toSchema);

  const registry = new PlayerRegistry();
  const ctx: ToolContext = {
    provider: params.provider,
    tokens: params.tokens,
    cache,
    registry,
    ...(params.leagueId ? { leagueId: params.leagueId } : {}),
    ...(params.onTokensRefreshed ? { onTokensRefreshed: params.onTokensRefreshed } : {}),
  };

  const history = params.messages.slice(-MAX_HISTORY_TURNS);
  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(params.teamName || params.leagueName
      ? [{ role: 'system' as const, content: userContext(params) }]
      : []),
    ...history.map((m) => ({ role: m.role, content: cap(m.content) })),
  ];

  const toolsUsed = new Set<string>();
  let usage: ChatUsage | undefined;

  // Stream the reply when the provider (and caller) support it, so the answer renders
  // token-by-token. Falls back to a single buffered call otherwise.
  const streamComplete = params.llm.stream?.bind(params.llm);
  const onDelta = params.onAssistantDelta;
  const runCompletion = (schemas: LlmToolSchema[]): Promise<LlmResult> =>
    streamComplete && onDelta
      ? streamComplete(messages, schemas, onDelta)
      : params.llm.complete(messages, schemas);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await runCompletion(toolSchemas);
    usage = addUsage(usage, result.usage);

    if (result.toolCalls.length === 0) {
      return buildResult(result.content, toolsUsed, usage, registry);
    }

    // This completion was a tool step, not the answer, so drop any preamble text it streamed.
    params.onResetAssistant?.();
    messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls });

    // Run this round's tool calls concurrently. They're all read-only, so there's no ordering
    // dependency, and the wall-clock cost of a multi-tool round (the common "analyze my team"
    // flow) drops from the sum of the Yahoo reads to the slowest single one. Results are
    // appended in call order afterward so each tool message still lines up with its tool_call.
    const toolResults = await Promise.all(
      result.toolCalls.map(async (call) => {
        toolsUsed.add(call.name);
        params.onToolEvent?.({ name: call.name, phase: 'start', args: call.arguments });
        const tool = toolByName.get(call.name);
        let content: string;
        let ok = true;
        if (!tool) {
          ok = false;
          content = JSON.stringify({ error: `Unknown tool: ${call.name}` });
        } else {
          try {
            const out = await tool.run(safeParseArgs(call.arguments), ctx);
            const json = JSON.stringify(out);
            content =
              json.length > MAX_TOOL_RESULT_CHARS
                ? `${json.slice(0, MAX_TOOL_RESULT_CHARS)}...(truncated)`
                : json;
          } catch (err) {
            // Surface allowlist/validation issues to the model as data, not a crash.
            ok = false;
            content = JSON.stringify({
              error: err instanceof ToolError ? err.message : 'Tool call failed.',
            });
          }
        }
        params.onToolEvent?.({ name: call.name, phase: 'end', ok, result: content });
        return { call, content };
      }),
    );
    for (const { call, content } of toolResults) {
      messages.push({ role: 'tool', content, toolCallId: call.id });
    }
  }

  // Rounds exhausted: force a final text answer with tools disabled (streamed when supported).
  const finalRes = await runCompletion([]);
  usage = addUsage(usage, finalRes.usage);
  return buildResult(finalRes.content, toolsUsed, usage, registry);
}
