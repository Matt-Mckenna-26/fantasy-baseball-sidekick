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
  dataMode: 'mock',
} satisfies AppConfig;

function buildApp(overrides?: Partial<FantasyProvider>) {
  const tokenStore = new InMemoryTokenStore();
  const provider: FantasyProvider = {
    getMyLeagues: vi.fn().mockResolvedValue({ userGuid: 'G', leagues: [] }),
    getLeagueRosters: vi.fn().mockResolvedValue({ leagueId: '1', teams: [] }),
    getPlayerStats: vi.fn().mockResolvedValue({ leagueId: '1', columns: [], players: [] }),
    getTeamRangeStats: vi.fn().mockResolvedValue({
      leagueId: '1',
      teamId: '1',
      range: 'season',
      battingColumns: [],
      pitchingColumns: [],
      players: [],
    }),
    getLeagueTeamStats: vi.fn().mockResolvedValue({
      leagueId: '1',
      bucket: 'season',
      weeks: [],
      battingColumns: [],
      pitchingColumns: [],
      teams: [],
    }),
    getLeagueStandings: vi.fn().mockResolvedValue({ leagueId: '1', teams: [] }),
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

  it('rosters and stats endpoints require a connected session (401)', async () => {
    const { app } = buildApp();
    const rosters = await request(app).get('/api/me/leagues/24281/rosters');
    const stats = await request(app).get('/api/me/leagues/24281/stats');
    expect(rosters.status).toBe(401);
    expect(stats.status).toBe(401);
    expect(rosters.body.error.code).toBe('unauthorized');
  });

  it('team-stats and standings endpoints require a connected session (401)', async () => {
    const { app } = buildApp();
    const teamStats = await request(app).get('/api/me/leagues/24281/team-stats');
    const standings = await request(app).get('/api/me/leagues/24281/standings');
    expect(teamStats.status).toBe(401);
    expect(standings.status).toBe(401);
    expect(teamStats.body.error.code).toBe('unauthorized');
    expect(standings.body.error.code).toBe('unauthorized');
  });

  it('transactions endpoint requires a connected session (401)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/me/leagues/24281/transactions');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('GET /api/mlb/games/:gamePk/boxscore returns a box score (public, mock mode)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/mlb/games/1/boxscore');
    expect(res.status).toBe(200);
    expect(res.body.gamePk).toBe(1);
    expect(res.body.home.teamAbbr).toBe('NYY');
    expect(res.body.home.batters.length).toBeGreaterThan(0);
    expect(res.body.away.batters.length).toBeGreaterThan(0);
  });

  it('GET /api/mlb/games/:gamePk/boxscore rejects a non-numeric gamePk (400)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/mlb/games/abc/boxscore');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('GET /api/mlb/players/gamelog returns a mock log (public, mock mode)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/mlb/players/gamelog').query({ name: 'Aaron Judge' });
    expect(res.status).toBe(200);
    expect(res.body.player).toBe('Aaron Judge');
    expect(res.body.matched).toBe(true);
    expect(res.body.batting.length).toBeGreaterThan(0);
    expect(res.body.batting[0].hr).toBeDefined();
  });

  it('GET /api/mlb/players/gamelog rejects a missing name (400)', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/mlb/players/gamelog');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('bad_request');
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
