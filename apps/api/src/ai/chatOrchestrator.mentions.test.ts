import { describe, it, expect } from 'vitest';
import { MockFantasyProvider } from '../fantasyProvider.mock.js';
import type { YahooTokens } from '../tokenStore.js';
import { runChat } from './chatOrchestrator.js';
import type { LlmProvider, LlmResult } from './llmProvider.js';

const tokens: YahooTokens = { accessToken: 'a', refreshToken: 'r' };
const LEAGUE = '469.l.101214';

/** A scripted LLM that yields a fixed sequence of results. */
class ScriptedLlm implements LlmProvider {
  constructor(private readonly script: LlmResult[]) {}
  complete(): Promise<LlmResult> {
    return Promise.resolve(this.script.shift() ?? { content: 'done', toolCalls: [] });
  }
}

describe('runChat player-tag resolution', () => {
  it('resolves [[p:Name]] tags (from fetched data) to playersMentioned and strips the markers', async () => {
    // The model fetches free agents, then features a known mock free agent by tag.
    const llm = new ScriptedLlm([
      { content: '', toolCalls: [{ id: '1', name: 'get_free_agents', arguments: '{}' }] },
      { content: 'Grab [[p:Nolan Schanuel]] for cheap power.', toolCalls: [] },
    ]);
    const res = await runChat({
      messages: [{ role: 'user', content: 'any waiver adds?' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
    });

    // Marker is stripped from the rendered text.
    expect(res.message.content).toBe('Grab Nolan Schanuel for cheap power.');
    // The tagged player is resolved to a stable Yahoo id for the UI cards.
    expect(res.playersMentioned).toBeDefined();
    expect(res.playersMentioned).toEqual([
      expect.objectContaining({ playerId: 'fa-b1', fullName: 'Nolan Schanuel', positionType: 'B' }),
    ]);
  });

  it('omits playersMentioned when a tagged name was never returned by a tool', async () => {
    const llm = new ScriptedLlm([{ content: 'Consider [[p:Nobody Real]].', toolCalls: [] }]);
    const res = await runChat({
      messages: [{ role: 'user', content: 'hi' }],
      leagueId: LEAGUE,
      tokens,
      provider: new MockFantasyProvider(),
      llm,
    });
    expect(res.message.content).toBe('Consider Nobody Real.');
    expect(res.playersMentioned).toBeUndefined();
  });
});
