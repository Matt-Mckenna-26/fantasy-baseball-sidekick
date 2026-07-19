import { describe, it, expect } from 'vitest';
import { MockLlmProvider } from './llmProvider.mock.js';
import type { LlmMessage, LlmToolSchema } from './llmProvider.js';

const provider = new MockLlmProvider();

const schema = (name: string): LlmToolSchema => ({ name, description: name, parameters: {} });
const ALL_TOOLS = [
  'get_league_standings',
  'get_matchups',
  'get_league_rosters',
  'get_league_team_stats',
  'get_free_agents',
].map(schema);

const userTurn = (content: string): LlmMessage[] => [{ role: 'user', content }];

describe('MockLlmProvider routing', () => {
  it('routes trade questions to rosters + team stats', async () => {
    const res = await provider.complete(userTurn('find me potential trade partners'), ALL_TOOLS);
    expect(res.toolCalls.map((c) => c.name)).toEqual(['get_league_rosters', 'get_league_team_stats']);
  });

  it('routes playoff questions to standings + matchups', async () => {
    const res = await provider.complete(userTurn('am I going to make the playoffs?'), ALL_TOOLS);
    expect(res.toolCalls.map((c) => c.name)).toEqual(['get_league_standings', 'get_matchups']);
  });

  it('routes waiver/free-agent questions to get_free_agents', async () => {
    const res = await provider.complete(userTurn('any unrostered players I should pick up?'), ALL_TOOLS);
    expect(res.toolCalls.map((c) => c.name)).toEqual(['get_free_agents']);
  });

  it('only emits calls for tools that are registered', async () => {
    const res = await provider.complete(userTurn('trade partners?'), [schema('get_league_rosters')]);
    expect(res.toolCalls.map((c) => c.name)).toEqual(['get_league_rosters']);
  });

  it('answers directly (no tools) when none are available', async () => {
    const res = await provider.complete(userTurn('who should I drop?'), []);
    expect(res.toolCalls).toHaveLength(0);
    expect(res.content).not.toBe('');
  });

  it('summarizes once tool results are present (phase 2)', async () => {
    const messages: LlmMessage[] = [
      { role: 'user', content: 'standings?' },
      { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'get_league_standings', arguments: '{}' }] },
      {
        role: 'tool',
        toolCallId: '1',
        content: JSON.stringify({ teams: [{ team: 'Bronx Bombers', rank: 1 }] }),
      },
    ];
    const res = await provider.complete(messages, ALL_TOOLS);
    expect(res.toolCalls).toHaveLength(0);
    expect(res.content).toContain('Bronx Bombers');
  });
});
