import {
  normalizeTeamAbbr,
  type AdvancedStatLuck,
  type AdvancedStatMetric,
  type PlayerAdvancedResponse,
  type StatColumn,
  type StatValue,
} from '@fcm/contracts';
import { pickBestPersonMatch } from './mlbClient.js';
import { loadIdentityMap, resolvePersonId, type StatGroup } from './mlbStats.js';

/**
 * Derives advanced / expected ("luck") stats for one player from the public MLB Stats
 * API (anonymous GETs for public data - no auth, no user data, no tokens; see the
 * security rule). Pairs each surface result with its Statcast-expected counterpart
 * (AVG vs xBA, SLG vs xSLG) so the co-manager and the UI can flag over/underperformers
 * and buy-low candidates. Season-level only: the API exposes expected/advanced splits
 * for the season, not per game, which is the right sample for a luck read anyway.
 */

const PEOPLE_SEARCH_URL = 'https://statsapi.mlb.com/api/v1/people/search';
const PEOPLE_URL = 'https://statsapi.mlb.com/api/v1/people';

/** Actual beats/trails expected by at least this (BA/SLG points) before we call it luck. */
const HITTER_LUCK_THRESHOLD = 0.02;
const PITCHER_LUCK_THRESHOLD = 0.015;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`MLB request failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Parse an MLB rate value (".314", "1.145", "11.10") to a number, or undefined. */
function parseRate(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return undefined;
  const n = Number(trimmed);
  return Number.isNaN(n) ? undefined : n;
}

/** Batting-average-style display: 3 decimals, leading zero stripped (".314"). */
function fmt3(value: number): string {
  const s = value.toFixed(3);
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? `-${s.slice(2)}` : s;
}

/** ERA/rate-per-9 display: 2 decimals, leading digit kept ("9.50"). */
function fmt2(value: number): string {
  return value.toFixed(2);
}

/** Percentage display from a ratio (0.236 -> "23.6"), so it sorts as a number. */
function fmtPct(value: number): string {
  return (value * 100).toFixed(1);
}

interface RawStatSplit {
  stat?: Record<string, unknown>;
}
interface RawStatGroup {
  group?: { displayName?: string };
  type?: { displayName?: string };
  splits?: RawStatSplit[];
}
interface RawPersonSearch {
  id?: number;
  fullName?: string;
  currentTeam?: { abbreviation?: string };
  primaryPosition?: { abbreviation?: string };
}
interface RawPerson {
  id?: number;
  fullName?: string;
  currentTeam?: { abbreviation?: string };
  primaryPosition?: { abbreviation?: string };
  stats?: RawStatGroup[];
}

/** Pull the stat object for a given group + type from a hydrated person, if present. */
function statOf(
  groups: RawStatGroup[],
  group: string,
  type: string,
): Record<string, unknown> | undefined {
  return groups.find((g) => g.group?.displayName === group && g.type?.displayName === type)
    ?.splits?.[0]?.stat;
}

/** A metric row, dropped entirely when neither an actual nor an expected value exists. */
function metric(
  key: string,
  label: string,
  actual: number | undefined,
  expected: number | undefined,
  format: AdvancedStatMetric['format'],
  higherIsBetter: boolean,
): AdvancedStatMetric | undefined {
  if (actual === undefined && expected === undefined) return undefined;
  return {
    key,
    label,
    format,
    higherIsBetter,
    ...(actual !== undefined ? { actual } : {}),
    ...(expected !== undefined ? { expected } : {}),
  };
}

/**
 * Average the actual-minus-expected gaps across the AVG and SLG pairs. Positive means
 * results are outrunning the expected numbers. Returns undefined when no pair exists.
 */
function resultGap(pairs: { actual?: number; expected?: number }[]): number | undefined {
  const gaps = pairs
    .filter((p) => p.actual !== undefined && p.expected !== undefined)
    .map((p) => p.actual! - p.expected!);
  if (gaps.length === 0) return undefined;
  return gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
}

/** Buy-low / sell-high read for a hitter from the AVG/SLG actual-vs-expected gaps. */
function hitterLuck(
  avg?: number,
  xba?: number,
  slg?: number,
  xslg?: number,
): AdvancedStatLuck | undefined {
  const gap = resultGap([
    { actual: avg, expected: xba },
    { actual: slg, expected: xslg },
  ]);
  if (gap === undefined) return undefined;
  const detail =
    avg !== undefined && xba !== undefined ? ` (${fmt3(avg)} AVG vs ${fmt3(xba)} xBA)` : '';
  if (gap >= HITTER_LUCK_THRESHOLD) {
    return {
      lean: 'sell',
      summary: `Outproducing the expected numbers${detail} - regression/sell-high risk.`,
    };
  }
  if (gap <= -HITTER_LUCK_THRESHOLD) {
    return { lean: 'buy', summary: `Hitting into bad luck${detail} - the contact says buy-low.` };
  }
  return { lean: 'neutral', summary: `Results roughly match the expected numbers${detail}.` };
}

/** Buy-low / sell-high read for a pitcher (lower actual than expected = lucky). */
function pitcherLuck(
  baa?: number,
  xba?: number,
  slg?: number,
  xslg?: number,
): AdvancedStatLuck | undefined {
  // For pitchers, allowing LESS than expected is favorable, so flip the gap sign.
  const gap = resultGap([
    { actual: xba, expected: baa },
    { actual: xslg, expected: slg },
  ]);
  if (gap === undefined) return undefined;
  const detail =
    baa !== undefined && xba !== undefined ? ` (${fmt3(baa)} BAA vs ${fmt3(xba)} xBA)` : '';
  if (gap >= PITCHER_LUCK_THRESHOLD) {
    return {
      lean: 'sell',
      summary: `Allowing softer results than the contact warrants${detail} - some positive luck; sell-high risk.`,
    };
  }
  if (gap <= -PITCHER_LUCK_THRESHOLD) {
    return {
      lean: 'buy',
      summary: `Allowing harder contact than the ERA shows${detail} - bad luck; results should improve (buy-low).`,
    };
  }
  return { lean: 'neutral', summary: `Results roughly match the underlying contact${detail}.` };
}

function hittingMetrics(groups: RawStatGroup[]): {
  metrics: AdvancedStatMetric[];
  luck?: AdvancedStatLuck;
} {
  const season = statOf(groups, 'hitting', 'season') ?? {};
  const exp = statOf(groups, 'hitting', 'expectedStatistics') ?? {};
  const adv = statOf(groups, 'hitting', 'seasonAdvanced') ?? {};
  const avg = parseRate(season.avg);
  const xba = parseRate(exp.avg);
  const slg = parseRate(season.slg);
  const xslg = parseRate(exp.slg);
  const metrics = [
    metric('avg', 'AVG', avg, xba, 'rate3', true),
    metric('slg', 'SLG', slg, xslg, 'rate3', true),
    metric('woba', 'xwOBA', undefined, parseRate(exp.woba), 'rate3', true),
    metric('babip', 'BABIP', parseRate(season.babip ?? adv.babip), undefined, 'rate3', true),
    metric('iso', 'ISO', parseRate(adv.iso), undefined, 'rate3', true),
    metric('k', 'K%', parseRate(adv.strikeoutsPerPlateAppearance), undefined, 'pct', false),
    metric('bb', 'BB%', parseRate(adv.walksPerPlateAppearance), undefined, 'pct', true),
  ].filter((m): m is AdvancedStatMetric => m !== undefined);
  const luck = hitterLuck(avg, xba, slg, xslg);
  return { metrics, ...(luck ? { luck } : {}) };
}

function pitchingMetrics(groups: RawStatGroup[]): {
  metrics: AdvancedStatMetric[];
  luck?: AdvancedStatLuck;
} {
  const season = statOf(groups, 'pitching', 'season') ?? {};
  const exp = statOf(groups, 'pitching', 'expectedStatistics') ?? {};
  const adv = statOf(groups, 'pitching', 'seasonAdvanced') ?? {};
  const baa = parseRate(season.avg);
  const xba = parseRate(exp.avg);
  const slg = parseRate(season.slg);
  const xslg = parseRate(exp.slg);
  const metrics = [
    metric('baa', 'BAA', baa, xba, 'rate3', false),
    metric('slg', 'SLG', slg, xslg, 'rate3', false),
    metric('woba', 'xwOBA', undefined, parseRate(exp.woba), 'rate3', false),
    metric('babip', 'BABIP', parseRate(season.babip ?? adv.babip), undefined, 'rate3', false),
    metric(
      'k9',
      'K/9',
      parseRate(season.strikeoutsPer9Inn ?? adv.strikeoutsPer9),
      undefined,
      'rate2',
      true,
    ),
    metric(
      'bb9',
      'BB/9',
      parseRate(season.walksPer9Inn ?? adv.baseOnBallsPer9),
      undefined,
      'rate2',
      false,
    ),
    metric(
      'hr9',
      'HR/9',
      parseRate(season.homeRunsPer9 ?? adv.homeRunsPer9),
      undefined,
      'rate2',
      false,
    ),
  ].filter((m): m is AdvancedStatMetric => m !== undefined);
  const luck = pitcherLuck(baa, xba, slg, xslg);
  return { metrics, ...(luck ? { luck } : {}) };
}

/**
 * Map a hydrated `/people/{id}` person (season + expectedStatistics + seasonAdvanced)
 * into the advanced-stat response. Pure and exported for unit testing against captured
 * payloads. Chooses the hitting or pitching view from the player's primary position.
 */
export function mapPersonToAdvanced(
  person: RawPerson | undefined,
  query: string,
): PlayerAdvancedResponse {
  if (!person || typeof person.id !== 'number') return { query, matched: false, metrics: [] };
  const groups = Array.isArray(person.stats) ? person.stats : [];
  const isPitcher = person.primaryPosition?.abbreviation === 'P';
  const group = isPitcher ? 'pitching' : 'hitting';
  const { metrics, luck } = isPitcher ? pitchingMetrics(groups) : hittingMetrics(groups);
  return {
    query,
    matched: true,
    group,
    metrics,
    ...(person.fullName ? { player: person.fullName } : {}),
    ...(person.currentTeam?.abbreviation
      ? { team: normalizeTeamAbbr(person.currentTeam.abbreviation) }
      : {}),
    ...(person.primaryPosition?.abbreviation
      ? { position: person.primaryPosition.abbreviation }
      : {}),
    ...(luck ? { luck } : {}),
  };
}

/**
 * Fetch a player's advanced / expected season stats, reconciled by normalized name (and an
 * optional team hint). Returns `{ matched: false, metrics: [] }` rather than guessing when
 * no confident match is found, so nothing is fabricated.
 */
export async function getPlayerAdvancedStats(
  name: string,
  opts: { teamAbbr?: string; season?: number } = {},
): Promise<PlayerAdvancedResponse> {
  const season = opts.season ?? new Date().getUTCFullYear();
  const search = await fetchJson<{ people?: RawPersonSearch[] }>(
    `${PEOPLE_SEARCH_URL}?names=${encodeURIComponent(name)}&sportId=1&active=true`,
  );
  const match = pickBestPersonMatch(search.people ?? [], name, opts.teamAbbr);
  if (!match || typeof match.id !== 'number') return { query: name, matched: false, metrics: [] };
  const hydrate = `stats(group=[hitting,pitching],type=[season,expectedStatistics,seasonAdvanced],season=${season}),currentTeam`;
  const detail = await fetchJson<{ people?: RawPerson[] }>(
    `${PEOPLE_URL}/${match.id}?hydrate=${encodeURIComponent(hydrate)}`,
  );
  return mapPersonToAdvanced(detail.people?.[0], name);
}

/* -------------------------------------------------------------------------- */
/* League-wide advanced table (percentile-colored grid + player-card tiles)   */
/* -------------------------------------------------------------------------- */

/** How many personIds to request per /people call (keeps each URL + response bounded). */
const PEOPLE_CHUNK = 25;
type RateFormat = 'rate3' | 'rate2' | 'pct' | 'ip';

/**
 * One advanced column: its stable key/label, color direction, and how to pull + format its
 * value from a hydrated person's season/expected/advanced stat objects. Values are stored as
 * display strings that still parse to a sortable number (".314", "9.50", "23.6", "145.1"), so
 * the grid and compare tiles can both color by percentile and show a clean figure.
 */
interface AdvColumnDef {
  key: string;
  label: string;
  description: string;
  higherIsBetter: boolean;
  format: RateFormat;
  pick: (
    season: Record<string, unknown>,
    exp: Record<string, unknown>,
    adv: Record<string, unknown>,
  ) => unknown;
}

const HITTING_ADV_DEFS: AdvColumnDef[] = [
  {
    key: 'AVG',
    label: 'AVG',
    description: 'Batting average',
    higherIsBetter: true,
    format: 'rate3',
    pick: (s) => s.avg,
  },
  {
    key: 'xBA',
    label: 'xBA',
    description: 'Expected batting average (Statcast)',
    higherIsBetter: true,
    format: 'rate3',
    pick: (_s, e) => e.avg,
  },
  {
    key: 'SLG',
    label: 'SLG',
    description: 'Slugging percentage',
    higherIsBetter: true,
    format: 'rate3',
    pick: (s) => s.slg,
  },
  {
    key: 'xSLG',
    label: 'xSLG',
    description: 'Expected slugging (Statcast)',
    higherIsBetter: true,
    format: 'rate3',
    pick: (_s, e) => e.slg,
  },
  {
    key: 'xwOBA',
    label: 'xwOBA',
    description: 'Expected weighted on-base average',
    higherIsBetter: true,
    format: 'rate3',
    pick: (_s, e) => e.woba,
  },
  {
    key: 'BABIP',
    label: 'BABIP',
    description: 'Batting average on balls in play',
    higherIsBetter: true,
    format: 'rate3',
    pick: (s, _e, a) => s.babip ?? a.babip,
  },
  {
    key: 'ISO',
    label: 'ISO',
    description: 'Isolated power (SLG - AVG)',
    higherIsBetter: true,
    format: 'rate3',
    pick: (_s, _e, a) => a.iso,
  },
  {
    key: 'K%',
    label: 'K%',
    description: 'Strikeout rate (per plate appearance)',
    higherIsBetter: false,
    format: 'pct',
    pick: (_s, _e, a) => a.strikeoutsPerPlateAppearance,
  },
  {
    key: 'BB%',
    label: 'BB%',
    description: 'Walk rate (per plate appearance)',
    higherIsBetter: true,
    format: 'pct',
    pick: (_s, _e, a) => a.walksPerPlateAppearance,
  },
];

const PITCHING_ADV_DEFS: AdvColumnDef[] = [
  {
    key: 'IP',
    label: 'IP',
    description: 'Innings pitched (season) - always shown so volume filters work in Advanced',
    higherIsBetter: true,
    format: 'ip',
    pick: (s) => s.inningsPitched,
  },
  {
    key: 'BAA',
    label: 'BAA',
    description: 'Batting average against',
    higherIsBetter: false,
    format: 'rate3',
    pick: (s) => s.avg,
  },
  {
    key: 'xBA',
    label: 'xBA',
    description: 'Expected batting average against (Statcast)',
    higherIsBetter: false,
    format: 'rate3',
    pick: (_s, e) => e.avg,
  },
  {
    key: 'SLG',
    label: 'SLG',
    description: 'Slugging against',
    higherIsBetter: false,
    format: 'rate3',
    pick: (s) => s.slg,
  },
  {
    key: 'xSLG',
    label: 'xSLG',
    description: 'Expected slugging against (Statcast)',
    higherIsBetter: false,
    format: 'rate3',
    pick: (_s, e) => e.slg,
  },
  {
    key: 'xwOBA',
    label: 'xwOBA',
    description: 'Expected weighted on-base average against',
    higherIsBetter: false,
    format: 'rate3',
    pick: (_s, e) => e.woba,
  },
  {
    key: 'BABIP',
    label: 'BABIP',
    description: 'Batting average on balls in play against',
    higherIsBetter: false,
    format: 'rate3',
    pick: (s, _e, a) => s.babip ?? a.babip,
  },
  {
    key: 'K/9',
    label: 'K/9',
    description: 'Strikeouts per nine innings',
    higherIsBetter: true,
    format: 'rate2',
    pick: (s, _e, a) => s.strikeoutsPer9Inn ?? a.strikeoutsPer9,
  },
  {
    key: 'BB/9',
    label: 'BB/9',
    description: 'Walks per nine innings',
    higherIsBetter: false,
    format: 'rate2',
    pick: (s, _e, a) => s.walksPer9Inn ?? a.baseOnBallsPer9,
  },
  {
    key: 'HR/9',
    label: 'HR/9',
    description: 'Home runs per nine innings',
    higherIsBetter: false,
    format: 'rate2',
    pick: (s, _e, a) => s.homeRunsPer9 ?? a.homeRunsPer9,
  },
];

function toColumns(defs: AdvColumnDef[]): StatColumn[] {
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    // IP is a counting/volume column; the rest are rates/composites.
    aggregatable: d.format === 'ip',
    higherIsBetter: d.higherIsBetter,
  }));
}

/** Advanced/expected stat columns exposed on the Player Stats grid + focus-card tiles. */
export const ADVANCED_HITTING_COLUMNS: StatColumn[] = toColumns(HITTING_ADV_DEFS);
export const ADVANCED_PITCHING_COLUMNS: StatColumn[] = toColumns(PITCHING_ADV_DEFS);

function fmtValue(value: number, format: RateFormat): string {
  if (format === 'ip') {
    // Baseball IP notation keeps .0/.1/.2 outs (145.1), not a fixed decimal rate.
    const whole = Math.trunc(value);
    const frac = Math.round((value - whole) * 10);
    if (frac === 0) return `${whole}.0`;
    if (frac === 1 || frac === 2) return `${whole}.${frac}`;
    return value.toFixed(1);
  }
  return format === 'pct' ? fmtPct(value) : format === 'rate2' ? fmt2(value) : fmt3(value);
}

/**
 * Build a colKey -> formatted-value map for one hydrated person + group; skips absent values.
 * Exported for unit testing against captured payloads (no network).
 */
export function extractAdvancedValues(
  groups: RawStatGroup[],
  group: StatGroup,
): Map<string, string> {
  const key = group === 'pitching' ? 'pitching' : 'hitting';
  const season = statOf(groups, key, 'season') ?? {};
  const exp = statOf(groups, key, 'expectedStatistics') ?? {};
  const adv = statOf(groups, key, 'seasonAdvanced') ?? {};
  const defs = group === 'pitching' ? PITCHING_ADV_DEFS : HITTING_ADV_DEFS;
  const out = new Map<string, string>();
  for (const def of defs) {
    const raw = def.pick(season, exp, adv);
    if (def.format === 'ip') {
      // Prefer MLB's own IP string ("145.1") so .1/.2 outs stay correct.
      if (typeof raw === 'string' && raw.trim() !== '' && raw.trim() !== '-') {
        out.set(def.key, raw.trim());
        continue;
      }
    }
    const n = parseRate(raw);
    if (n !== undefined) out.set(def.key, fmtValue(n, def.format));
  }
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Batch-fetch season/expected/advanced stats for a group, returning personId -> stat groups. */
async function fetchAdvancedPeople(
  personIds: number[],
  group: StatGroup,
  season: number,
): Promise<Map<number, RawStatGroup[]>> {
  const hydrate = `stats(group=[${group === 'pitching' ? 'pitching' : 'hitting'}],type=[season,expectedStatistics,seasonAdvanced],season=${season})`;
  const results = await Promise.all(
    chunk(personIds, PEOPLE_CHUNK).map((ids) =>
      fetchJson<{ people?: RawPerson[] }>(
        `${PEOPLE_URL}?personIds=${ids.join(',')}&hydrate=${encodeURIComponent(hydrate)}`,
      ),
    ),
  );
  const out = new Map<number, RawStatGroup[]>();
  for (const res of results) {
    for (const person of res.people ?? []) {
      if (typeof person.id === 'number') out.set(person.id, person.stats ?? []);
    }
  }
  return out;
}

/** A player to resolve + fill advanced values for (identity from the Yahoo scaffolding). */
export interface AdvancedStatPlayer {
  playerId: string;
  fullName: string;
  mlbTeamAbbr?: string;
}

/**
 * Build advanced/expected stat values for a set of players, aligned to ADVANCED_*_COLUMNS.
 * Yahoo still owns identity; this only fills the per-column numbers from the public MLB Stats
 * API. Unmatched players (or columns with no value) get "-". Season defaults to current year.
 */
export async function buildAdvancedStatValues(params: {
  players: AdvancedStatPlayer[];
  group: StatGroup;
  season?: number;
}): Promise<Map<string, StatValue[]>> {
  const { players, group } = params;
  const season = params.season ?? new Date().getUTCFullYear();
  const columns = group === 'pitching' ? PITCHING_ADV_DEFS : HITTING_ADV_DEFS;
  const blank = (): StatValue[] => columns.map((d) => ({ key: d.key, value: '-' }));

  const byName = await loadIdentityMap(season);
  const personIdByPlayer = new Map<string, number>();
  for (const p of players) {
    const personId = resolvePersonId(byName, p.fullName, p.mlbTeamAbbr);
    if (personId !== undefined) personIdByPlayer.set(p.playerId, personId);
  }
  const uniquePersonIds = [...new Set(personIdByPlayer.values())];
  const groupsByPerson = await fetchAdvancedPeople(uniquePersonIds, group, season);

  const out = new Map<string, StatValue[]>();
  for (const p of players) {
    const personId = personIdByPlayer.get(p.playerId);
    const groups = personId !== undefined ? groupsByPerson.get(personId) : undefined;
    if (!groups) {
      out.set(p.playerId, blank());
      continue;
    }
    const values = extractAdvancedValues(groups, group);
    out.set(
      p.playerId,
      columns.map((d) => ({ key: d.key, value: values.get(d.key) ?? '-' })),
    );
  }
  return out;
}
