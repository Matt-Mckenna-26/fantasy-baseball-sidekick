import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { chatStreamEventSchema } from '@fcm/contracts';
import type { AppConfig } from '../config.js';
import type { TokenStore, YahooTokens } from '../tokenStore.js';
import { InMemoryTokenStore } from '../tokenStore.js';
import { MockFantasyProvider } from '../fantasyProvider.mock.js';
import { createApp } from '../app.js';

const config = {
  yahooClientId: 'id',
  yahooClientSecret: 'secret',
  yahooRedirectUri: 'https://localhost:5173/auth/yahoo/callback',
  webAppUrl: 'https://localhost:5173',
  sessionSecret: 'x'.repeat(16),
  port: 8787,
  dataMode: 'mock',
  chatProvider: 'mock',
  azureOpenAiApiVersion: '2024-10-21',
  tokenRefreshSkewSeconds: 300,
} satisfies AppConfig;

/** A token store that reports every session as connected (skips the OAuth dance in tests). */
const alwaysConnected: TokenStore = {
  // Far-future expiry so the proactive refresh path is a no-op (no network in tests).
  get: async (): Promise<YahooTokens> => ({
    accessToken: 'a',
    refreshToken: 'r',
    expiresAt: Date.now() + 3_600_000,
  }),
  save: async () => undefined,
  clear: async () => undefined,
};

function buildApp(tokenStore: TokenStore = alwaysConnected) {
  return createApp(config, { tokenStore, provider: new MockFantasyProvider() });
}

describe('POST /api/chat', () => {
  it('returns 401 without a connected session', async () => {
    const app = buildApp(new InMemoryTokenStore());
    const res = await request(app)
      .post('/api/chat')
      .send({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('returns 400 for an invalid body', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/chat').send({ messages: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('returns 403 for a league outside the closed beta', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/chat')
      .send({ leagueId: '469.l.999999', messages: [{ role: 'user', content: 'standings?' }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('league_not_allowed');
  });

  it('streams tool activity then a grounded final reply for an allowed league (mock provider)', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/chat')
      .send({ leagueId: '469.l.101214', messages: [{ role: 'user', content: 'how are the standings?' }] });
    expect(res.status).toBe(200);

    const events = res.text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => chatStreamEventSchema.parse(JSON.parse(line)));

    // A live start/end pair for the tool the mock routes standings questions to.
    const toolEvents = events.filter((e) => e.type === 'tool');
    expect(toolEvents.some((e) => e.name === 'get_league_standings' && e.phase === 'start')).toBe(true);
    expect(
      toolEvents.some((e) => e.name === 'get_league_standings' && e.phase === 'end' && e.ok === true),
    ).toBe(true);

    // The terminating event carries the full grounded reply.
    const done = events.find((e) => e.type === 'done');
    expect(done).toBeDefined();
    if (done?.type !== 'done') throw new Error('expected a done event');
    expect(done.message.role).toBe('assistant');
    expect(done.message.content.length).toBeGreaterThan(0);
    expect(done.toolsUsed).toContain('get_league_standings');
  });
});
