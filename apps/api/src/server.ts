import { loadConfig } from './config.js';
import { InMemoryTokenStore } from './tokenStore.js';
import { FileTokenStore, FileSessionStore } from './devStore.js';
import { createFantasyProvider } from './fantasyProvider.js';
import { createApp } from './app.js';
import { isYahooMalformedResponseCrash } from './yahooClient.js';

// The yahoo-fantasy library parses responses inside an HTTP callback that is detached
// from its returned promise, so a non-JSON body (e.g. Yahoo's "Request denied" throttle
// page) throws a SyntaxError that would otherwise crash the whole process. That request
// still fails cleanly via its own timeout/retry; here we keep the server alive rather than
// letting one bad upstream body take the API down. Anything genuinely unexpected still exits.
process.on('uncaughtException', (err) => {
  if (isYahooMalformedResponseCrash(err)) {
    console.error('[yahoo] Ignored malformed-response crash from yahoo-fantasy:', err.message);
    return;
  }
  console.error('Fatal uncaughtException, exiting:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const config = loadConfig();
const provider = createFantasyProvider(config);

// The yahoo-fantasy client runs `JSON.parse` on every response inside an async
// `resp.on('end')` callback. When Yahoo throttles us it replies with a plain-text
// body ("Request denied"), so the parse throws a SyntaxError that escapes as an
// uncaughtException (a try/catch around our await can't reach it) and would kill
// the process. Survive that specific upstream case; let anything else crash so we
// don't mask real bugs. The originating request is left to time out client-side.
function isYahooNonJsonResponse(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    typeof err.stack === 'string' &&
    err.stack.includes('yahoo-fantasy')
  );
}

process.on('uncaughtException', (err) => {
  if (isYahooNonJsonResponse(err)) {
    console.warn(
      `[yahoo] non-JSON upstream response (likely rate-limited); request dropped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return;
  }
  console.error(err);
  process.exit(1);
});

// Outside production, persist the session and tokens to disk so the frequent
// `tsx watch` restarts don't wipe the login and force a re-auth on every edit.
const isProd = process.env.NODE_ENV === 'production';
const tokenStore = isProd ? new InMemoryTokenStore() : new FileTokenStore();
const sessionStore = isProd ? undefined : new FileSessionStore();
const app = createApp(config, { tokenStore, provider, sessionStore });

app.listen(config.port, () => {
  console.warn(
    `API listening on http://localhost:${config.port} (proxied via the Vite HTTPS dev server) ` +
      `[data mode: ${config.dataMode}]`,
  );
});
