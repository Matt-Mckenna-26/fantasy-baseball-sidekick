import { Router } from 'express';
import type {
  MlbBoxScoreResponse,
  PlayerAdvancedResponse,
  PlayerNewsItem,
  PlayerNewsResponse,
} from '@fcm/contracts';
import {
  mlbBoxScoreResponseSchema,
  playerAdvancedResponseSchema,
  playerNewsResponseSchema,
} from '@fcm/contracts';
import { asyncHandler, sendError } from '../http.js';
import { getBoxScore, getGamesForDate, getPlayerNews, type MlbTransaction } from '../mlbClient.js';
import { getPlayerAdvancedStats } from '../mlbAdvanced.js';
import { getEspnPlayerNews } from '../espnClient.js';
import { TtlCache } from '../ai/cache.js';

/** Matches a YYYY-MM-DD calendar date. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** How many merged news items to return at most (newest first). */
const MAX_NEWS_ITEMS = 40;
const NEWS_TTL_MS = 15 * 60 * 1000;
const newsCache = new TtlCache();

/** Options accepted by the player-news fetcher. */
export interface PlayerNewsOptions {
  teamAbbr?: string;
  days?: number;
}

/** Map MLB Stats roster transactions to common news items (source 'mlb'). */
function mapMlbTransactions(transactions: MlbTransaction[]): PlayerNewsItem[] {
  return transactions.map((t, i) => ({
    id: `mlb:${t.date ?? 'na'}:${i}`,
    source: 'mlb' as const,
    ...(t.type ? { type: t.type } : {}),
    headline: t.description ?? t.type ?? 'Roster move',
    ...(t.date ? { published: t.date } : {}),
  }));
}

/** Sort newest first; items without a timestamp sink to the bottom. */
function byNewest(a: PlayerNewsItem, b: PlayerNewsItem): number {
  return (b.published ?? '').localeCompare(a.published ?? '');
}

/**
 * Merge ESPN article news + MLB Stats roster transactions for a player into one
 * newest-first list. Both upstreams are public, keyless, and fail soft (an empty list
 * on error), so the modal always renders. The merged result is cached by name+team+days.
 */
export async function fetchPlayerNews(
  name: string,
  opts: PlayerNewsOptions = {},
): Promise<PlayerNewsResponse> {
  const key = `news:${normalizeKey(name)}:${opts.teamAbbr ?? ''}:${opts.days ?? ''}`;
  return newsCache.wrap(key, NEWS_TTL_MS, async () => {
    const [espnItems, mlb] = await Promise.all([
      getEspnPlayerNews(name).catch(() => [] as PlayerNewsItem[]),
      getPlayerNews(name, {
        ...(opts.teamAbbr ? { teamAbbr: opts.teamAbbr } : {}),
        ...(opts.days ? { days: opts.days } : {}),
      }).catch(() => ({ matched: false, player: name, transactions: [] as MlbTransaction[] })),
    ]);
    const items = [...espnItems, ...mapMlbTransactions(mlb.transactions)]
      .sort(byNewest)
      .slice(0, MAX_NEWS_ITEMS);
    return {
      player: mlb.player || name,
      matched: espnItems.length > 0 || mlb.matched,
      items,
    };
  });
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Short TTL for box scores: the Scores page polls live games ~every 30s, so a small
 * cache collapses concurrent viewers of the same game without staling the line for long.
 */
const BOXSCORE_TTL_MS = 15 * 1000;
const boxScoreCache = new TtlCache();

/** Fetch a game's box score, cached briefly by gamePk. */
export async function fetchBoxScore(gamePk: number): Promise<MlbBoxScoreResponse> {
  return boxScoreCache.wrap(`box:${gamePk}`, BOXSCORE_TTL_MS, () => getBoxScore(gamePk));
}

const ADVANCED_TTL_MS = 60 * 60 * 1000;
const advancedCache = new TtlCache();

/**
 * Advanced / expected ("luck") season stats for a player, cached by name+team. Fails soft
 * (matched:false on any upstream error) so the modal's advanced section always renders.
 */
export async function fetchPlayerAdvanced(
  name: string,
  opts: { teamAbbr?: string } = {},
): Promise<PlayerAdvancedResponse> {
  const key = `advanced:${normalizeKey(name)}:${opts.teamAbbr ?? ''}`;
  return advancedCache.wrap(key, ADVANCED_TTL_MS, () =>
    getPlayerAdvancedStats(name, opts).catch(() => ({ query: name, matched: false, metrics: [] })),
  );
}

/**
 * Public MLB endpoints backing the roster "Today" ticker and the player-focus modal's news
 * feed. No Yahoo token or auth is needed - these proxy anonymous, public MLB/ESPN data and
 * send no user data upstream (see security rule). A mock games/news source can be injected
 * for mock mode so the UI renders without hitting the network.
 */
export function createMlbRouter(
  getGames: (date: string) => Promise<unknown> = getGamesForDate,
  getNews: (name: string, opts: PlayerNewsOptions) => Promise<PlayerNewsResponse> = fetchPlayerNews,
  getAdvanced: (
    name: string,
    opts: { teamAbbr?: string },
  ) => Promise<PlayerAdvancedResponse> = fetchPlayerAdvanced,
  getBox: (gamePk: number) => Promise<MlbBoxScoreResponse> = fetchBoxScore,
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

  router.get(
    '/games/:gamePk/boxscore',
    asyncHandler(async (req, res) => {
      const gamePk = Number(req.params.gamePk);
      if (!Number.isInteger(gamePk) || gamePk <= 0) {
        sendError(res, 400, 'bad_request', 'gamePk must be a positive integer.');
        return;
      }
      const box = await getBox(gamePk);
      res.json(mlbBoxScoreResponseSchema.parse(box));
    }),
  );

  router.get(
    '/players/news',
    asyncHandler(async (req, res) => {
      const name = req.query.name;
      if (typeof name !== 'string' || name.trim() === '') {
        sendError(res, 400, 'bad_request', 'name is required.');
        return;
      }
      const teamAbbr = typeof req.query.team === 'string' ? req.query.team : undefined;
      const daysRaw = typeof req.query.days === 'string' ? Number(req.query.days) : undefined;
      const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw!, 1), 120) : undefined;
      const news = await getNews(name.trim(), {
        ...(teamAbbr ? { teamAbbr } : {}),
        ...(days ? { days } : {}),
      });
      res.json(playerNewsResponseSchema.parse(news));
    }),
  );

  router.get(
    '/players/advanced',
    asyncHandler(async (req, res) => {
      const name = req.query.name;
      if (typeof name !== 'string' || name.trim() === '') {
        sendError(res, 400, 'bad_request', 'name is required.');
        return;
      }
      const teamAbbr = typeof req.query.team === 'string' ? req.query.team : undefined;
      const advanced = await getAdvanced(name.trim(), { ...(teamAbbr ? { teamAbbr } : {}) });
      res.json(playerAdvancedResponseSchema.parse(advanced));
    }),
  );

  return router;
}
