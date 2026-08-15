import { describe, it, expect, vi } from 'vitest';
import { MockFantasyProvider } from '../fantasyProvider.mock.js';
import type { YahooTokens } from '../tokenStore.js';
import {
  looksLikeLeakedToolCall,
  looksLikeStalledPlan,
  runChat,
  stripLeakedToolJson,
  stripLeakedToolSyntax,
} from './chatOrchestrator.js';
import type { LlmProvider, LlmResult, LlmToolSchema } from './llmProvider.js';

/** The exact kind of garbled harmony tool-call leak seen from some Azure deployments. */
const LEAKED_TOOLCALL =
  "I'll search for Jhoan Duran news (August 2026). Searching web for Jhoan Duran Aug 2026... " +
  'to=functions.web_search hais_json_payloadielsRemainingBrowsingCallsAvoidLargeResponseContinuingAnyway code>';

const tokens: YahooTokens = { accessToken: 'a', refreshToken: 'r' };
const LEAGUE = '469.l.101214';

/** A scripted LLM that yields a fixed sequence of results, recording the schemas seen. */
class ScriptedLlm implements LlmProvider {
  seenSchemas: LlmToolSchema[][] = [];
  constructor(private readonly script: LlmResult[]) {}
  complete(_messages: unknown[], tools: LlmToolSchema[]): Promise<LlmResult> {
    this.seenSchemas.push(tools);
    return Promise.resolve(this.script.shift() ?? { content: 'done', toolCalls: [] });
  }
}

describe('runChat orchestrator', () => {
  it('runs a tool then returns the grounded final answer', async () => {
    const llm = new ScriptedLlm([
      { content: '', toolCalls: [{ id: '1', name: 'get_league_standings', arguments: '{}' }] },
      { content: 'The Bombers are in first.', toolCalls: [] },
    ]);
    const res = await runChat({
      messages: [{ role: 'user', content: 'standings?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
    });
    expect(res.message.role).toBe('assistant');
    expect(res.message.content).toBe('The Bombers are in first.');
    expect(res.toolsUsed).toContain('get_league_standings');
  });

  it('emits a start then a successful end event for each tool it runs', async () => {
    const llm = new ScriptedLlm([
      { content: '', toolCalls: [{ id: '1', name: 'get_league_standings', arguments: '{}' }] },
      { content: 'done', toolCalls: [] },
    ]);
    const events: {
      name: string;
      phase: 'start' | 'end';
      ok?: boolean;
      args?: string;
      result?: string;
    }[] = [];
    await runChat({
      messages: [{ role: 'user', content: 'standings?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
      onToolEvent: (e) => events.push(e),
    });
    expect(events).toHaveLength(2);
    // 'start' carries the model's raw args; 'end' carries the outcome plus the tool output.
    expect(events[0]).toEqual({ name: 'get_league_standings', phase: 'start', args: '{}' });
    expect(events[1]).toMatchObject({ name: 'get_league_standings', phase: 'end', ok: true });
    expect(typeof events[1]?.result).toBe('string');
    expect(events[1]?.result?.length).toBeGreaterThan(0);
  });

  it('feeds a ToolError back as data rather than crashing', async () => {
    const llm = new ScriptedLlm([
      { content: '', toolCalls: [{ id: '1', name: 'get_team_stats', arguments: '{}' }] },
      { content: 'I need a team id.', toolCalls: [] },
    ]);
    const res = await runChat({
      messages: [{ role: 'user', content: 'my team stats' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
    });
    expect(res.message.content).toBe('I need a team id.');
    expect(res.toolsUsed).toContain('get_team_stats');
  });

  it('bounds the tool-call loop and forces a final answer', async () => {
    // Always ask for a tool while tools are offered; the forced final call has none.
    const alwaysTool: LlmProvider = {
      complete(_m, tools) {
        if (tools.length === 0) return Promise.resolve({ content: 'final', toolCalls: [] });
        return Promise.resolve({
          content: '',
          toolCalls: [{ id: 'x', name: 'get_league_standings', arguments: '{}' }],
        });
      },
    };
    const res = await runChat({
      messages: [{ role: 'user', content: 'loop please' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm: alwaysTool,
    });
    expect(res.message.content).toBe('final');
  });

  it('aggregates token usage across calls', async () => {
    const llm = new ScriptedLlm([
      {
        content: '',
        toolCalls: [{ id: '1', name: 'get_league_standings', arguments: '{}' }],
        usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      },
      {
        content: 'ok',
        toolCalls: [],
        usage: { promptTokens: 200, completionTokens: 20, totalTokens: 220 },
      },
    ]);
    const res = await runChat({
      messages: [{ role: 'user', content: 'standings?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
    });
    expect(res.usage).toEqual({ promptTokens: 300, completionTokens: 30, totalTokens: 330 });
  });

  it('offers only public tools when no league is selected', async () => {
    const llm = new ScriptedLlm([{ content: 'hello', toolCalls: [] }]);
    await runChat({
      messages: [{ role: 'user', content: 'hi' }],
      tokens,
      provider: new MockFantasyProvider(),
      llm,
    });
    const offered = llm.seenSchemas[0]!.map((s) => s.name);
    expect(offered).toContain('get_player_mlb_stats');
    expect(offered).not.toContain('get_league_standings');
  });

  it('retries (dropping the leaked text) when the model narrates a tool call instead of calling it', async () => {
    const llm = new ScriptedLlm([
      // Round 1: garbled harmony tool-call leaked as text, no structured call.
      { content: LEAKED_TOOLCALL, toolCalls: [] },
      // Round 2 (after the nudge): a real, clean answer.
      { content: '**Start [[p:Jhoan Duran]].** He owns the ninth inning.', toolCalls: [] },
    ]);
    const onResetAssistant = vi.fn();
    const res = await runChat({
      messages: [{ role: 'user', content: 'is duran worth starting?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
      onResetAssistant,
    });
    // The turn finishes with the real analysis, not the leaked plumbing.
    expect(res.message.content).toBe('**Start Jhoan Duran.** He owns the ninth inning.');
    expect(res.message.content).not.toContain('to=functions');
    // The streamed leaked preamble was discarded on the client.
    expect(onResetAssistant).toHaveBeenCalled();
  });

  it('drops a stalled "I\'ll search..." plan and retries until it delivers the real answer', async () => {
    const llm = new ScriptedLlm([
      // Round 1: the model narrates a plan (plus a bare query line) but makes no tool call.
      {
        content:
          "I'll pull rest-of-season projection pages for the top free agents, then match them to your needs.\n" +
          '"Casey Schmitt rest of season projections August 2026 FantasyPros"',
        toolCalls: [],
      },
      // Round 2 (after the nudge): it actually issues the tool call it had only described.
      { content: '', toolCalls: [{ id: '1', name: 'get_league_standings', arguments: '{}' }] },
      // Round 3: the complete analysis.
      { content: '**Grab [[p:Casey Schmitt]].** Best ROS value on the wire.', toolCalls: [] },
    ]);
    const onResetAssistant = vi.fn();
    const res = await runChat({
      messages: [{ role: 'user', content: 'best free agents to research?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
      onResetAssistant,
    });
    expect(res.message.content).toBe('**Grab Casey Schmitt.** Best ROS value on the wire.');
    expect(res.message.content).not.toContain("I'll pull");
    expect(res.toolsUsed).toContain('get_league_standings');
    expect(onResetAssistant).toHaveBeenCalled();
  });

  it('sanitizes a leaked tool-call tail if it survives into the final answer', async () => {
    // Model keeps leaking every round; the forced tool-less final answer still carries a tail.
    const alwaysLeaks: LlmProvider = {
      complete: () =>
        Promise.resolve({ content: `Here is my read. ${LEAKED_TOOLCALL}`, toolCalls: [] }),
    };
    const res = await runChat({
      messages: [{ role: 'user', content: 'sleepers?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm: alwaysLeaks,
    });
    expect(res.message.content).not.toContain('to=functions');
    expect(res.message.content).not.toContain('code>');
    expect(res.message.content).toContain('Here is my read.');
  });

  it('strips tool-call/result JSON the model narrates as plain text in the final answer', async () => {
    const leaked =
      'Calling player Value+ for candidates from your roster. ' +
      '{"name":"functions.get_player_value","arguments":{"names":["Roki Sasaki"],"range":"season"}} ' +
      '{"players":[{"name":"Roki Sasaki","pos":"P","sgptPlus":126}]} ' +
      'Yes — buy-low on **Chris Sale**.';
    const llm = new ScriptedLlm([{ content: leaked, toolCalls: [] }]);
    const res = await runChat({
      messages: [{ role: 'user', content: 'trade targets?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
    });
    expect(res.message.content).not.toContain('"arguments"');
    expect(res.message.content).not.toContain('"players"');
    expect(res.message.content).toContain('Calling player Value+');
    expect(res.message.content).toContain('buy-low on **Chris Sale**');
  });
});

describe('stripLeakedToolJson', () => {
  it('removes a narrated function-call payload but keeps the surrounding prose', () => {
    const out = stripLeakedToolJson(
      'Checking values. {"name":"functions.get_player_value","arguments":{"names":["A"]}} Here is my read.',
    );
    expect(out).toBe('Checking values. Here is my read.');
  });

  it('removes an object-array tool result with nested braces intact', () => {
    const out = stripLeakedToolJson(
      'Data: {"players":[{"name":"A","stats":{"HR":34}},{"name":"B"}]} done',
    );
    expect(out).toBe('Data: done');
  });

  it('leaves ordinary prose, markdown, and code untouched', () => {
    const md =
      '**Drop Player X.**\n\n### Why\n- Use `{"a":1}` inline.\n\n```json\n{"kept":true}\n```';
    expect(stripLeakedToolJson(md)).toBe(md);
  });

  it('does not treat markdown links or simple arrays as JSON', () => {
    const text = 'See [the docs](http://x) and pick [1, 2, 3] of them.';
    expect(stripLeakedToolJson(text)).toBe(text);
  });
});

describe('leaked tool-call detection and sanitizing', () => {
  it('flags harmony/plain-text tool-call leaks but not ordinary prose', () => {
    expect(looksLikeLeakedToolCall(LEAKED_TOOLCALL)).toBe(true);
    expect(looksLikeLeakedToolCall('Calling functions.web_search({"query":"x"})')).toBe(true);
    expect(looksLikeLeakedToolCall('<|channel|>commentary')).toBe(true);
    // Ordinary answers that merely mention web search must not trip the detector.
    expect(looksLikeLeakedToolCall('I used web search to confirm his team.')).toBe(false);
    expect(looksLikeLeakedToolCall('**Start Jhoan Duran.** He owns the ninth.')).toBe(false);
  });

  it('cuts the leaked fragment (and garbled tail) while keeping the real prose before it', () => {
    expect(stripLeakedToolSyntax('Here is my read. to=functions.web_search {q} code>')).toBe(
      'Here is my read.',
    );
    // The full harmony leak (with its own "Searching..." connector) is removed down to the prose.
    expect(stripLeakedToolSyntax(`My analysis stands. ${LEAKED_TOOLCALL}`)).not.toContain(
      'to=functions',
    );
    expect(stripLeakedToolSyntax('Clean answer, no leak.')).toBe('Clean answer, no leak.');
  });
});

describe('stalled-plan detection', () => {
  it('flags intent-only preambles and bare query lines', () => {
    expect(looksLikeStalledPlan("I'll pull rest-of-season projection pages for your wire.")).toBe(
      true,
    );
    expect(looksLikeStalledPlan('Proceeding to gather ROS pages now.')).toBe(true);
    expect(looksLikeStalledPlan('Searching the web for his current role...')).toBe(true);
    expect(
      looksLikeStalledPlan('"Joc Pederson rest of season projections August 2026 FantasyPros"'),
    ).toBe(true);
  });

  it('does not flag a finished, structured answer (even if it says "I\'ll check back")', () => {
    expect(
      looksLikeStalledPlan(
        "**Add Casey Schmitt.**\n\n### Why\n- Strong ROS projection.\n\nI'll check back after tonight.",
      ),
    ).toBe(false);
    expect(looksLikeStalledPlan('He owns the ninth inning now, so start him.')).toBe(false);
    expect(looksLikeStalledPlan('')).toBe(false);
  });
});
