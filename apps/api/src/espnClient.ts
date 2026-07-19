import { normalizePlayerName, type PlayerNewsItem } from '@fcm/contracts';
import { TtlCache } from './ai/cache.js';

/**
 * Read-only client for ESPN's unofficial, keyless public JSON endpoints, used solely to
 * source article-style player news for the player-focus modal. Anonymous GETs for public
 * data: no auth, no user data, no tokens are sent upstream (see the security rule).
 *
 * These endpoints are undocumented and can change without notice, so everything here is
 * defensive and FAIL-SOFT: any parse or network error yields an empty news list rather
 * than throwing, so the modal always renders. Responses are cached to cut repeat calls.
 */

/** v3 athlete index (name -> id resolution). */
const ATHLETES_INDEX_URL = 'https://sports.core.api.espn.com/v3/sports/baseball/mlb/athletes';
/** Per-athlete news feed once an ESPN id is resolved. */
const ATHLETE_NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/athletes';
/** League-wide news feed, filtered by name when an id can't be resolved. */
const LEAGUE_NEWS_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news';

const cache = new TtlCache();
const TTL_NEWS = 15 * 60 * 1000;
const TTL_INDEX = 24 * 60 * 60 * 1000;

/* ----------------------------- raw API shapes ----------------------------- */

interface RawArticle {
  id?: number | string;
  headline?: string;
  description?: string;
  published?: string;
  type?: string;
  links?: { web?: { href?: string } };
  images?: { url?: string }[];
}
interface RawNewsFeed {
  articles?: RawArticle[];
}
interface RawAthlete {
  id?: number | string;
  fullName?: string;
  displayName?: string;
}
interface RawAthleteIndex {
  items?: RawAthlete[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN request failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Only keep http(s) links so the response validates (contracts requires a URL). */
function safeUrl(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^https?:\/\//i.test(value) ? value : undefined;
}

/**
 * Map an ESPN news feed to our common news items, dropping entries without a headline.
 * Pure and exported for unit testing against captured payloads.
 */
export function mapEspnArticles(raw: RawNewsFeed | undefined): PlayerNewsItem[] {
  const articles = raw?.articles ?? [];
  const items: PlayerNewsItem[] = [];
  for (const a of articles) {
    const headline = typeof a.headline === 'string' ? a.headline.trim() : '';
    if (!headline) continue;
    const id = a.id != null ? `espn:${a.id}` : `espn:${normalizePlayerName(headline).slice(0, 48)}`;
    const url = safeUrl(a.links?.web?.href);
    const imageUrl = safeUrl(a.images?.find((i) => typeof i.url === 'string')?.url);
    items.push({
      id,
      source: 'espn',
      ...(a.type ? { type: a.type } : {}),
      headline,
      ...(a.description ? { description: a.description } : {}),
      ...(a.published ? { published: a.published } : {}),
      ...(url ? { url } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    });
  }
  return items;
}

/** Build a normalized-name -> ESPN athlete id index. First match wins on name collision. */
async function buildAthleteIndex(): Promise<Map<string, string>> {
  const raw = await fetchJson<RawAthleteIndex>(`${ATHLETES_INDEX_URL}?limit=18000&active=true`);
  const index = new Map<string, string>();
  for (const a of raw.items ?? []) {
    const name = a.fullName ?? a.displayName;
    if (typeof name !== 'string' || a.id == null) continue;
    const key = normalizePlayerName(name);
    if (!index.has(key)) index.set(key, String(a.id));
  }
  return index;
}

/** Resolve a player name to an ESPN athlete id via the cached index; undefined on any miss. */
async function resolveEspnId(name: string): Promise<string | undefined> {
  try {
    const index = await cache.wrap('espn:athlete-index', TTL_INDEX, buildAthleteIndex);
    return index.get(normalizePlayerName(name));
  } catch {
    return undefined;
  }
}

/**
 * ESPN article-style news for a player. Resolves the player's ESPN id first and pulls their
 * per-athlete feed; if that can't be resolved (or is empty), falls back to the league feed
 * filtered by name. Always fail-soft - returns [] on any error so the modal still renders.
 */
export async function getEspnPlayerNews(
  name: string,
  opts: { limit?: number } = {},
): Promise<PlayerNewsItem[]> {
  const limit = opts.limit ?? 20;
  try {
    const espnId = await resolveEspnId(name);
    if (espnId) {
      const raw = await cache.wrap(`espn:news:${espnId}`, TTL_NEWS, () =>
        fetchJson<RawNewsFeed>(`${ATHLETE_NEWS_URL}/${espnId}/news`),
      );
      const items = mapEspnArticles(raw);
      if (items.length > 0) return items.slice(0, limit);
    }
    const raw = await cache.wrap('espn:news:league', TTL_NEWS, () =>
      fetchJson<RawNewsFeed>(`${LEAGUE_NEWS_URL}?limit=50`),
    );
    const wantName = normalizePlayerName(name);
    return mapEspnArticles(raw)
      .filter((it) =>
        normalizePlayerName(`${it.headline} ${it.description ?? ''}`).includes(wantName),
      )
      .slice(0, limit);
  } catch {
    return [];
  }
}
