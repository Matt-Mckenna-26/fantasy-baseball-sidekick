import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import type { AppConfig } from './config.js';
import type { TokenStore } from './tokenStore.js';
import type { FantasyProvider } from './fantasyProvider.js';
import { createAuthRouter } from './routes/auth.js';
import { createMeRouter } from './routes/me.js';
import { sendError } from './http.js';

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
}

/**
 * Build the Express app. Dependencies are injected so tests can supply fakes.
 * The web app runs over HTTPS (Vite) and proxies here, so requests are first-party;
 * the session cookie is httpOnly + sameSite lax.
 */
export function createApp(config: AppConfig, deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.use(
    session({
      name: 'fcm.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // Dev runs behind the Vite HTTPS proxy over plain HTTP; set true when the API serves HTTPS directly.
        secure: false,
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', createAuthRouter(config, deps.tokenStore));
  app.use('/api/me', createMeRouter(deps.tokenStore, deps.provider));

  app.use((_req, res) => {
    sendError(res, 404, 'not_found', 'Resource not found.');
  });

  // Centralized error handler - never leak internals or tokens to the client.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : safeSerialize(err);
    console.error('Unhandled API error:', detail);
    if (res.headersSent) {
      return;
    }
    sendError(res, 500, 'internal_error', 'Something went wrong.');
  });

  return app;
}
