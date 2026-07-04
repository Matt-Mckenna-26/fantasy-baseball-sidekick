import YahooFantasy from 'yahoo-fantasy';
import type { AppConfig } from './config.js';
import type { YahooTokens } from './tokenStore.js';

export type OnTokensRefreshed = (tokens: YahooTokens) => void | Promise<void>;

/**
 * Build a configured yahoo-fantasy client. The refresh callback fires when the
 * library silently refreshes an expired access token, so callers can persist the
 * new tokens for the session.
 */
export function createYahooClient(
  config: AppConfig,
  onTokensRefreshed?: OnTokensRefreshed,
): YahooFantasy {
  return new YahooFantasy(
    config.yahooClientId,
    config.yahooClientSecret,
    async (data) => {
      if (onTokensRefreshed) {
        await onTokensRefreshed({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
        });
      }
    },
    config.yahooRedirectUri,
  );
}
