/** Yahoo OAuth tokens held for a connected session. */
export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
  /**
   * Epoch milliseconds at which the access token expires. Optional for backward
   * compatibility with tokens stored before expiry tracking; when absent, callers
   * treat the token as due for a proactive refresh.
   */
  expiresAt?: number;
}

/**
 * Compute an absolute expiry (epoch ms) from Yahoo's `expires_in` (seconds).
 * Returns undefined when Yahoo omits the field, so callers fall back to
 * refresh-on-use rather than trusting a stale token.
 */
export function expiresAtFromExpiresIn(
  expiresIn: number | undefined,
  now: number = Date.now(),
): number | undefined {
  return typeof expiresIn === 'number' && Number.isFinite(expiresIn)
    ? now + expiresIn * 1000
    : undefined;
}

/**
 * Boundary for persisting per-session Yahoo tokens. Slice 1 uses an in-memory
 * implementation; a later slice swaps in Cosmos + Key Vault encryption with no
 * change to call sites (see plan-of-record two-token model).
 */
export interface TokenStore {
  get(sessionId: string): Promise<YahooTokens | undefined>;
  save(sessionId: string, tokens: YahooTokens): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

/** Process-memory token store. Not durable - for local development only. */
export class InMemoryTokenStore implements TokenStore {
  private readonly store = new Map<string, YahooTokens>();

  async get(sessionId: string): Promise<YahooTokens | undefined> {
    return this.store.get(sessionId);
  }

  async save(sessionId: string, tokens: YahooTokens): Promise<void> {
    this.store.set(sessionId, tokens);
  }

  async clear(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }
}
