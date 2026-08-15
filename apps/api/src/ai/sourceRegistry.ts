import type { CitedSource } from '@fcm/contracts';
import type { WebSearchResult } from '../exaClient.js';

/**
 * Per-chat-turn registry of the web articles the `web_search` tool returned, deduped by URL
 * and assigned a stable 1-based index across the whole turn (so a second search keeps
 * numbering 6, 7, ... rather than restarting). The tool embeds the assigned `index` in the
 * result it hands the model, which cites sources as [[s:N]]; after the reply, the orchestrator
 * attaches the full list as `sourcesCited` so the client can render clickable citation
 * badges. Never trusts the model to invent URLs - the badges are driven purely by tool output.
 */
export class SourceRegistry {
  private readonly byUrl = new Map<string, CitedSource>();
  private readonly order: string[] = [];

  /**
   * Record a search's results and return them paired with their (stable) 1-based index, for
   * the tool to hand back to the model. Only https results with a resolvable domain are kept.
   */
  add(
    results: WebSearchResult[],
  ): { index: number; title: string; url: string; highlights: string[] }[] {
    const indexed: { index: number; title: string; url: string; highlights: string[] }[] = [];
    for (const r of results) {
      if (!r.url.startsWith('https://')) continue;
      const domain = domainOf(r.url);
      if (!domain) continue;
      let entry = this.byUrl.get(r.url);
      if (!entry) {
        entry = {
          index: this.order.length + 1,
          title: r.title,
          url: r.url,
          domain,
          ...(r.publishedDate ? { publishedDate: r.publishedDate } : {}),
        };
        this.byUrl.set(r.url, entry);
        this.order.push(r.url);
      }
      indexed.push({
        index: entry.index,
        title: entry.title,
        url: entry.url,
        highlights: r.highlights,
      });
    }
    return indexed;
  }

  /** Every unique source consulted this turn, in citation-index order. */
  list(): CitedSource[] {
    return this.order.map((url) => this.byUrl.get(url)!);
  }
}

/** Hostname of a URL without a leading `www.`, or undefined if it can't be parsed. */
export function domainOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}
