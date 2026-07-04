/** Yahoo OAuth tokens held for a connected session. */
export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
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
