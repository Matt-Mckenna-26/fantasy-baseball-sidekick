import {
  normalizePlayerName,
  normalizeTeamAbbr,
  type StatColumn,
  type StatRange,
  type StatValue,
} from '@fcm/contracts';

/**
 * Derives per-window PLAYER stat values from the public MLB Stats API (anonymous GETs
 * for public data - no auth, no user data, no tokens; see the security rule). Yahoo
 * still owns identity, ownership, and season rank; this module only supplies the numbers
 * that fill each scoring-category column, keyed by the league's own StatColumns.
 *
 * Why game logs: MLB exposes native `lastweek`/`lastmonth` splits but NOT arbitrary
 * windows (e.g. Last 14) or Quality Starts. Per-game logs carry a date plus component
 * stats, so we can aggregate ANY window locally and derive composites (QS = a start with
 * IP>=6 and ER<=3). One game-log pull per player per group covers every window.
 */

const SPORTS_PLAYERS_URL = 'https://statsapi.mlb.com/api/v1/sports/1/players';
const TEAMS_URL = 'https://statsapi.mlb.com/api/v1/teams';
const PEOPLE_URL = 'https://statsapi.mlb.com/api/v1/people';

/** The MLB players roster changes slowly; cache the identity map for a few hours. */
const IDENTITY_TTL_MS = 6 * 60 * 60 * 1000;
/** How many personIds to request per /people call (keeps each URL + response bounded). */
const PEOPLE_CHUNK = 25;

export type StatGroup = 'hitting' | 'pitching';

/* ------------------------------ HTTP + helpers ---------------------------- */

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`MLB request failed: ${res.status}`);
  return (await res.json()) as T;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Coerce a raw MLB stat value (number or numeric string) to a number, or null. */
function toNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && value !== '-') {
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Convert an innings-pitched figure ("6.1" = 6 IP + 1 out) to total outs. */
function ipToOuts(value: unknown): number | null {
  const ip = toNum(value);
  if (ip === null) return null;
  const whole = Math.trunc(ip);
  const frac = Math.round((ip - whole) * 10);
  return whole * 3 + frac;
}

/** Format outs back into MLB's "X.Y" innings string (Y = leftover outs, 0-2). */
function formatIp(outs: number): string {
  return `${Math.trunc(outs / 3)}.${outs % 3}`;
}

/** Batting-average-style rate: 3 decimals with the leading zero stripped (".320"). */
function rate3(value: number | null): string | null {
  if (value === null) return null;
  let s = value.toFixed(3);
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = `-${s.slice(2)}`;
  return s;
}

/** ERA/WHIP-style rate: 2 decimals, keeping the leading digit ("2.38", "1.01"). */
function rate2(value: number | null): string | null {
  return value === null ? null : value.toFixed(2);
}

function div(numerator: number | undefined, denominator: number | undefined): number | null {
  if (!denominator) return null;
  return (numerator ?? 0) / denominator;
}

/* ------------------------------ identity map ------------------------------ */

interface RawSportsPlayer {
  id?: number;
  fullName?: string;
  currentTeam?: { id?: number };
}
interface IdentityEntry {
  id: number;
  teamAbbr?: string;
}

let identityCache: { season: number; at: number; byName: Map<string, IdentityEntry[]> } | null =
  null;

/** Build a team-id -> normalized-abbreviation map so player entries can carry a team hint. */
async function loadTeamAbbrById(season: number): Promise<Map<number, string>> {
  const raw = await fetchJson<{ teams?: { id?: number; abbreviation?: string }[] }>(
    `${TEAMS_URL}?sportId=1&season=${season}&fields=teams,id,abbreviation`,
  );
  const map = new Map<number, string>();
  for (const t of raw.teams ?? []) {
    if (typeof t.id === 'number' && typeof t.abbreviation === 'string') {
      map.set(t.id, normalizeTeamAbbr(t.abbreviation));
    }
  }
  return map;
}

/**
 * Build (and cache) a normalized-name -> [{personId, teamAbbr}] map from the season's
 * full MLB player list. The bulk list only carries `currentTeam.id`, so we resolve team
 * abbreviations via the teams endpoint for the disambiguation hint. Exported-shape pieces
 * (`resolvePersonId`) are pure so name matching is unit-testable without the network.
 */
export async function loadIdentityMap(season: number): Promise<Map<string, IdentityEntry[]>> {
  if (
    identityCache &&
    identityCache.season === season &&
    Date.now() - identityCache.at < IDENTITY_TTL_MS
  ) {
    return identityCache.byName;
  }
  const [teamAbbrById, raw] = await Promise.all([
    loadTeamAbbrById(season),
    fetchJson<{ people?: RawSportsPlayer[] }>(
      `${SPORTS_PLAYERS_URL}?season=${season}&fields=people,id,fullName,currentTeam`,
    ),
  ]);
  const byName = new Map<string, IdentityEntry[]>();
  for (const p of raw.people ?? []) {
    if (typeof p.id !== 'number' || typeof p.fullName !== 'string') continue;
    const key = normalizePlayerName(p.fullName);
    const teamAbbr =
      typeof p.currentTeam?.id === 'number' ? teamAbbrById.get(p.currentTeam.id) : undefined;
    const entry: IdentityEntry = { id: p.id, ...(teamAbbr ? { teamAbbr } : {}) };
    const list = byName.get(key);
    if (list) list.push(entry);
    else byName.set(key, [entry]);
  }
  identityCache = { season, at: Date.now(), byName };
  return byName;
}

/**
 * Resolve a Yahoo player to an MLB personId by normalized name, using the team
 * abbreviation to break ties when a name maps to several players. Returns undefined
 * (never a guess) when the name is unknown, so callers can blank rather than fabricate.
 */
export function resolvePersonId(
  byName: Map<string, IdentityEntry[]>,
  fullName: string,
  teamAbbr?: string,
): number | undefined {
  const list = byName.get(normalizePlayerName(fullName));
  if (!list || list.length === 0) return undefined;
  if (list.length === 1) return list[0]!.id;
  if (teamAbbr) {
    const want = normalizeTeamAbbr(teamAbbr);
    const hit = list.find((e) => e.teamAbbr === want);
    if (hit) return hit.id;
  }
  return list[0]!.id;
}

/* ------------------------------ game logs --------------------------------- */

interface RawSplit {
  date?: string;
  stat?: Record<string, unknown>;
}
interface RawStatGroup {
  group?: { displayName?: string };
  type?: { displayName?: string };
  splits?: RawSplit[];
}
interface RawPersonLog {
  id?: number;
  stats?: RawStatGroup[];
}

/**
 * Batch-fetch season game logs for a group, returning personId -> per-game splits.
 * Exported so the bullpen deriver can reuse the same batched pull + windowing.
 */
export async function fetchGameLogs(
  personIds: number[],
  group: StatGroup,
  season: number,
): Promise<Map<number, RawSplit[]>> {
  const out = new Map<number, RawSplit[]>();
  const hydrate = `stats(group=[${group}],type=[gameLog],season=${season})`;
  const results = await Promise.all(
    chunk(personIds, PEOPLE_CHUNK).map((ids) =>
      fetchJson<{ people?: RawPersonLog[] }>(
        `${PEOPLE_URL}?personIds=${ids.join(',')}&hydrate=${hydrate}`,
      ),
    ),
  );
  for (const res of results) {
    for (const person of res.people ?? []) {
      if (typeof person.id !== 'number') continue;
      const grp = (person.stats ?? []).find(
        (g) => g.group?.displayName === group && g.type?.displayName === 'gameLog',
      );
      out.set(person.id, grp?.splits ?? []);
    }
  }
  return out;
}

/* ------------------------------ aggregation ------------------------------- */

/** Inclusive date bounds for a window, or 'season' to include every game. */
export type Window = { start: string; end: string } | 'season';

/** Today's date (YYYY-MM-DD) in US Eastern, matching how MLB dates games. */
function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Map a StatRange to inclusive date bounds (trailing N calendar days, ending today). */
export function windowBounds(range: StatRange, today: string = easternToday()): Window {
  switch (range) {
    case 'season':
      return 'season';
    case 'today':
      return { start: today, end: today };
    case 'last7':
      return { start: subtractDays(today, 6), end: today };
    case 'last14':
      return { start: subtractDays(today, 13), end: today };
    case 'last21':
      return { start: subtractDays(today, 20), end: today };
    case 'last30':
      return { start: subtractDays(today, 29), end: today };
  }
}

/** Counting-stat keys summed per group (rate/derived stats are computed from these). */
const HITTING_KEYS = [
  'gamesPlayed',
  'atBats',
  'runs',
  'hits',
  'doubles',
  'triples',
  'homeRuns',
  'rbi',
  'baseOnBalls',
  'intentionalWalks',
  'strikeOuts',
  'stolenBases',
  'caughtStealing',
  'hitByPitch',
  'sacFlies',
  'totalBases',
] as const;
const PITCHING_KEYS = [
  'gamesPlayed',
  'gamesStarted',
  'gamesFinished',
  'wins',
  'losses',
  'saves',
  'saveOpportunities',
  'holds',
  'blownSaves',
  'strikeOuts',
  'baseOnBalls',
  'hits',
  'homeRuns',
  'earnedRuns',
  'runs',
  'outs',
  'completeGames',
  'shutouts',
] as const;

/** Summed component totals for a window, plus derived pitching pieces (outs, QS). */
export interface AggregatedStats {
  group: StatGroup;
  totals: Map<string, number>;
  outs: number;
  qualityStarts: number;
}

/**
 * Aggregate a player's game-log splits over a window: sum the counting components, sum
 * outs (for IP-based rates), and count Quality Starts (a start of IP>=6 with ER<=3).
 * Pure and exported for unit testing against captured payloads.
 */
export function aggregateSplits(
  splits: RawSplit[],
  group: StatGroup,
  window: Window,
): AggregatedStats {
  const totals = new Map<string, number>();
  const keys = group === 'hitting' ? HITTING_KEYS : PITCHING_KEYS;
  let qualityStarts = 0;
  for (const sp of splits) {
    if (window !== 'season') {
      const d = sp.date;
      if (typeof d !== 'string' || d < window.start || d > window.end) continue;
    }
    const stat = sp.stat ?? {};
    for (const k of keys) {
      const n = toNum(stat[k]);
      if (n !== null) totals.set(k, (totals.get(k) ?? 0) + n);
    }
    if (group === 'pitching' && (toNum(stat.gamesStarted) ?? 0) >= 1) {
      const outs = toNum(stat.outs) ?? ipToOuts(stat.inningsPitched);
      const er = toNum(stat.earnedRuns) ?? 0;
      if (outs !== null && outs >= 18 && er <= 3) qualityStarts += 1;
    }
  }
  return { group, totals, outs: totals.get('outs') ?? 0, qualityStarts };
}

/* --------------------------- category mapping ----------------------------- */

type Deriver = (a: AggregatedStats) => number | string | null;

/** On-base percentage from summed components: (H + BB + HBP) / (AB + BB + HBP + SF). */
function obp(a: AggregatedStats): number | null {
  const h = a.totals.get('hits') ?? 0;
  const bb = a.totals.get('baseOnBalls') ?? 0;
  const hbp = a.totals.get('hitByPitch') ?? 0;
  const ab = a.totals.get('atBats') ?? 0;
  const sf = a.totals.get('sacFlies') ?? 0;
  const denom = ab + bb + hbp + sf;
  return denom > 0 ? (h + bb + hbp) / denom : null;
}

function count(a: AggregatedStats, key: string): number {
  return a.totals.get(key) ?? 0;
}

/**
 * League scoring categories keyed by their normalized Yahoo display label -> a function
 * that derives the value from aggregated MLB components. Composite/derived categories
 * (NSB, QS, K/9, SV+H) are handled here so v2 covers them the way the Yahoo UI does.
 * Any label absent from this table is left blank (never fabricated) and logged.
 */
const HITTING_DERIVERS: Record<string, Deriver> = {
  R: (a) => count(a, 'runs'),
  H: (a) => count(a, 'hits'),
  HR: (a) => count(a, 'homeRuns'),
  RBI: (a) => count(a, 'rbi'),
  SB: (a) => count(a, 'stolenBases'),
  CS: (a) => count(a, 'caughtStealing'),
  BB: (a) => count(a, 'baseOnBalls'),
  K: (a) => count(a, 'strikeOuts'),
  SO: (a) => count(a, 'strikeOuts'),
  '2B': (a) => count(a, 'doubles'),
  '3B': (a) => count(a, 'triples'),
  TB: (a) => count(a, 'totalBases'),
  AB: (a) => count(a, 'atBats'),
  HBP: (a) => count(a, 'hitByPitch'),
  XBH: (a) => count(a, 'doubles') + count(a, 'triples') + count(a, 'homeRuns'),
  NSB: (a) => count(a, 'stolenBases') - count(a, 'caughtStealing'),
  'SB-CS': (a) => count(a, 'stolenBases') - count(a, 'caughtStealing'),
  'H/AB': (a) => `${count(a, 'hits')}/${count(a, 'atBats')}`,
  AVG: (a) => rate3(div(count(a, 'hits'), count(a, 'atBats'))),
  OBP: (a) => rate3(obp(a)),
  SLG: (a) => rate3(div(count(a, 'totalBases'), count(a, 'atBats'))),
  OPS: (a) => {
    const o = obp(a);
    const s = div(count(a, 'totalBases'), count(a, 'atBats'));
    return o === null || s === null ? null : rate3(o + s);
  },
};

const PITCHING_DERIVERS: Record<string, Deriver> = {
  W: (a) => count(a, 'wins'),
  L: (a) => count(a, 'losses'),
  SV: (a) => count(a, 'saves'),
  HD: (a) => count(a, 'holds'),
  HLD: (a) => count(a, 'holds'),
  BS: (a) => count(a, 'blownSaves'),
  K: (a) => count(a, 'strikeOuts'),
  SO: (a) => count(a, 'strikeOuts'),
  BB: (a) => count(a, 'baseOnBalls'),
  H: (a) => count(a, 'hits'),
  ER: (a) => count(a, 'earnedRuns'),
  HR: (a) => count(a, 'homeRuns'),
  G: (a) => count(a, 'gamesPlayed'),
  GS: (a) => count(a, 'gamesStarted'),
  CG: (a) => count(a, 'completeGames'),
  SHO: (a) => count(a, 'shutouts'),
  QS: (a) => a.qualityStarts,
  IP: (a) => formatIp(a.outs),
  ERA: (a) => rate2(a.outs > 0 ? (27 * count(a, 'earnedRuns')) / a.outs : null),
  WHIP: (a) =>
    rate2(a.outs > 0 ? (3 * (count(a, 'baseOnBalls') + count(a, 'hits'))) / a.outs : null),
  'K/9': (a) => rate2(a.outs > 0 ? (27 * count(a, 'strikeOuts')) / a.outs : null),
  K9: (a) => rate2(a.outs > 0 ? (27 * count(a, 'strikeOuts')) / a.outs : null),
  'SV+H': (a) => count(a, 'saves') + count(a, 'holds'),
  SVH: (a) => count(a, 'saves') + count(a, 'holds'),
  'S+H': (a) => count(a, 'saves') + count(a, 'holds'),
  'SV+HLD': (a) => count(a, 'saves') + count(a, 'holds'),
};

/** Normalize a column label to match the deriver tables ("K/9", "SV+H", "2B"). */
function labelKey(label: string): string {
  return label.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Map one player's aggregated stats onto the league columns, in column order. Columns
 * without a known deriver become "-" (Yahoo's own missing placeholder) and are counted
 * as unmapped so the caller can log the gap.
 */
export function mapColumns(
  columns: StatColumn[],
  agg: AggregatedStats | null,
  unmappedLabels: Set<string>,
): StatValue[] {
  const derivers = agg?.group === 'pitching' ? PITCHING_DERIVERS : HITTING_DERIVERS;
  return columns.map((col) => {
    if (!agg) return { key: col.key, value: '-' };
    const deriver = derivers[labelKey(col.label)];
    if (!deriver) {
      unmappedLabels.add(col.label);
      return { key: col.key, value: '-' };
    }
    const value = deriver(agg);
    return { key: col.key, value: value === null ? '-' : value };
  });
}

/* ------------------------------ public API -------------------------------- */

/** A player to resolve + fill: minimal identity from the Yahoo scaffolding. */
export interface MlbStatPlayer {
  playerId: string;
  fullName: string;
  mlbTeamAbbr?: string;
}

export interface MlbStatValuesResult {
  /** playerId -> stat values aligned to `columns` (unmatched players get all "-"). */
  byPlayerId: Map<string, StatValue[]>;
  matched: number;
  unmatched: number;
}

/**
 * Build MLB-derived stat values for a set of players over a window, aligned to the
 * league's own scoring columns. Yahoo remains the source of identity/ownership/rank; this
 * only produces the per-column numbers. Season defaults to the current (Eastern) year.
 */
export async function buildMlbStatValues(params: {
  players: MlbStatPlayer[];
  columns: StatColumn[];
  group: StatGroup;
  range: StatRange;
  season?: number;
}): Promise<MlbStatValuesResult> {
  const { players, columns, group, range } = params;
  const season = params.season ?? Number(easternToday().slice(0, 4));
  const byName = await loadIdentityMap(season);

  const personIdByPlayer = new Map<string, number>();
  for (const p of players) {
    const personId = resolvePersonId(byName, p.fullName, p.mlbTeamAbbr);
    if (personId !== undefined) personIdByPlayer.set(p.playerId, personId);
  }

  const uniquePersonIds = [...new Set(personIdByPlayer.values())];
  const logsByPerson = await fetchGameLogs(uniquePersonIds, group, season);
  const window = windowBounds(range);

  const byPlayerId = new Map<string, StatValue[]>();
  const unmappedLabels = new Set<string>();
  let matched = 0;
  let unmatched = 0;
  for (const p of players) {
    const personId = personIdByPlayer.get(p.playerId);
    const splits = personId !== undefined ? logsByPerson.get(personId) : undefined;
    if (personId === undefined || splits === undefined) {
      unmatched += 1;
      byPlayerId.set(p.playerId, mapColumns(columns, null, unmappedLabels));
      continue;
    }
    matched += 1;
    const agg = aggregateSplits(splits, group, window);
    byPlayerId.set(p.playerId, mapColumns(columns, agg, unmappedLabels));
  }

  if (unmatched > 0 || unmappedLabels.size > 0) {
    console.warn(
      `[mlb-stats] ${group} range=${range}: matched ${matched}, unmatched ${unmatched}` +
        (unmappedLabels.size > 0 ? `; unmapped categories: ${[...unmappedLabels].join(', ')}` : ''),
    );
  }
  return { byPlayerId, matched, unmatched };
}
