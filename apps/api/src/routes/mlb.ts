import { Router } from 'express';
import { asyncHandler, sendError } from '../http.js';
import { getGamesForDate } from '../mlbClient.js';

/** Matches a YYYY-MM-DD calendar date. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Public MLB live-game state for a date, used by the roster "Today" ticker. No Yahoo
 * token or auth is needed - this proxies anonymous, public MLB Stats API data and
 * sends no user data upstream (see security rule). A mock games source can be injected
 * for mock mode so the ticker renders without hitting the network.
 */
export function createMlbRouter(
  getGames: (date: string) => Promise<unknown> = getGamesForDate,
): Router {
  const router = Router();

  router.get(
    '/games',
    asyncHandler(async (req, res) => {
      const date = req.query.date;
      if (typeof date !== 'string' || !DATE_RE.test(date)) {
        sendError(res, 400, 'bad_request', 'date is required as YYYY-MM-DD.');
        return;
      }
      const games = await getGames(date);
      res.json(games);
    }),
  );

  return router;
}
