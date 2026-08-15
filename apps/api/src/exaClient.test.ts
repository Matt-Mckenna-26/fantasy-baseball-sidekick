import { describe, it, expect, vi, afterEach } from 'vitest';
import { createExaSearch } from './exaClient.js';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Stub global fetch with a captured request + canned JSON response. */
function stubFetch(response: unknown, ok = true, status = 200): { calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok, status, json: async () => response };
    }),
  );
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createExaSearch', () => {
  it('sends the query with the fast/highlights defaults and a bearer key (never in results)', async () => {
    const { calls } = stubFetch({
      results: [
        {
          title: 'Alonso traded',
          url: 'https://mlb.com/alonso',
          publishedDate: '2026-08-01',
          highlights: ['now on the Orioles'],
        },
      ],
    });
    const search = createExaSearch('secret-key');

    const snap = await search('what team does Pete Alonso play for 2026');

    expect(calls).toHaveLength(1);
    const req = calls[0]!;
    expect(req.url).toBe('https://api.exa.ai/search');
    expect(req.headers.authorization).toBe('Bearer secret-key');
    expect(req.body).toMatchObject({ type: 'fast', numResults: 5, contents: { highlights: true } });
    expect(typeof req.body.startPublishedDate).toBe('string');
    // The key must never appear in what we hand back to the model.
    expect(JSON.stringify(snap)).not.toContain('secret-key');
    expect(snap.results[0]).toMatchObject({
      title: 'Alonso traded',
      url: 'https://mlb.com/alonso',
      publishedDate: '2026-08-01',
      highlights: ['now on the Orioles'],
    });
  });

  it('drops non-https results so a citation badge can never link to an insecure page', async () => {
    stubFetch({
      results: [
        { title: 'Secure', url: 'https://a.com/x', highlights: [] },
        { title: 'Insecure', url: 'http://b.com/y', highlights: [] },
        { title: 'Junk', url: 'ftp://c.com/z', highlights: [] },
      ],
    });
    const snap = await createExaSearch('k')('q');
    expect(snap.results.map((r) => r.url)).toEqual(['https://a.com/x']);
  });

  it('caps the query length and passes a recency window when asked', async () => {
    const { calls } = stubFetch({ results: [] });
    const longQuery = 'a'.repeat(500);

    await createExaSearch('k')(longQuery, { recencyDays: 14 });

    const sent = calls[0]!.body.query as string;
    expect(sent.length).toBe(300);
    // recencyDays=14 -> startPublishedDate roughly two weeks ago (much later than the default).
    const start = new Date(calls[0]!.body.startPublishedDate as string).getTime();
    const twentyDaysAgo = Date.now() - 20 * 24 * 60 * 60 * 1000;
    expect(start).toBeGreaterThan(twentyDaysAgo);
  });

  it('returns an empty snapshot for a blank query without calling the API', async () => {
    const { calls } = stubFetch({ results: [] });
    const snap = await createExaSearch('k')('   ');
    expect(calls).toHaveLength(0);
    expect(snap.results).toEqual([]);
  });

  it('throws on a non-ok response without leaking the body', async () => {
    stubFetch({ error: 'nope' }, false, 429);
    await expect(createExaSearch('k')('q')).rejects.toThrow(/429/);
  });
});
