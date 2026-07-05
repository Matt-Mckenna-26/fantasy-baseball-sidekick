import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import session, { type SessionData } from 'express-session';
import { API_DIR } from './config.js';
import type { TokenStore, YahooTokens } from './tokenStore.js';

/**
 * Local-dev persistence backed by JSON files. Its sole purpose is to survive the
 * frequent process restarts from `tsx watch`, so a code change no longer forces a
 * re-login. NOT for production: tokens are stored unencrypted on disk (the
 * plan-of-record moves these to Cosmos + Key Vault). The directory is gitignored.
 */
const STATE_DIR = resolve(API_DIR, '.dev-state');

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    // A corrupt dev-state file should never crash startup - start clean instead.
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value), 'utf8');
}

/** File-backed {@link TokenStore} for local dev only. */
export class FileTokenStore implements TokenStore {
  private readonly file = resolve(STATE_DIR, 'tokens.json');
  private readonly store: Map<string, YahooTokens>;

  constructor() {
    this.store = new Map(Object.entries(readJson<Record<string, YahooTokens>>(this.file, {})));
  }

  private persist(): void {
    writeJson(this.file, Object.fromEntries(this.store));
  }

  async get(sessionId: string): Promise<YahooTokens | undefined> {
    return this.store.get(sessionId);
  }

  async save(sessionId: string, tokens: YahooTokens): Promise<void> {
    this.store.set(sessionId, tokens);
    this.persist();
  }

  async clear(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
    this.persist();
  }
}

/**
 * File-backed express-session store for local dev only. Keeps the session (and
 * therefore the stable `sessionID` the token store is keyed by) alive across
 * restarts. Writes are synchronous - acceptable for a single-developer dev server.
 */
export class FileSessionStore extends session.Store {
  private readonly file = resolve(STATE_DIR, 'sessions.json');
  private readonly sessions: Map<string, SessionData>;

  constructor() {
    super();
    this.sessions = new Map(Object.entries(readJson<Record<string, SessionData>>(this.file, {})));
  }

  private persist(): void {
    writeJson(this.file, Object.fromEntries(this.sessions));
  }

  get = (
    sid: string,
    cb: (err: unknown, session?: SessionData | null) => void,
  ): void => {
    cb(null, this.sessions.get(sid) ?? null);
  };

  set = (sid: string, sess: SessionData, cb?: (err?: unknown) => void): void => {
    this.sessions.set(sid, sess);
    this.persist();
    cb?.();
  };

  destroy = (sid: string, cb?: (err?: unknown) => void): void => {
    this.sessions.delete(sid);
    this.persist();
    cb?.();
  };

  override touch = (sid: string, sess: SessionData, cb?: (err?: unknown) => void): void => {
    this.sessions.set(sid, sess);
    this.persist();
    cb?.();
  };
}
