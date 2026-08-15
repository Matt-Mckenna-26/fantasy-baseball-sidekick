/**
 * Read-only client for the Exa web search API (https://api.exa.ai/search). This is the app's
 * safety net against the LLM's stale training data: it grounds "current" facts (a player's
 * present MLB team, this week's sleepers, breaking injury news) in live web results rather
 * than a year-old memory. Anonymous to the user - only the query text and an Exa API key are
 * sent; never Yahoo tokens, league ids, or any user data (see the security rule). The key is
 * a secret and is never logged.
 */

const EXA_SEARCH_URL = 'https://api.exa.ai/search';

/** Keep queries bounded so a runaway prompt can't send a huge body to Exa. */
const MAX_QUERY_CHARS = 300;
/** Chat-friendly defaults: a handful of results with token-cheap highlight excerpts. */
const NUM_RESULTS = 5;
/** How far back results may be published by default, so offseason moves still surface while
 *  last-season recaps drop out (~9 months). The model can tighten this via `recencyDays`. */
const DEFAULT_LOOKBACK_DAYS = 270;

/** One web result, trimmed to what the co-manager (and the citation UI) actually need. */
export interface WebSearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  highlights: string[];
}

/** Compact snapshot returned to the model (and cached per query). */
export interface WebSearchSnapshot {
  query: string;
  results: WebSearchResult[];
}

/** The injectable search function the `web_search` tool depends on. */
export type WebSearch = (
  query: string,
  opts?: { recencyDays?: number },
) => Promise<WebSearchSnapshot>;

/** Raw subset of the Exa response we consume. */
interface RawExaResult {
  title?: string | null;
  url?: string | null;
  publishedDate?: string | null;
  highlights?: string[] | null;
}
interface RawExaResponse {
  results?: RawExaResult[] | null;
}

/** ISO date `daysAgo` days before now, for Exa's `startPublishedDate` freshness filter. */
function isoDaysAgo(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Keep only https results and coerce the raw payload into the compact snapshot shape. */
function toSnapshot(query: string, raw: RawExaResponse): WebSearchSnapshot {
  const results: WebSearchResult[] = [];
  for (const r of raw.results ?? []) {
    const url = typeof r.url === 'string' ? r.url.trim() : '';
    // HTTPS-only: never surface an insecure link in a clickable citation badge.
    if (!url.startsWith('https://')) continue;
    const title = typeof r.title === 'string' && r.title.trim() !== '' ? r.title.trim() : url;
    const highlights = Array.isArray(r.highlights)
      ? r.highlights.filter((h): h is string => typeof h === 'string' && h.trim() !== '')
      : [];
    results.push({
      title,
      url,
      ...(typeof r.publishedDate === 'string' && r.publishedDate.trim() !== ''
        ? { publishedDate: r.publishedDate }
        : {}),
      highlights,
    });
  }
  return { query, results };
}

/**
 * Build a `WebSearch` bound to an Exa API key. Returns undefined-safe results (an empty list
 * on no hits) and throws on transport/API errors so the tool layer can surface a clean
 * failure to the model without leaking the key.
 */
export function createExaSearch(apiKey: string): WebSearch {
  return async (query, opts) => {
    const trimmed = query.trim().slice(0, MAX_QUERY_CHARS);
    if (trimmed === '') return { query, results: [] };
    const lookback =
      typeof opts?.recencyDays === 'number' && opts.recencyDays > 0
        ? Math.trunc(opts.recencyDays)
        : DEFAULT_LOOKBACK_DAYS;

    const res = await fetch(EXA_SEARCH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: trimmed,
        type: 'fast',
        numResults: NUM_RESULTS,
        startPublishedDate: isoDaysAgo(lookback),
        contents: { highlights: true },
      }),
    });
    if (!res.ok) {
      // Never include the response body or key in the error - just the status.
      throw new Error(`Exa search request failed: ${res.status}`);
    }
    const raw = (await res.json()) as RawExaResponse;
    return toSnapshot(trimmed, raw);
  };
}
