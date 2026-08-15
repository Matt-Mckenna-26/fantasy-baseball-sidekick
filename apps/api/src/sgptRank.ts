import type { PlayerStatLine, PlayerStatsResponse, StatColumn, StatTable } from '@fcm/contracts';

/**
 * Value+ is a single composite value per player: the average of that
 * player's direction-corrected percentiles across the league's scoring categories, indexed
 * so 100 = league average (like OPS+/wRC+). Because percentiles are already normalized, a
 * hitter's average percentile is directly comparable to a pitcher's - which is what lets us
 * rank hitters and pitchers on one scale (sgptRank).
 *
 * Computed server-side over the rostered pool so the UI and the AI co-manager consume the
 * exact same number. This mirrors the client heat-map percentile math in
 * apps/web/src/lib/percentile.ts; the direction sets below are intentionally duplicated
 * because the web bundle can't import from the api package (keep the two in sync).
 *
 * Innings pitched (IP) is deliberately NOT a scored category here - it is pure volume, so
 * scoring it buries relievers. Instead IP gates who qualifies for a Value+ (see
 * qualifiedPitchers). The client grid still shows/colors IP; only Value+ ignores it.
 *
 * Role-exclusive counting categories (Saves/Holds/Blown Saves for relievers, Quality
 * Starts/CG/SHO for starters) are scored only among the pitchers who actually accrue them, and
 * skipped for the rest - so a reliever isn't punished on Quality Starts, nor a starter on Saves
 * (see ROLE_EXCLUSIVE). Shared skills (ERA, WHIP, K, Wins) still compare across all pitchers.
 */

const PITCHING_LOWER_IS_BETTER = new Set([
  'ERA',
  'WHIP',
  'BB',
  'L',
  'ER',
  'H',
  'R',
  'HR',
  'HRA',
  'BS',
  'HBP',
  'WP',
  'BAA',
  'OBA',
  'AVG',
]);

const BATTING_LOWER_IS_BETTER = new Set(['K', 'SO', 'GIDP', 'CS', 'E']);

/** Innings pitched: never scored (it's volume, not skill), only used to gate who qualifies. */
const IP_LABEL = 'IP';

/**
 * Role-exclusive counting categories: ones only a starter (QS/CG/SHO) or only a reliever
 * (SV/HLD/BS) realistically accrues. A pitcher with 0 here is "not applicable" to that role,
 * not a bottom-of-the-pool result - so scoring it across the whole staff punishes relievers on
 * Quality Starts and starters on Saves. We instead percentile each of these ONLY among pitchers
 * who actually accrue it (value > 0) and skip it for everyone else (see buildPercentiles /
 * meanPercentile). Shared skills (ERA, WHIP, K, and Wins) are still compared across all pitchers.
 */
const ROLE_EXCLUSIVE = new Set(['SV', 'HLD', 'HD', 'BS', 'QS', 'CG', 'SHO']);

function isRoleExclusive(col: StatColumn, isPitching: boolean): boolean {
  return isPitching && ROLE_EXCLUSIVE.has(col.label.trim().toUpperCase());
}

/**
 * A pitcher must throw at least this fraction of the pool's busiest arm's innings to earn a
 * Value+. Once IP no longer scores, a 2-inning 0.00 ERA would otherwise look elite; this gate
 * requires a real sample without excluding genuine relievers (a closer's ~45 IP clears ~20% of
 * a 160-IP workhorse). Scales automatically with the window (season vs last30/last7).
 */
const MIN_IP_QUALIFY_FRACTION = 0.2;

/** Whether a column's percentile must invert (lower value = better), by explicit flag then label. */
function columnInverts(col: StatColumn, isPitching: boolean): boolean {
  if (typeof col.higherIsBetter === 'boolean') return !col.higherIsBetter;
  const key = col.label.trim().toUpperCase();
  return isPitching ? PITCHING_LOWER_IS_BETTER.has(key) : BATTING_LOWER_IS_BETTER.has(key);
}

/**
 * Scoring categories only. Drop H/AB (a raw display column) and IP: innings are volume, not a
 * skill category, and scoring them punishes relievers for low usage. IP instead acts as a
 * qualification gate (see qualifiedPitchers). The client heat-map still colors IP; only Value+
 * ignores it.
 */
function scoringColumns(columns: StatColumn[]): StatColumn[] {
  return columns.filter((c) => {
    const key = c.label.trim().toUpperCase();
    return key !== 'H/AB' && key !== IP_LABEL;
  });
}

/** The IP value for a line (null when the league doesn't track IP or the cell is blank). */
function inningsOf(line: PlayerStatLine, ipCol: StatColumn | undefined): number | null {
  if (!ipCol) return null;
  return toNumber(line.stats.find((s) => s.key === ipCol.key)?.value);
}

/**
 * Pitchers with enough innings to be ranked. The threshold is MIN_IP_QUALIFY_FRACTION of the
 * pool's busiest arm, so it adapts to the window and only filters out tiny samples. Leagues
 * that don't track IP skip the gate entirely (every pitcher qualifies).
 */
function qualifiedPitchers(table: StatTable): PlayerStatLine[] {
  const ipCol = table.columns.find((c) => c.label.trim().toUpperCase() === IP_LABEL);
  if (!ipCol) return table.players;
  let topIp = 0;
  for (const line of table.players) {
    const ip = inningsOf(line, ipCol);
    if (ip !== null && ip > topIp) topIp = ip;
  }
  if (topIp <= 0) return table.players;
  const minIp = topIp * MIN_IP_QUALIFY_FRACTION;
  return table.players.filter((line) => {
    const ip = inningsOf(line, ipCol);
    return ip !== null && ip >= minIp;
  });
}

/** Parse a stat value to a finite number, or null when unavailable ("-" / blank / NaN). */
function toNumber(value: number | string | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value === '-' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function lowerBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Build a per-column mid-rank percentile lookup (in [0,1], direction-corrected) over the pool. */
function buildPercentiles(
  lines: PlayerStatLine[],
  columns: StatColumn[],
  isPitching: boolean,
): Map<string, (value: number) => number> {
  const lookup = new Map<string, (value: number) => number>();
  for (const col of columns) {
    // Role-exclusive cats are scored only among the pitchers who actually accrue them, so a
    // reliever's 0 Quality Starts (or a starter's 0 Saves) never lands in the pool as a floor.
    const roleCat = isRoleExclusive(col, isPitching);
    const values: number[] = [];
    for (const line of lines) {
      const v = toNumber(line.stats.find((s) => s.key === col.key)?.value);
      if (v === null) continue;
      if (roleCat && v <= 0) continue;
      values.push(v);
    }
    if (values.length === 0) continue;
    values.sort((a, b) => a - b);
    const n = values.length;
    const invert = columnInverts(col, isPitching);
    lookup.set(col.key, (value: number) => {
      const p = (lowerBound(values, value) + upperBound(values, value)) / 2 / n;
      return invert ? 1 - p : p;
    });
  }
  return lookup;
}

/** A player's mean percentile across the categories they have a value for (null when none). */
function meanPercentile(
  line: PlayerStatLine,
  columns: StatColumn[],
  percentiles: Map<string, (value: number) => number>,
  isPitching: boolean,
): number | null {
  let sum = 0;
  let count = 0;
  for (const col of columns) {
    const fn = percentiles.get(col.key);
    if (!fn) continue;
    const v = toNumber(line.stats.find((s) => s.key === col.key)?.value);
    if (v === null) continue;
    // A role-exclusive cat the pitcher doesn't accrue (0) is not applicable to their role, so
    // it's skipped rather than counted as a bottom percentile.
    if (isRoleExclusive(col, isPitching) && v <= 0) continue;
    sum += fn(v);
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

/**
 * A group's (batting or pitching) scoring model: the direction-corrected percentile lookups and
 * the pool's mean percentile, both derived from a reference pool. `plusOf` turns any line's raw
 * stats into a Value+ index against this pool, so the same model can score its own pool OR an
 * external set (free agents) on the exact same scale.
 */
interface GroupModel {
  columns: StatColumn[];
  percentiles: Map<string, (value: number) => number>;
  poolMean: number;
  isPitching: boolean;
}

function buildGroupModel(
  pool: PlayerStatLine[],
  columns: StatColumn[],
  isPitching: boolean,
): GroupModel {
  const scoreCols = scoringColumns(columns);
  const percentiles = buildPercentiles(pool, scoreCols, isPitching);
  const means: number[] = [];
  for (const line of pool) {
    const mean = meanPercentile(line, scoreCols, percentiles, isPitching);
    if (mean !== null) means.push(mean);
  }
  const poolMean = means.length > 0 ? means.reduce((a, b) => a + b, 0) / means.length : 0;
  return { columns: scoreCols, percentiles, poolMean, isPitching };
}

/** Value+ index for a line against a group model (null when the pool or line has no signal). */
function plusOf(line: PlayerStatLine, model: GroupModel): number | null {
  if (model.poolMean <= 0) return null;
  const mean = meanPercentile(line, model.columns, model.percentiles, model.isPitching);
  if (mean === null) return null;
  return Math.round((100 * mean) / model.poolMean);
}

/** The minimum-innings gate derived from a reference pool's busiest arm (see qualifiedPitchers). */
function pitcherGate(table: StatTable): { ipKey?: string; minIp: number } {
  const ipCol = table.columns.find((c) => c.label.trim().toUpperCase() === IP_LABEL);
  if (!ipCol) return { minIp: 0 };
  let topIp = 0;
  for (const line of table.players) {
    const ip = inningsOf(line, ipCol);
    if (ip !== null && ip > topIp) topIp = ip;
  }
  return { ipKey: ipCol.key, minIp: topIp > 0 ? topIp * MIN_IP_QUALIFY_FRACTION : 0 };
}

/** Whether a pitching line clears the reference pool's minimum-innings gate. */
function passesGate(line: PlayerStatLine, gate: { ipKey?: string; minIp: number }): boolean {
  if (!gate.ipKey || gate.minIp <= 0) return true;
  const ip = toNumber(line.stats.find((s) => s.key === gate.ipKey)?.value);
  return ip !== null && ip >= gate.minIp;
}

/**
 * A Value+ scoring model built from a reference (rostered) pool. `scoreExternal` attaches
 * sgptPlus/sgptRank to any set of lines - the same pool it was built from, or free agents -
 * indexing and ranking them against that reference so the numbers stay directly comparable.
 */
export interface SgptModel {
  scoreExternal(res: PlayerStatsResponse): PlayerStatsResponse;
}

/**
 * Build a Value+ model from a reference pool: per-group percentile lookups + pool means, the
 * pitching minimum-innings gate, and the combined reference score list used for the 1-based rank
 * across BOTH hitters and pitchers. Pure; the returned scorer never mutates its input.
 */
export function buildSgptModel(rostered: PlayerStatsResponse): SgptModel {
  const batting = buildGroupModel(rostered.batting.players, rostered.batting.columns, false);
  const qualified = qualifiedPitchers(rostered.pitching);
  const pitching = buildGroupModel(qualified, rostered.pitching.columns, true);
  const gate = pitcherGate(rostered.pitching);

  // Reference scores (same numbers rostered players show) drive the shared hitter+pitcher rank.
  const refScores: number[] = [];
  for (const line of rostered.batting.players) {
    const plus = plusOf(line, batting);
    if (plus !== null) refScores.push(plus);
  }
  for (const line of qualified) {
    const plus = plusOf(line, pitching);
    if (plus !== null) refScores.push(plus);
  }
  refScores.sort((a, b) => b - a);
  const rankOf = (plus: number): number => upperBoundDesc(refScores, plus) + 1;

  const scoreGroup = (table: StatTable, model: GroupModel, gated: boolean): StatTable => ({
    columns: table.columns,
    players: table.players.map((line) => {
      // Only qualified pitchers are scored; the rest keep no Value+ (shown as "-" and unranked).
      if (gated && !passesGate(line, gate)) return line;
      const plus = plusOf(line, model);
      if (plus === null) return line;
      return { ...line, sgptPlus: plus, sgptRank: rankOf(plus) };
    }),
  });

  return {
    scoreExternal: (res) => ({
      leagueId: res.leagueId,
      batting: scoreGroup(res.batting, batting, false),
      pitching: scoreGroup(res.pitching, pitching, true),
    }),
  };
}

/**
 * Attach Value+ scores to every rostered player: sgptPlus (value index, 100 = league
 * average) computed within each position pool, and sgptRank (1-based) across BOTH hitters and
 * pitchers combined. Pure: returns a new response, leaving the input untouched. Players with no
 * scored categories keep neither field. Equivalent to scoring the rostered pool against itself.
 */
export function withSgptRank(res: PlayerStatsResponse): PlayerStatsResponse {
  return buildSgptModel(res).scoreExternal(res);
}

/** Count of scores strictly greater than target in a descending-sorted array. */
function upperBoundDesc(sortedDesc: number[], target: number): number {
  let lo = 0;
  let hi = sortedDesc.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedDesc[mid]! > target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
