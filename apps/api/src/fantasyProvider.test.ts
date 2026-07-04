import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { YahooUserGameLeaguesResult } from 'yahoo-fantasy';
import type { AppConfig } from './config.js';

vi.mock('./yahooClient.js', () => ({ createYahooClient: vi.fn() }));

import { createYahooClient } from './yahooClient.js';
import { mapUserLeaguesToDto, YahooFantasyProvider } from './fantasyProvider.js';

const config = {
  yahooClientId: 'id',
  yahooClientSecret: 'secret',
  yahooRedirectUri: 'https://localhost:5173/auth/yahoo/callback',
  webAppUrl: 'https://localhost:5173',
  sessionSecret: 'x'.repeat(16),
  port: 8787,
} satisfies AppConfig;

const sampleResult: YahooUserGameLeaguesResult = {
  guid: 'GUID123',
  games: [
    {
      game_key: '431',
      game_id: '431',
      name: 'Baseball',
      code: 'mlb',
      season: '2026',
      leagues: [
        { league_key: '431.l.111', league_id: '111', name: 'FKL Baseball', season: '2026' },
        { league_key: '431.l.222', league_id: '222', name: 'Freddy Beach', season: '2026' },
      ],
    },
  ],
};

describe('mapUserLeaguesToDto', () => {
  it('flattens games -> leagues into the DTO', () => {
    expect(mapUserLeaguesToDto(sampleResult)).toEqual({
      userGuid: 'GUID123',
      leagues: [
        { leagueId: '111', name: 'FKL Baseball', season: '2026' },
        { leagueId: '222', name: 'Freddy Beach', season: '2026' },
      ],
    });
  });

  it('handles a result with no games or leagues', () => {
    expect(mapUserLeaguesToDto({ guid: 'G' } as YahooUserGameLeaguesResult)).toEqual({
      userGuid: 'G',
      leagues: [],
    });
  });
});

describe('YahooFantasyProvider.getMyLeagues', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets tokens on the client and maps the response', async () => {
    const gameLeagues = vi.fn().mockResolvedValue(sampleResult);
    const setUserToken = vi.fn();
    const setRefreshToken = vi.fn();
    vi.mocked(createYahooClient).mockReturnValue({
      setUserToken,
      setRefreshToken,
      user: { game_leagues: gameLeagues },
    } as unknown as ReturnType<typeof createYahooClient>);

    const provider = new YahooFantasyProvider(config);
    const dto = await provider.getMyLeagues({ accessToken: 'a', refreshToken: 'r' });

    expect(setUserToken).toHaveBeenCalledWith('a');
    expect(setRefreshToken).toHaveBeenCalledWith('r');
    expect(gameLeagues).toHaveBeenCalledWith('mlb');
    expect(dto.leagues).toHaveLength(2);
    expect(dto.userGuid).toBe('GUID123');
  });
});
