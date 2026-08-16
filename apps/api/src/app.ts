import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import type { AppConfig } from './config.js';
import { API_DIR } from './config.js';
import type { TokenStore } from './tokenStore.js';
import type { FantasyProvider } from './fantasyProvider.js';
import { createAuthRouter } from './routes/auth.js';
import { createMeRouter } from './routes/me.js';
import { createMlbRouter } from './routes/mlb.js';
import { createChatRouter } from './routes/chat.js';
import { getMockBoxScore, getMockMlbGames, getMockPlayerGameLog, getMockPlayerNews } from './fantasyProvider.mock.js';
import { sendError } from './http.js';
import { YahooUpstreamError } from './yahooClient.js';

/** Serialize a non-Error rejection (e.g. Yahoo's error payload) for safe logging. */
function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface AppDeps {
  tokenStore: TokenStore;
  provider: FantasyProvider;
  /** Optional server-side session store. Omit to use the default in-memory store. */
  sessionStore?: session.Store;
}

/**
 * Build the Express app. Dependencies are injected so tests can supply fakes.
 * The web app runs over HTTPS (Vite) and proxies here, so requests are first-party;
 * the session cookie is httpOnly + sameSite lax.
 */
export function createApp(config: AppConfig, deps: AppDeps): Express {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';

  // In production the app sits behind Azure Container Apps' TLS-terminating ingress,
  // which forwards plain HTTP to the container. Trust the proxy so express-session
  // recognizes the request as secure and will actually set the `secure` cookie.
  if (isProd) {
    app.set('trust proxy', 1);
  }

  app.use(express.json());

  app.use(
    session({
      name: 'fcm.sid',
      secret: config.sessionSecret,
      store: deps.sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // Dev runs behind the Vite HTTPS proxy over plain HTTP; in prod the cookie must
        // be Secure because ingress serves the origin over HTTPS (same origin as the SPA).
        secure: isProd,
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', createAuthRouter(config, deps.tokenStore));
  app.use('/api/me', createMeRouter(config, deps.tokenStore, deps.provider));
  app.use('/api/chat', createChatRouter(config, deps.tokenStore, deps.provider));
  // Public MLB live-game state for the roster ticker. In mock mode, serve the seeded
  // games so the ticker works offline; in live mode, hit the public MLB Stats API.
  app.use(
    '/api/mlb',
    createMlbRouter(
      config.dataMode === 'mock' ? getMockMlbGames : undefined,
      config.dataMode === 'mock' ? getMockPlayerNews : undefined,
      undefined,
      config.dataMode === 'mock' ? getMockBoxScore : undefined,
      config.dataMode === 'mock' ? getMockPlayerGameLog : undefined,
    ),
  );

  // Serve the built React SPA from the same origin as the API so the existing
  // relative-URL + session-cookie flow works unmodified in production. The web bundle
  // is copied into the image (see apps/api/Dockerfile). Gated on production so dev and
  // tests (which never build the bundle here) keep the JSON 404 behavior below.
  const webDistDir = process.env.WEB_DIST_DIR ?? resolve(API_DIR, '..', 'web', 'dist');
  if (isProd && existsSync(webDistDir)) {
    app.use(express.static(webDistDir));
    // SPA history fallback: serve index.html for non-API GETs so client-side routes
    // (e.g. /stats) survive a refresh. API/auth paths fall through to the JSON 404.
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
        next();
        return;
      }
      res.sendFile(resolve(webDistDir, 'index.html'));
    });
  }

  app.use((_req, res) => {
    sendError(res, 404, 'not_found', 'Resource not found.');
  });

  // Centralized error handler - never leak internals or tokens to the client.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof YahooUpstreamError) {
      const cause =
        err.cause instanceof Error ? (err.cause.stack ?? err.cause.message) : safeSerialize(err.cause);
      console.error('Yahoo upstream error:', err.message, `\ncause: ${cause}`);
      if (res.headersSent) {
        return;
      }
      if (err.authFailure) {
        void deps.tokenStore.clear(req.sessionID);
        sendError(res, 401, 'unauthorized', 'Your Yahoo session expired. Sign in again.');
        return;
      }
      sendError(res, 502, 'upstream_unavailable', 'Yahoo Fantasy is temporarily unavailable. Please try again.');
      return;
    }
    const detail = err instanceof Error ? (err.stack ?? err.message) : safeSerialize(err);
    console.error('Unhandled API error:', detail);
    if (res.headersSent) {
      return;
    }
    sendError(res, 500, 'internal_error', 'Something went wrong.');
  });

  return app;
}
