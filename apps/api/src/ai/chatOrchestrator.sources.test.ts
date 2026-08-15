import { describe, it, expect, vi } from 'vitest';
import { MockFantasyProvider } from '../fantasyProvider.mock.js';
import type { YahooTokens } from '../tokenStore.js';
import type { WebSearch } from '../exaClient.js';
import { runChat } from './chatOrchestrator.js';
import { buildTools } from './tools.js';
import type { LlmProvider, LlmResult } from './llmProvider.js';

const tokens: YahooTokens = { accessToken: 'a', refreshToken: 'r' };

/** A scripted LLM that yields a fixed sequence of results. */
class ScriptedLlm implements LlmProvider {
  constructor(private readonly script: LlmResult[]) {}
  complete(): Promise<LlmResult> {
    return Promise.resolve(this.script.shift() ?? { content: 'done', toolCalls: [] });
  }
}

const snapshot = {
  query: 'what team does Pete Alonso play for 2026',
  results: [
    {
      title: 'Alonso to Baltimore',
      url: 'https://mlb.com/alonso',
      publishedDate: '2026-08-01',
      highlights: ['now an Oriole'],
    },
    { title: 'Signing analysis', url: 'https://espn.com/alonso', highlights: ['fantasy impact'] },
  ],
};

describe('runChat web-source citations', () => {
  it('collects web_search results into sourcesCited and keeps [[s:N]] markers for the client', async () => {
    const webSearch: WebSearch = vi.fn(async () => snapshot);
    const llm = new ScriptedLlm([
      {
        content: '',
        toolCalls: [
          { id: '1', name: 'web_search', arguments: JSON.stringify({ query: snapshot.query }) },
        ],
      },
      {
        content: 'He plays for the Orioles now[[s:1]], per recent reporting[[s:2]].',
        toolCalls: [],
      },
    ]);

    const res = await runChat({
      messages: [{ role: 'user', content: 'what team is pete alonso on?' }],
      tokens,
      provider: new MockFantasyProvider(),
      llm,
      tools: buildTools({ webSearch }),
    });

    // The [[s:N]] markers survive into the message so the client can render inline pills.
    expect(res.message.content).toContain('[[s:1]]');
    expect(res.message.content).toContain('[[s:2]]');
    // Both unique https sources are attached with stable 1-based indexes + parsed domains.
    expect(res.sourcesCited).toEqual([
      {
        index: 1,
        title: 'Alonso to Baltimore',
        url: 'https://mlb.com/alonso',
        domain: 'mlb.com',
        publishedDate: '2026-08-01',
      },
      { index: 2, title: 'Signing analysis', url: 'https://espn.com/alonso', domain: 'espn.com' },
    ]);
  });

  it('omits sourcesCited when no web search ran', async () => {
    const llm = new ScriptedLlm([{ content: 'No web needed.', toolCalls: [] }]);
    const res = await runChat({
      messages: [{ role: 'user', content: 'hi' }],
      tokens,
      provider: new MockFantasyProvider(),
      llm,
      tools: buildTools(),
    });
    expect(res.sourcesCited).toBeUndefined();
  });
});
