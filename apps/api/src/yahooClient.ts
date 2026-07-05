import YahooFantasy from 'yahoo-fantasy';
import type { AppConfig } from './config.js';
import type { YahooTokens } from './tokenStore.js';

export type OnTokensRefreshed = (tokens: YahooTokens) => void | Promise<void>;

/**
 * How long a single Yahoo Fantasy HTTP attempt may run before we give up on it.
 * Yahoo occasionally returns a non-JSON throttle body ("Request denied"); the
 * upstream library's response handler throws on JSON.parse and never settles the
 * promise, so the timeout is what lets us abandon that hung attempt and retry.
 */
const API_TIMEOUT_MS = 9000;

/**
 * At most this many tries per Yahoo HTTP call (initial attempt + retries). Keeps a
 * single upstream call from holding the user's request open too long.
 */
const MAX_ATTEMPTS = 3;

/** Pause before each retry after the first failure; length must be MAX_ATTEMPTS - 1. */
const RETRY_WAITS_MS = [400, 800];

/** An error surfaced from the Yahoo Fantasy upstream, safe to map at the API boundary. */
export class YahooUpstreamError extends Error {
  /** True when the failure looks transient (timeout, reset, throttle) and worth retrying. */
  readonly transient: boolean;
  /** True when Yahoo rejected the session token — client should sign in again (401). */
  readonly authFailure: boolean;
  /** The original library/network error, kept for server-side logging only. */
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts: { transient: boolean; authFailure?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'YahooUpstreamError';
    this.transient = opts.transient;
    this.authFailure = opts.authFailure ?? false;
    this.cause = opts.cause;
  }
}

/** Best-effort human-readable message from a thrown value (Error, string, or Yahoo error object). */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    if (typeof record.description === 'string') return record.description;
    try {
      return JSON.stringify(record);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Whether Yahoo rejected the OAuth token (do not retry — user must sign in again). */
function isAuthFailure(err: unknown): boolean {
  if (err instanceof YahooUpstreamError) return err.authFailure;
  return /token.?reject|oauth_problem|invalid.?token|unauthorized|additional_authorization|\b401\b/i.test(
    messageOf(err),
  );
}

/** Whether a failure is likely transient and safe to retry (throttling, timeouts, resets). */
function isTransient(err: unknown): boolean {
  if (isAuthFailure(err)) return false;
  if (err instanceof YahooUpstreamError) return err.transient;
  return /request denied|throttl|rate.?limit|econnreset|econnrefused|etimedout|socket hang up|eai_again|network|timeout|\b50[234]\b/i.test(
    messageOf(err),
  );
}

/**
 * Detects the specific yahoo-fantasy failure where a non-JSON upstream body makes the
 * library throw a SyntaxError from JSON.parse inside its response callback. Because that
 * throw is detached from the returned promise, it lands as an uncaughtException; the
 * server-level guard uses this to keep serving instead of dying (see server.ts).
 */
export function isYahooMalformedResponseCrash(err: unknown): boolean {
  return err instanceof SyntaxError && /yahoo-?fantasy|YahooFantasy/.test(err.stack ?? '');
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Reject with a timeout error if `promise` does not settle within `ms` (the hung attempt is abandoned). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new YahooUpstreamError(`Yahoo request timed out (${label})`, {
            transient: true,
            authFailure: false,
          }),
        ),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/** Run a Yahoo call with a timeout and at most MAX_ATTEMPTS tries on transient failures. */
async function withYahooRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isAuthFailure(err)) break;
      const wait = RETRY_WAITS_MS[attempt];
      if (wait !== undefined && isTransient(err)) {
        await delay(wait);
        continue;
      }
      break;
    }
  }
  if (lastErr instanceof YahooUpstreamError) throw lastErr;
  throw new YahooUpstreamError(`Yahoo request failed (${label}): ${messageOf(lastErr)}`, {
    transient: isTransient(lastErr),
    authFailure: isAuthFailure(lastErr),
    cause: lastErr,
  });
}

/**
 * Wrap the client's single HTTP choke point (`api()`, which every resource helper calls)
 * with a timeout and bounded retry. This is where a malformed/throttled Yahoo response is
 * contained so it surfaces as a clean, retryable error instead of a hung request.
 */
function wrapApiWithResilience(yf: YahooFantasy): void {
  const originalApi = yf.api.bind(yf) as YahooFantasy['api'];
  yf.api = (<T>(method: string, url: string, postData?: unknown): Promise<T> => {
    // Log only method + path; the query string and auth headers are never included.
    const label = `${method} ${url.split('?')[0]}`;
    return withYahooRetry<T>(() => withTimeout<T>(originalApi<T>(method, url, postData), API_TIMEOUT_MS, label), label);
  }) as YahooFantasy['api'];
}

/**
 * Build a configured yahoo-fantasy client. The refresh callback fires when the
 * library silently refreshes an expired access token, so callers can persist the
 * new tokens for the session. The client's HTTP layer is wrapped with a timeout and
 * bounded retry so intermittent Yahoo failures are contained (see wrapApiWithResilience).
 */
export function createYahooClient(
  config: AppConfig,
  onTokensRefreshed?: OnTokensRefreshed,
): YahooFantasy {
  const yf = new YahooFantasy(
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
  wrapApiWithResilience(yf);
  return yf;
}
