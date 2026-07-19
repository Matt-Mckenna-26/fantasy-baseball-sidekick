import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import type { AuthStatus } from '@fcm/contracts';
import type { AppConfig } from '../config.js';
import type { TokenStore, YahooTokens } from '../tokenStore.js';
import { createYahooClient } from '../yahooClient.js';
import { refreshYahooTokens } from '../tokenRefresh.js';
import { asyncHandler, sendError } from '../http.js';

/** Complete the OAuth code exchange, resolving the issued Yahoo tokens. */
function exchangeCode(config: AppConfig, req: Request): Promise<YahooTokens> {
  const yf = createYahooClient(config);
  return new Promise((resolve, reject) => {
    yf.authCallback(req, (err, data) => {
      if (err || !data) {
        reject(err ?? new Error('Yahoo did not return tokens'));
        return;
      }
      resolve({ accessToken: data.access_token, refreshToken: data.refresh_token });
    });
  });
}

/** Routes that own the Yahoo OAuth (fspt-r) flow and session connection state. */
export function createAuthRouter(config: AppConfig, tokenStore: TokenStore): Router {
  const router = Router();

  // Kick off Yahoo login. A CSRF state value is stored on the session and verified
  // on the callback.
  router.get('/yahoo', (req, res) => {
    const state = randomUUID();
    req.session.oauthState = state;
    // Safe to log: the redirect_uri must EXACTLY match the Yahoo app registration.
    console.warn(`[auth] starting Yahoo OAuth with redirect_uri=${config.yahooRedirectUri}`);
    // Build the authorize URL directly (rather than yahoo-fantasy's auth()) so we can
    // force `prompt=consent`. Without it, Yahoo may silently reuse a prior/partial
    // grant that lacks the Fantasy Sports (fspt-r) scope, yielding
    // oauth_problem="additional_authorization_required" on fantasy calls.
    const params = new URLSearchParams({
      client_id: config.yahooClientId,
      redirect_uri: config.yahooRedirectUri,
      response_type: 'code',
      state,
      prompt: 'consent',
    });
    res.redirect(`https://api.login.yahoo.com/oauth2/request_auth?${params.toString()}`);
  });

  // OAuth redirect target. Verifies state, exchanges the code, persists tokens for
  // the session, then returns the user to the web app.
  router.get(
    '/yahoo/callback',
    asyncHandler(async (req, res) => {
      // Surface any error Yahoo appends to the callback (safe to log - no secrets).
      if (typeof req.query.error === 'string') {
        const description =
          typeof req.query.error_description === 'string' ? req.query.error_description : '';
        console.warn(`[auth] Yahoo callback error: ${req.query.error} ${description}`);
        await tokenStore.clear(req.sessionID);
        res.redirect(`${config.webAppUrl}/?connected=0&reason=denied`);
        return;
      }

      const returnedState = typeof req.query.state === 'string' ? req.query.state : undefined;
      const expectedState = req.session.oauthState;
      req.session.oauthState = undefined;

      if (!expectedState || returnedState !== expectedState) {
        res.redirect(`${config.webAppUrl}/?connected=0&reason=state`);
        return;
      }

      if (typeof req.query.code !== 'string') {
        // User denied consent or Yahoo returned an error - retain nothing.
        await tokenStore.clear(req.sessionID);
        res.redirect(`${config.webAppUrl}/?connected=0&reason=denied`);
        return;
      }

      const tokens = await exchangeCode(config, req);
      // Immediately refresh: the code-grant access token is often rejected by the
      // Fantasy API (oauth_problem="token_rejected"/"additional_authorization_required"),
      // so we persist the refreshed (working) token instead. The shared helper also
      // records the token's expiry for the proactive refresh path.
      const workingTokens = await refreshYahooTokens(config, tokens.refreshToken);
      await tokenStore.save(req.sessionID, workingTokens);
      req.session.yahooConnected = true;
      res.redirect(`${config.webAppUrl}/?connected=1`);
    }),
  );

  // Whether the current session has a connected Yahoo account.
  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      const tokens = await tokenStore.get(req.sessionID);
      const body: AuthStatus = { authenticated: Boolean(tokens) };
      res.json(body);
    }),
  );

  // Disconnect: drop tokens and destroy the session.
  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      await tokenStore.clear(req.sessionID);
      req.session.destroy((err) => {
        if (err) {
          sendError(res, 500, 'logout_failed', 'Could not end the session.');
          return;
        }
        res.status(204).end();
      });
    }),
  );

  return router;
}
