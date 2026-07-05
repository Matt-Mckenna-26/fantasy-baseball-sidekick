import type { LeagueTeamStatsResponse, StatColumn, StatValue, TeamStatLine } from '@fcm/contracts';
import { buildStatPercentiles } from './percentile';

/** Whether a tile celebrates the best (hot) or flags the worst (cold) team in a category. */
export type StatLeaderTone = 'hot' | 'cold';

/** The best- or worst-performing team in one scoring category for the loaded window. */
export type StatLeaderTile = {
  tone: StatLeaderTone;
  statKey: string;
  statLabel: string;
  statDescription?: string;
  teamId: string;
  teamName: string;
  logoUrl?: string;
  /** Raw display value exactly as Yahoo reports it (e.g. ".312", "48", "2.91"). */
  value: string;
};

/** Categories that make poor "leader" tiles (volume/roster artifacts, not performance). */
const EXCLUDED_KEYS = new Set(['IP']);

function isExcluded(col: StatColumn): boolean {
  return EXCLUDED_KEYS.has(col.key.trim().toUpperCase());
}

/** Parse a Yahoo stat value to a sortable number, or null when unavailable. */
function toNumeric(value: StatValue['value'] | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value === '-' || value.trim() === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

/** Fisher-Yates shuffle into a new array (rng defaults to Math.random). */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The best- (hot) or worst- (cold) percentile team for a column, or null if none
 * has data. Percentiles already invert lower-is-better categories, so "hot" is
 * always the strongest performer and "cold" the weakest regardless of direction.
 */
function extremeForColumn(
  col: StatColumn,
  tone: StatLeaderTone,
  teams: readonly TeamStatLine[],
  percentileFor: (value: number) => number,
): StatLeaderTile | null {
  let best: { team: TeamStatLine; pct: number; raw: StatValue['value'] } | null = null;
  for (const team of teams) {
    const raw = team.stats.find((s) => s.key === col.key)?.value;
    const numeric = toNumeric(raw);
    if (numeric == null || raw === undefined) continue;
    const pct = percentileFor(numeric);
    // Deterministic tie-break on team id so equal extremes resolve stably.
    const wins =
      best == null ||
      (tone === 'hot' ? pct > best.pct : pct < best.pct) ||
      (pct === best.pct && team.teamId < best.team.teamId);
    if (wins) best = { team, pct, raw };
  }
  if (!best) return null;
  return {
    tone,
    statKey: col.key,
    statLabel: col.label,
    ...(col.description ? { statDescription: col.description } : {}),
    teamId: best.team.teamId,
    teamName: best.team.teamName,
    ...(best.team.logoUrl ? { logoUrl: best.team.logoUrl } : {}),
    value: String(best.raw),
  };
}

/**
 * Pick random scoring categories and, for each, either the league's best (hot) or
 * worst (cold) team - `perTone` of each, evenly split. Categories are distinct
 * across tiles and need at least two teams with comparable numeric data (so hot
 * and cold are meaningful). `IP` and other volume artifacts are never chosen, and
 * lower-is-better categories resolve correctly via the shared percentile logic.
 * May return fewer than `2 * perTone` tiles when the league lacks enough data.
 */
export function pickWeekStatLeaders(
  data: LeagueTeamStatsResponse,
  perTone: number,
  rng: () => number = Math.random,
): StatLeaderTile[] {
  const rows = data.teams.map((team) => {
    const row: Record<string, number | null> = {};
    for (const s of team.stats) row[s.key] = toNumeric(s.value);
    return row;
  });

  // Batting and pitching invert differently, so build each pool separately and merge.
  const percentiles = new Map<string, (value: number) => number>([
    ...buildStatPercentiles(rows, data.battingColumns, false),
    ...buildStatPercentiles(rows, data.pitchingColumns, true),
  ]);

  const numericCount = (key: string) =>
    rows.reduce((n, row) => (typeof row[key] === 'number' ? n + 1 : n), 0);

  const seen = new Set<string>();
  const candidates: StatColumn[] = [];
  for (const col of [...data.battingColumns, ...data.pitchingColumns]) {
    if (seen.has(col.key) || isExcluded(col) || !percentiles.has(col.key)) continue;
    if (numericCount(col.key) < 2) continue;
    seen.add(col.key);
    candidates.push(col);
  }

  // Alternate hot/cold across distinct shuffled categories so the split stays even.
  const tiles: StatLeaderTile[] = [];
  let hot = 0;
  let cold = 0;
  for (const col of shuffled(candidates, rng)) {
    if (hot >= perTone && cold >= perTone) break;
    const tone: StatLeaderTone = hot <= cold && hot < perTone ? 'hot' : 'cold';
    const tile = extremeForColumn(col, tone, data.teams, percentiles.get(col.key)!);
    if (!tile) continue;
    tiles.push(tile);
    if (tone === 'hot') hot += 1;
    else cold += 1;
  }
  return tiles;
}
