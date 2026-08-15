import {
  mlbBoxScoreResponseSchema,
  mlbGamesResponseSchema,
  normalizePlayerName,
  normalizeTeamAbbr,
  playerGameKey,
  type MlbBoxBatter,
  type MlbBoxPitcher,
  type MlbBoxScoreResponse,
  type MlbBoxSide,
  type MlbGameState,
  type MlbGamesResponse,
} from '@fcm/contracts';

/**
 * Read-only client for the public MLB Stats API (statsapi.mlb.com). Used solely to
 * annotate rosters with live game state on the "Today" view - Yahoo does not expose
 * this. Requests are anonymous GETs for public data: no auth, no user data, no tokens
 * are sent (see the security rule). One of the app's non-Yahoo outbound hosts, alongside
 * the public MLB Stats endpoints and the optional Exa web search (see exaClient.ts).
 */
const SCHEDULE_URL = 'https://statsapi.mlb.com/api/v1/schedule';

/* ----------------------------- raw API shapes ----------------------------- */

interface RawPerson {
  id?: number;
  fullName?: string;
}
interface RawTeamSide {
  score?: number;
  team?: { abbreviation?: string; name?: string };
  probablePitcher?: RawPerson;
}
interface RawLineups {
  homePlayers?: RawPerson[];
  awayPlayers?: RawPerson[];
}
interface RawGame {
  gamePk?: number;
  gameDate?: string;
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: { home?: RawTeamSide; away?: RawTeamSide };
  linescore?: { currentInning?: number; inningState?: string };
  lineups?: RawLineups;
}
interface RawSchedule {
  dates?: { games?: RawGame[] }[];
}

/**
 * Canonicalize a team abbreviation so MLB Stats API and Yahoo conventions match.
 * Re-exported from contracts so callers that already import from here keep working.
 */
export { normalizeTeamAbbr } from '@fcm/contracts';

/** Map posted lineups to team|name -> batting-order slot (1-9). */
function mapBattingOrder(
  lineups: RawLineups | undefined,
  homeAbbr: string,
  awayAbbr: string,
): MlbGameState['battingOrder'] {
  if (!lineups) return undefined;
  const order: NonNullable<MlbGameState['battingOrder']> = {};
  const sides: [string, RawPerson[]][] = [
    [homeAbbr, lineups.homePlayers ?? []],
    [awayAbbr, lineups.awayPlayers ?? []],
  ];
  for (const [abbr, players] of sides) {
    players.forEach((p, index) => {
      if (typeof p.fullName === 'string') {
        order[playerGameKey(abbr, p.fullName)] = index + 1;
      }
    });
  }
  return Object.keys(order).length > 0 ? order : undefined;
}

/** Collect probable starting pitchers as team|name keys for both sides. */
function mapProbablePitchers(
  homeAbbr: string,
  awayAbbr: string,
  home: RawTeamSide | undefined,
  away: RawTeamSide | undefined,
): MlbGameState['probablePitchers'] {
  const keys: string[] = [];
  if (typeof away?.probablePitcher?.fullName === 'string') {
    keys.push(playerGameKey(awayAbbr, away.probablePitcher.fullName));
  }
  if (typeof home?.probablePitcher?.fullName === 'string') {
    keys.push(playerGameKey(homeAbbr, home.probablePitcher.fullName));
  }
  return keys.length > 0 ? keys : undefined;
}

/** Map MLB's coarse `abstractGameState` to our lifecycle enum. */
function toState(abstractGameState: string | undefined): MlbGameState['state'] {
  switch (abstractGameState) {
    case 'Live':
      return 'live';
    case 'Final':
      return 'final';
    default:
      return 'scheduled';
  }
}

/** Pure mapper: MLB schedule payload -> our DTO. Exported for unit testing. */
export function mapScheduleToGames(raw: RawSchedule, date: string): MlbGamesResponse {
  const rawGames = raw.dates?.flatMap((d) => d.games ?? []) ?? [];
  const games: MlbGameState[] = rawGames.flatMap((g) => {
    const homeAbbr = g.teams?.home?.team?.abbreviation;
    const awayAbbr = g.teams?.away?.team?.abbreviation;
    if (typeof g.gamePk !== 'number' || !homeAbbr || !awayAbbr) {
      return [];
    }
    const state = toState(g.status?.abstractGameState);
    return [
      {
        gamePk: g.gamePk,
        state,
        detail: g.status?.detailedState ?? state,
        ...(g.gameDate ? { startTime: g.gameDate } : {}),
        homeAbbr: normalizeTeamAbbr(homeAbbr),
        awayAbbr: normalizeTeamAbbr(awayAbbr),
        ...(typeof g.teams?.home?.score === 'number' ? { homeScore: g.teams.home.score } : {}),
        ...(typeof g.teams?.away?.score === 'number' ? { awayScore: g.teams.away.score } : {}),
        // Inning info is only meaningful while the game is live.
        ...(state === 'live' && typeof g.linescore?.currentInning === 'number'
          ? { inning: g.linescore.currentInning }
          : {}),
        ...(state === 'live' && g.linescore?.inningState
          ? { inningState: g.linescore.inningState }
          : {}),
        ...(() => {
          const battingOrder = mapBattingOrder(g.lineups, homeAbbr, awayAbbr);
          return battingOrder ? { battingOrder } : {};
        })(),
        ...(() => {
          const probablePitchers = mapProbablePitchers(
            homeAbbr,
            awayAbbr,
            g.teams?.home,
            g.teams?.away,
          );
          return probablePitchers ? { probablePitchers } : {};
        })(),
      },
    ];
  });
  return mlbGamesResponseSchema.parse({ date, games });
}

/** Fetch every MLB game for a date (YYYY-MM-DD) with its current live state. */
export async function getGamesForDate(date: string): Promise<MlbGamesResponse> {
  const url = `${SCHEDULE_URL}?sportId=1&date=${date}&hydrate=team,linescore,probablePitcher,lineups`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`MLB schedule request failed: ${res.status}`);
  }
  const raw = (await res.json()) as RawSchedule;
  return mapScheduleToGames(raw, date);
}

/* ------------------------------- box score -------------------------------- */

const BOXSCORE_URL = 'https://statsapi.mlb.com/api/v1/game';

/** Raw shapes for the subset of the boxscore payload we consume. */
interface RawBoxStats {
  batting?: Record<string, unknown>;
  pitching?: Record<string, unknown>;
}
interface RawBoxPlayer {
  person?: { fullName?: string };
  position?: { abbreviation?: string };
  /** MLB encodes the lineup slot as a string like "100" (leadoff) or "201" (sub, 2 spot). */
  battingOrder?: string;
  stats?: RawBoxStats;
  seasonStats?: RawBoxStats;
}
interface RawBoxTeam {
  team?: { name?: string; abbreviation?: string };
  teamStats?: { batting?: Record<string, unknown>; fielding?: Record<string, unknown> };
  players?: Record<string, RawBoxPlayer>;
  batters?: number[];
  pitchers?: number[];
}
interface RawBoxScore {
  teams?: { home?: RawBoxTeam; away?: RawBoxTeam };
}

/** Read a numeric stat, defaulting to 0 (box score counting stats are always present when a line exists). */
function num(stats: Record<string, unknown> | undefined, key: string): number {
  const v = stats?.[key];
  return typeof v === 'number' ? v : 0;
}

/** Read a string stat (rate stats like avg/era/inningsPitched come as strings). */
function str(stats: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = stats?.[key];
  return typeof v === 'string' ? v : undefined;
}

/** Convert MLB's lineup-slot code ("100", "201") to a 1-9 batting-order slot. */
function toBattingOrderSlot(code: string | undefined): number | undefined {
  if (!code) return undefined;
  const slot = Math.floor(Number(code) / 100);
  return slot >= 1 && slot <= 9 ? slot : undefined;
}

/** Extract a pitcher's decision (W/L/SV/HLD/BS) from a note like "(W, 2-15)". */
function parseDecision(note: string | undefined): string | undefined {
  const match = note?.match(/^\(([A-Z]+)/);
  if (!match) return undefined;
  const code = match[1];
  if (code === 'S') return 'SV';
  if (code === 'H') return 'HLD';
  return code;
}

function mapBoxBatter(p: RawBoxPlayer): MlbBoxBatter | undefined {
  const fullName = p.person?.fullName;
  if (!fullName) return undefined;
  const batting = p.stats?.batting;
  const slot = toBattingOrderSlot(p.battingOrder);
  const avg = str(p.seasonStats?.batting, 'avg');
  return {
    fullName,
    ...(p.position?.abbreviation ? { position: p.position.abbreviation } : {}),
    ...(slot ? { battingOrder: slot } : {}),
    ab: num(batting, 'atBats'),
    r: num(batting, 'runs'),
    h: num(batting, 'hits'),
    rbi: num(batting, 'rbi'),
    hr: num(batting, 'homeRuns'),
    bb: num(batting, 'baseOnBalls'),
    so: num(batting, 'strikeOuts'),
    ...(avg ? { avg } : {}),
  };
}

function mapBoxPitcher(p: RawBoxPlayer): MlbBoxPitcher | undefined {
  const fullName = p.person?.fullName;
  if (!fullName) return undefined;
  const pitching = p.stats?.pitching;
  const decision = parseDecision(str(pitching, 'note'));
  const era = str(p.seasonStats?.pitching, 'era');
  return {
    fullName,
    ...(decision ? { decision } : {}),
    ip: str(pitching, 'inningsPitched') ?? '0.0',
    h: num(pitching, 'hits'),
    r: num(pitching, 'runs'),
    er: num(pitching, 'earnedRuns'),
    bb: num(pitching, 'baseOnBalls'),
    so: num(pitching, 'strikeOuts'),
    hr: num(pitching, 'homeRuns'),
    ...(era ? { era } : {}),
  };
}

/** Map one team's half of the boxscore, preserving MLB's batting/pitching order. */
function mapBoxSide(side: RawBoxTeam | undefined): MlbBoxSide {
  const players = side?.players ?? {};
  const batters = (side?.batters ?? [])
    .map((id) => mapBoxBatter(players[`ID${id}`] ?? {}))
    .filter((b): b is MlbBoxBatter => b !== undefined);
  const pitchers = (side?.pitchers ?? [])
    .map((id) => mapBoxPitcher(players[`ID${id}`] ?? {}))
    .filter((p): p is MlbBoxPitcher => p !== undefined);
  return {
    teamAbbr: side?.team?.abbreviation ? normalizeTeamAbbr(side.team.abbreviation) : '',
    teamName: side?.team?.name ?? '',
    runs: num(side?.teamStats?.batting, 'runs'),
    hits: num(side?.teamStats?.batting, 'hits'),
    errors: num(side?.teamStats?.fielding, 'errors'),
    batters,
    pitchers,
  };
}

/** Pure mapper: MLB boxscore payload -> our DTO. Exported for unit testing. */
export function mapBoxScore(raw: RawBoxScore, gamePk: number): MlbBoxScoreResponse {
  return mlbBoxScoreResponseSchema.parse({
    gamePk,
    home: mapBoxSide(raw.teams?.home),
    away: mapBoxSide(raw.teams?.away),
  });
}

/** Fetch one game's full box score (batting + pitching lines) by MLB gamePk. */
export async function getBoxScore(gamePk: number): Promise<MlbBoxScoreResponse> {
  const raw = await fetchJson<RawBoxScore>(`${BOXSCORE_URL}/${gamePk}/boxscore`);
  return mapBoxScore(raw, gamePk);
}

/* --------------------------- probable starters ---------------------------- */

/** One announced probable start: the pitcher, their team, opponent, and home/away. */
export interface ProbableStart {
  team: string;
  opponent: string;
  home: boolean;
  pitcher: string;
  pitcherId?: number;
  /** Scheduled first-pitch time (ISO), when the schedule provides it. */
  gameTime?: string;
}

/** Probable starts for a single calendar date (games with no announced starter are dropped). */
export interface ProbableStartsDay {
  date: string;
  starts: ProbableStart[];
}

/** Announced probable starters across an inclusive date window. */
export interface ProbableStartersResult {
  start: string;
  end: string;
  days: ProbableStartsDay[];
}

/** Schedule payload carries the game date on each `dates` group (unlike the single-day fetch). */
interface RawScheduleDate {
  date?: string;
  games?: RawGame[];
}
interface RawProbableSchedule {
  dates?: RawScheduleDate[];
}

/** Today's date (YYYY-MM-DD) in US Eastern, matching how MLB dates games. */
function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Pure mapper: schedule payload -> announced probable starters per date. Each game yields
 * up to two starts (home + away), skipping sides without an announced pitcher. Optionally
 * filters to a single MLB team. Exported for unit testing without the network.
 */
export function mapScheduleToProbableStarters(
  raw: RawProbableSchedule,
  start: string,
  end: string,
  teamAbbr?: string,
): ProbableStartersResult {
  const wantTeam = teamAbbr ? normalizeTeamAbbr(teamAbbr) : undefined;
  const days: ProbableStartsDay[] = [];
  for (const d of raw.dates ?? []) {
    if (typeof d.date !== 'string') continue;
    const starts: ProbableStart[] = [];
    for (const g of d.games ?? []) {
      const homeAbbr = g.teams?.home?.team?.abbreviation;
      const awayAbbr = g.teams?.away?.team?.abbreviation;
      if (!homeAbbr || !awayAbbr) continue;
      const home = normalizeTeamAbbr(homeAbbr);
      const away = normalizeTeamAbbr(awayAbbr);
      const sides = [
        { side: g.teams?.home, team: home, opponent: away, isHome: true },
        { side: g.teams?.away, team: away, opponent: home, isHome: false },
      ];
      for (const s of sides) {
        const pitcher = s.side?.probablePitcher;
        if (typeof pitcher?.fullName !== 'string') continue;
        starts.push({
          team: s.team,
          opponent: s.opponent,
          home: s.isHome,
          pitcher: pitcher.fullName,
          ...(typeof pitcher.id === 'number' ? { pitcherId: pitcher.id } : {}),
          ...(g.gameDate ? { gameTime: g.gameDate } : {}),
        });
      }
    }
    const filtered = wantTeam ? starts.filter((s) => s.team === wantTeam) : starts;
    if (filtered.length > 0) days.push({ date: d.date, starts: filtered });
  }
  return { start, end, days };
}

/**
 * Announced probable starting pitchers for the next `days` days (inclusive of today,
 * Eastern), optionally filtered to one MLB team. Anonymous GET for public data.
 */
export async function getProbableStarters(
  opts: { days?: number; teamAbbr?: string; today?: string } = {},
): Promise<ProbableStartersResult> {
  const days = Math.min(Math.max(opts.days ?? 7, 1), 7);
  const start = opts.today ?? easternToday();
  const end = addDays(start, days - 1);
  const raw = await fetchJson<RawProbableSchedule>(
    `${SCHEDULE_URL}?sportId=1&startDate=${start}&endDate=${end}&hydrate=probablePitcher,team`,
  );
  return mapScheduleToProbableStarters(raw, start, end, opts.teamAbbr);
}

/* -------------------------------------------------------------------------- */
/* Player enrichment + transactions ("news") from the public MLB Stats API.   */
/* Anonymous GETs for public data - no auth, no user data sent upstream.       */
/* -------------------------------------------------------------------------- */

const PEOPLE_SEARCH_URL = 'https://statsapi.mlb.com/api/v1/people/search';
const PEOPLE_URL = 'https://statsapi.mlb.com/api/v1/people';
const TRANSACTIONS_URL = 'https://statsapi.mlb.com/api/v1/transactions';

/** A compact, matched enrichment for one player (or a not-found result). */
export interface MlbPlayerEnrichment {
  matched: boolean;
  /** The name we searched for (echoed back so the caller/model has context). */
  query: string;
  id?: number;
  fullName?: string;
  team?: string;
  primaryPosition?: string;
  batSide?: string;
  pitchHand?: string;
  /** Curated season hitting stats (counting + rate), only present for hitters. */
  hitting?: Record<string, number | string>;
  /** Curated season pitching stats, only present for pitchers. */
  pitching?: Record<string, number | string>;
}

/** One roster transaction (trade, signing, IL move, call-up) - the free "news" feed. */
export interface MlbTransaction {
  date?: string;
  type?: string;
  description?: string;
  player?: string;
  team?: string;
}

interface RawPersonSearch {
  id?: number;
  fullName?: string;
  currentTeam?: { abbreviation?: string; name?: string };
  primaryPosition?: { abbreviation?: string };
}
interface RawStatSplit {
  stat?: Record<string, unknown>;
}
interface RawStatGroup {
  group?: { displayName?: string };
  type?: { displayName?: string };
  splits?: RawStatSplit[];
}
interface RawPerson {
  id?: number;
  fullName?: string;
  currentTeam?: { abbreviation?: string; name?: string };
  primaryPosition?: { abbreviation?: string };
  batSide?: { code?: string };
  pitchHand?: { code?: string };
  stats?: RawStatGroup[];
}

/** Curated season stat keys per group, to keep enrichment payloads token-small. */
const HITTING_KEYS = ['gamesPlayed', 'avg', 'homeRuns', 'rbi', 'runs', 'stolenBases', 'ops'] as const;
const PITCHING_KEYS = ['wins', 'losses', 'era', 'whip', 'strikeOuts', 'saves', 'inningsPitched'] as const;

/**
 * Choose the best person match for a searched name, preferring an exact normalized
 * name match and, when a team hint is given, one whose current team matches. Pure and
 * exported for unit testing without the network.
 */
export function pickBestPersonMatch(
  people: RawPersonSearch[],
  name: string,
  teamAbbr?: string,
): RawPersonSearch | undefined {
  const wantName = normalizePlayerName(name);
  const wantTeam = teamAbbr ? normalizeTeamAbbr(teamAbbr) : undefined;
  const named = people.filter(
    (p) => typeof p.fullName === 'string' && normalizePlayerName(p.fullName) === wantName,
  );
  const pool = named.length > 0 ? named : [];
  if (pool.length === 0) return undefined;
  if (wantTeam) {
    const teamMatch = pool.find(
      (p) => p.currentTeam?.abbreviation && normalizeTeamAbbr(p.currentTeam.abbreviation) === wantTeam,
    );
    if (teamMatch) return teamMatch;
  }
  return pool[0];
}

/** Pick a curated subset of a raw stat object, dropping absent keys. */
function pickStats(
  stat: Record<string, unknown> | undefined,
  keys: readonly string[],
): Record<string, number | string> | undefined {
  if (!stat) return undefined;
  const out: Record<string, number | string> = {};
  for (const key of keys) {
    const value = stat[key];
    if (typeof value === 'number' || typeof value === 'string') out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Map a hydrated `/people/{id}` person (with season stats) into our compact enrichment.
 * Pure and exported for unit testing against captured payloads.
 */
export function mapPersonToEnrichment(person: RawPerson | undefined, query: string): MlbPlayerEnrichment {
  if (!person || typeof person.id !== 'number') return { matched: false, query };
  const groups = Array.isArray(person.stats) ? person.stats : [];
  const seasonSplit = (name: string) =>
    groups.find((g) => g.group?.displayName === name && g.type?.displayName === 'season')?.splits?.[0]
      ?.stat;
  const hitting = pickStats(seasonSplit('hitting'), HITTING_KEYS);
  const pitching = pickStats(seasonSplit('pitching'), PITCHING_KEYS);
  return {
    matched: true,
    query,
    id: person.id,
    ...(person.fullName ? { fullName: person.fullName } : {}),
    ...(person.currentTeam?.abbreviation
      ? { team: normalizeTeamAbbr(person.currentTeam.abbreviation) }
      : {}),
    ...(person.primaryPosition?.abbreviation
      ? { primaryPosition: person.primaryPosition.abbreviation }
      : {}),
    ...(person.batSide?.code ? { batSide: person.batSide.code } : {}),
    ...(person.pitchHand?.code ? { pitchHand: person.pitchHand.code } : {}),
    ...(hitting ? { hitting } : {}),
    ...(pitching ? { pitching } : {}),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`MLB request failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Enrich a player reference with real MLB season stats + team/position, reconciled by
 * normalized name (and an optional team hint). Returns `{ matched: false }` rather than
 * guessing when no confident match is found, so the model never fabricates stats.
 */
export async function enrichPlayer(
  name: string,
  opts: { teamAbbr?: string; season?: number } = {},
): Promise<MlbPlayerEnrichment> {
  const season = opts.season ?? new Date().getUTCFullYear();
  const search = await fetchJson<{ people?: RawPersonSearch[] }>(
    `${PEOPLE_SEARCH_URL}?names=${encodeURIComponent(name)}&sportId=1&active=true`,
  );
  const match = pickBestPersonMatch(search.people ?? [], name, opts.teamAbbr);
  if (!match || typeof match.id !== 'number') return { matched: false, query: name };
  const hydrate = `stats(group=[hitting,pitching],type=[season],season=${season}),currentTeam`;
  const detail = await fetchJson<{ people?: RawPerson[] }>(
    `${PEOPLE_URL}/${match.id}?hydrate=${encodeURIComponent(hydrate)}`,
  );
  return mapPersonToEnrichment(detail.people?.[0], name);
}

interface RawTransaction {
  date?: string;
  typeDesc?: string;
  description?: string;
  person?: { fullName?: string };
  team?: { abbreviation?: string; name?: string };
}

/** Map the raw transactions payload to our compact list. Pure and exported for tests. */
export function mapTransactions(raw: { transactions?: RawTransaction[] }): MlbTransaction[] {
  return (raw.transactions ?? []).map((t) => ({
    ...(t.date ? { date: t.date } : {}),
    ...(t.typeDesc ? { type: t.typeDesc } : {}),
    ...(t.description ? { description: t.description } : {}),
    ...(t.person?.fullName ? { player: t.person.fullName } : {}),
    ...(t.team?.abbreviation ? { team: normalizeTeamAbbr(t.team.abbreviation) } : {}),
  }));
}

/** Format a Date as the YYYY-MM-DD the MLB transactions endpoint expects (UTC). */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Recent roster transactions ("news") for a player over a trailing window. Resolves the
 * player to an MLB id first; returns an empty list on no match. Newest transactions first.
 */
export async function getPlayerNews(
  name: string,
  opts: { teamAbbr?: string; days?: number } = {},
): Promise<{ matched: boolean; player: string; transactions: MlbTransaction[] }> {
  const search = await fetchJson<{ people?: RawPersonSearch[] }>(
    `${PEOPLE_SEARCH_URL}?names=${encodeURIComponent(name)}&sportId=1`,
  );
  const match = pickBestPersonMatch(search.people ?? [], name, opts.teamAbbr);
  if (!match || typeof match.id !== 'number') return { matched: false, player: name, transactions: [] };
  const days = opts.days ?? 45;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const raw = await fetchJson<{ transactions?: RawTransaction[] }>(
    `${TRANSACTIONS_URL}?playerId=${match.id}&startDate=${toIsoDate(start)}&endDate=${toIsoDate(end)}`,
  );
  const transactions = mapTransactions(raw).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return { matched: true, player: match.fullName ?? name, transactions };
}
