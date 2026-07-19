import { normalizeTeamAbbr } from '@fcm/contracts';
import { aggregateSplits, fetchGameLogs, windowBounds } from './mlbStats.js';

/**
 * Derives a team's bullpen save-role hierarchy from the public MLB Stats API (anonymous
 * GETs for public data - no auth, no user data, no tokens; see the security rule). The
 * raw MLB depth chart does not label closer/setup, so instead of a fragile role source we
 * infer roles from recent relief usage: who is actually collecting saves, save chances,
 * games finished, and holds over a trailing window. This is what stops the co-manager from
 * recommending the wrong reliever for saves/holds.
 */

const TEAMS_URL = 'https://statsapi.mlb.com/api/v1/teams';
const ROSTER_URL = 'https://statsapi.mlb.com/api/v1/teams';

/** How many relievers to return (top by recent leverage usage), to stay token-compact. */
const MAX_RELIEVERS = 8;

export interface BullpenReliever {
  name: string;
  role: 'closer' | 'setup' | 'middle';
  appearances: number;
  saves: number;
  saveOpps: number;
  holds: number;
  blownSaves: number;
  gamesFinished: number;
}

export interface BullpenRolesResult {
  team: string;
  matched: boolean;
  /** Trailing window the usage is measured over (e.g. "last30"). */
  window: string;
  /** Set when saves look shared (committee) or no clear closer emerged. */
  note?: string;
  relievers: BullpenReliever[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`MLB request failed: ${res.status}`);
  return (await res.json()) as T;
}

/** Resolve an MLB team abbreviation to its numeric teamId for the season. */
async function resolveTeamId(teamAbbr: string, season: number): Promise<number | undefined> {
  const want = normalizeTeamAbbr(teamAbbr);
  const raw = await fetchJson<{ teams?: { id?: number; abbreviation?: string }[] }>(
    `${TEAMS_URL}?sportId=1&season=${season}&fields=teams,id,abbreviation`,
  );
  for (const t of raw.teams ?? []) {
    if (typeof t.id === 'number' && typeof t.abbreviation === 'string') {
      if (normalizeTeamAbbr(t.abbreviation) === want) return t.id;
    }
  }
  return undefined;
}

interface RawRosterEntry {
  person?: { id?: number; fullName?: string };
  position?: { type?: string };
}

/** Fetch a team's active-roster pitchers as [{ id, name }]. */
async function fetchTeamPitchers(teamId: number): Promise<{ id: number; name: string }[]> {
  const raw = await fetchJson<{ roster?: RawRosterEntry[] }>(
    `${ROSTER_URL}/${teamId}/roster?rosterType=active`,
  );
  const pitchers: { id: number; name: string }[] = [];
  for (const entry of raw.roster ?? []) {
    if (entry.position?.type !== 'Pitcher') continue;
    const id = entry.person?.id;
    const name = entry.person?.fullName;
    if (typeof id === 'number' && typeof name === 'string') pitchers.push({ id, name });
  }
  return pitchers;
}

/** Raw recent-usage counts for one pitcher, aggregated over the window. */
interface Usage {
  name: string;
  appearances: number;
  gamesStarted: number;
  saves: number;
  saveOpps: number;
  holds: number;
  blownSaves: number;
  gamesFinished: number;
}

/**
 * Rank relievers into closer / setup / middle from their recent usage. Pure and exported
 * for unit testing. The closer is whoever leads in saves (then games finished); the setup
 * man leads the rest in holds. Sets a committee note when the save load looks shared.
 */
export function assignBullpenRoles(
  usages: Usage[],
  team: string,
  window: string,
): BullpenRolesResult {
  // Relievers only: drop anyone used primarily as a starter in the window.
  const relievers = usages.filter(
    (u) => u.gamesStarted < u.appearances || u.saves + u.holds + u.gamesFinished > 0,
  );
  if (relievers.length === 0) {
    return { team, matched: true, window, relievers: [] };
  }

  const closerScore = (u: Usage) => [u.saves, u.gamesFinished, u.saveOpps];
  const sortByScore = (list: Usage[]) =>
    [...list].sort((a, b) => {
      const sa = closerScore(a);
      const sb = closerScore(b);
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i]! - sa[i]!;
      return b.appearances - a.appearances;
    });

  const byCloser = sortByScore(relievers);
  const closer = byCloser[0]!;
  const hasCloser = closer.saves > 0 || closer.gamesFinished > 0;

  const roleByName = new Map<string, BullpenReliever['role']>();
  if (hasCloser) roleByName.set(closer.name, 'closer');

  // Setup: most holds among the non-closers (needs at least one hold to earn the label).
  const rest = relievers.filter((u) => roleByName.get(u.name) !== 'closer');
  const setup = [...rest].sort((a, b) => b.holds - a.holds || b.appearances - a.appearances)[0];
  if (setup && setup.holds > 0) roleByName.set(setup.name, 'setup');

  const ranked = sortByScore(relievers)
    .map((u) => ({
      name: u.name,
      role: roleByName.get(u.name) ?? 'middle',
      appearances: u.appearances,
      saves: u.saves,
      saveOpps: u.saveOpps,
      holds: u.holds,
      blownSaves: u.blownSaves,
      gamesFinished: u.gamesFinished,
    }))
    .sort((a, b) => {
      const order = { closer: 0, setup: 1, middle: 2 } as const;
      return order[a.role] - order[b.role] || b.saves - a.saves || b.holds - a.holds;
    })
    .slice(0, MAX_RELIEVERS);

  // Committee flag: a second arm with a comparable, non-trivial save load.
  const runnerUp = byCloser[1];
  const note = !hasCloser
    ? 'No clear closer from recent usage (committee or unsettled).'
    : runnerUp && runnerUp.saves >= 2 && runnerUp.saves >= closer.saves - 1
      ? `Saves look shared: ${closer.name} and ${runnerUp.name} (possible committee).`
      : undefined;

  return { team, matched: true, window, relievers: ranked, ...(note ? { note } : {}) };
}

/**
 * Recent bullpen save-role hierarchy for an MLB team. Resolves the team, pulls its active
 * pitchers, aggregates their last-30-day relief usage from game logs, and ranks roles.
 * Returns `{ matched: false }` when the team can't be resolved (never a guess).
 */
export async function getBullpenRoles(
  teamAbbr: string,
  opts: { season?: number } = {},
): Promise<BullpenRolesResult> {
  const season = opts.season ?? new Date().getUTCFullYear();
  const team = normalizeTeamAbbr(teamAbbr);
  const teamId = await resolveTeamId(teamAbbr, season);
  if (teamId === undefined) return { team, matched: false, window: 'last30', relievers: [] };

  const pitchers = await fetchTeamPitchers(teamId);
  const logs = await fetchGameLogs(
    pitchers.map((p) => p.id),
    'pitching',
    season,
  );
  const window = windowBounds('last30');

  const usages: Usage[] = pitchers.map((p) => {
    const agg = aggregateSplits(logs.get(p.id) ?? [], 'pitching', window);
    const get = (k: string) => agg.totals.get(k) ?? 0;
    return {
      name: p.name,
      appearances: get('gamesPlayed'),
      gamesStarted: get('gamesStarted'),
      saves: get('saves'),
      saveOpps: get('saveOpportunities'),
      holds: get('holds'),
      blownSaves: get('blownSaves'),
      gamesFinished: get('gamesFinished'),
    };
  });

  return assignBullpenRoles(usages, team, 'last30');
}
