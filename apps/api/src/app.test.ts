import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import type { AppConfig } from './config.js';
import { InMemoryTokenStore } from './tokenStore.js';
import type { FantasyProvider } from './fantasyProvider.js';
import { createApp } from './app.js';

const config = {
  yahooClientId: 'id',
  yahooClientSecret: 'secret',
  yahooRedirectUri: 'https://localhost:5173/auth/yahoo/callback',
  webAppUrl: 'https://localhost:5173',
  sessionSecret: 'x'.repeat(16),
  port: 8787,
} satisfies AppConfig;

function buildApp(overrides?: Partial<FantasyProvider>) {
  const tokenStore = new InMemoryTokenStore();
  const provider: FantasyProvider = {
    getMyLeagues: vi.fn().mockResolvedValue({ userGuid: 'G', leagues: [] }),
    ...overrides,
  };
  return { app: createApp(config, { tokenStore, provider }), tokenStore, provider };
}

describe('API app', () => {
  it('GET /health returns ok', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/me/leagues returns 401 without a connected session', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/me/leagues');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('GET /auth/status reports not authenticated for a fresh session', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: false });
  });

  it('unknown routes return a 404 error envelope', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});
