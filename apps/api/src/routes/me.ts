import { Router } from 'express';
import type { FantasyProvider } from '../fantasyProvider.js';
import type { TokenStore } from '../tokenStore.js';
import { asyncHandler, sendError } from '../http.js';

/** Authenticated, read-only endpoints scoped to the signed-in Yahoo user. */
export function createMeRouter(tokenStore: TokenStore, provider: FantasyProvider): Router {
  const router = Router();

  // The e2e proof: an authenticated Yahoo Fantasy call returning the user's MLB leagues.
  router.get(
    '/leagues',
    asyncHandler(async (req, res) => {
      const tokens = await tokenStore.get(req.sessionID);
      if (!tokens) {
        sendError(res, 401, 'unauthorized', 'Connect your Yahoo account first.');
        return;
      }

      const leagues = await provider.getMyLeagues(tokens, (refreshed) =>
        tokenStore.save(req.sessionID, refreshed),
      );
      res.json(leagues);
    }),
  );

  return router;
}
