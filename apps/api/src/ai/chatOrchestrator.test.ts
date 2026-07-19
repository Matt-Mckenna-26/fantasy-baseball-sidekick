import { describe, it, expect } from 'vitest';
import { MockFantasyProvider } from '../fantasyProvider.mock.js';
import type { YahooTokens } from '../tokenStore.js';
import { runChat } from './chatOrchestrator.js';
import type { LlmProvider, LlmResult, LlmToolSchema } from './llmProvider.js';

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
    const events: { name: string; phase: 'start' | 'end'; ok?: boolean }[] = [];
    await runChat({
      messages: [{ role: 'user', content: 'standings?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
      onToolEvent: (e) => events.push(e),
    });
    expect(events).toEqual([
      { name: 'get_league_standings', phase: 'start' },
      { name: 'get_league_standings', phase: 'end', ok: true },
    ]);
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
});
