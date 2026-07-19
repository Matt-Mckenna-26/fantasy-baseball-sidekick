import type { AppConfig } from './config.js';
import { expiresAtFromExpiresIn, type TokenStore, type YahooTokens } from './tokenStore.js';
import { createYahooClient, YahooUpstreamError } from './yahooClient.js';

/**
 * Exchange a refresh token for a fresh access token via Yahoo's refresh_token grant.
 * Shared by the post-login flow (routes/auth) and the proactive refresh path here so
 * there is a single place that maps Yahoo's token response (including `expires_in`)
 * onto our {@link YahooTokens}. Never logs token material.
 */
export function refreshYahooTokens(
  config: AppConfig,
  refreshToken: string,
): Promise<YahooTokens> {
  const yf = createYahooClient(config);
  yf.setRefreshToken(refreshToken);
  return new Promise((resolve, reject) => {
    yf.refreshToken((err, data) => {
      if (err || !data?.access_token) {
        reject(err ?? new Error('Yahoo did not return a refreshed token'));
        return;
      }
      const expiresAt = expiresAtFromExpiresIn(data.expires_in);
      resolve({
        accessToken: data.access_token,
        // Yahoo may or may not rotate the refresh token; keep the prior one as a fallback.
        refreshToken: data.refresh_token ?? refreshToken,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      });
    });
  });
}

/** In-flight refresh per session, so a burst of parallel calls triggers exactly one grant. */
const inFlight = new Map<string, Promise<YahooTokens>>();

export interface EnsureFreshTokensDeps {
  sessionId: string;
  store: TokenStore;
  config: AppConfig;
  /** Injectable clock + refresh for tests; default to the real ones. */
  now?: () => number;
  refresh?: (config: AppConfig, refreshToken: string) => Promise<YahooTokens>;
}

/**
 * Resolve the session's Yahoo tokens, proactively refreshing them when they are at or
 * within the configured skew window of expiry. This moves the refresh cost off the
 * hot path (before the provider fans out its parallel Yahoo calls) instead of paying
 * a mid-request 401 -> refresh -> retry on the first expired call.
 *
 * Concurrent callers for the same session share one refresh via a single-flight map,
 * which avoids the thundering herd of parallel refreshes that races Yahoo's refresh-
 * token rotation (the source of the intermittent forced re-logins). A refresh failure
 * clears the session's tokens and surfaces an auth failure so the caller returns 401.
 *
 * Returns undefined when the session has no tokens at all (caller should send 401).
 */
export async function ensureFreshTokens(deps: EnsureFreshTokensDeps): Promise<YahooTokens | undefined> {
  const { sessionId, store, config } = deps;
  const now = deps.now ?? Date.now;
  const refresh = deps.refresh ?? refreshYahooTokens;

  const tokens = await store.get(sessionId);
  if (!tokens) return undefined;

  const skewMs = config.tokenRefreshSkewSeconds * 1000;
  // A known expiry that is still comfortably in the future needs no refresh. When the
  // expiry is unknown (tokens stored before expiry tracking), refresh to be safe.
  if (typeof tokens.expiresAt === 'number' && now() < tokens.expiresAt - skewMs) {
    return tokens;
  }

  const existing = inFlight.get(sessionId);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const refreshed = await refresh(config, tokens.refreshToken);
      await store.save(sessionId, refreshed);
      return refreshed;
    } catch (err) {
      // A failed refresh means the stored refresh token no longer works; drop it so the
      // user is prompted to reconnect rather than retrying a dead token every request.
      await store.clear(sessionId);
      throw new YahooUpstreamError('Yahoo token refresh failed', {
        transient: false,
        authFailure: true,
        cause: err,
      });
    } finally {
      inFlight.delete(sessionId);
    }
  })();
  inFlight.set(sessionId, pending);
  return pending;
}
