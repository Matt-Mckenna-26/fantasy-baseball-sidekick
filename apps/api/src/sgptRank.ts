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

/** Whether a column's percentile must invert (lower value = better), by explicit flag then label. */
function columnInverts(col: StatColumn, isPitching: boolean): boolean {
  if (typeof col.higherIsBetter === 'boolean') return !col.higherIsBetter;
  const key = col.label.trim().toUpperCase();
  return isPitching ? PITCHING_LOWER_IS_BETTER.has(key) : BATTING_LOWER_IS_BETTER.has(key);
}

/**
 * Scoring categories only: drop H/AB (a raw display column, not a scored category), matching
 * the client's scoringColumns() so the score covers the same categories shown in the grid.
 */
function scoringColumns(columns: StatColumn[]): StatColumn[] {
  return columns.filter((c) => c.label.trim().toUpperCase() !== 'H/AB');
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
    const values: number[] = [];
    for (const line of lines) {
      const v = toNumber(line.stats.find((s) => s.key === col.key)?.value);
      if (v !== null) values.push(v);
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
): number | null {
  let sum = 0;
  let count = 0;
  for (const col of columns) {
    const fn = percentiles.get(col.key);
    if (!fn) continue;
    const v = toNumber(line.stats.find((s) => s.key === col.key)?.value);
    if (v === null) continue;
    sum += fn(v);
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

/** Per-player mean percentile for one table, scored against that table's own pool. */
function scoreTable(table: StatTable, isPitching: boolean): Map<PlayerStatLine, number> {
  const columns = scoringColumns(table.columns);
  const percentiles = buildPercentiles(table.players, columns, isPitching);
  const byLine = new Map<PlayerStatLine, number>();
  for (const line of table.players) {
    const mean = meanPercentile(line, columns, percentiles);
    if (mean !== null) byLine.set(line, mean);
  }
  return byLine;
}

/** Index a table's mean percentiles so the pool average scores 100 (OPS+/wRC+ convention). */
function indexTable(byLine: Map<PlayerStatLine, number>): Map<PlayerStatLine, number> {
  const means = [...byLine.values()];
  const poolMean = means.length > 0 ? means.reduce((a, b) => a + b, 0) / means.length : 0;
  const indexed = new Map<PlayerStatLine, number>();
  if (poolMean <= 0) return indexed;
  for (const [line, mean] of byLine) indexed.set(line, Math.round((100 * mean) / poolMean));
  return indexed;
}

/**
 * Attach Value+ scores to every rostered player: sgptPlus (value index, 100 = league
 * average) computed within each position pool, and sgptRank (1-based) across BOTH hitters and
 * pitchers combined. Pure: returns a new response, leaving the input untouched. Players with no
 * scored categories keep neither field.
 */
export function withSgptRank(res: PlayerStatsResponse): PlayerStatsResponse {
  const battingPlus = indexTable(scoreTable(res.batting, false));
  const pitchingPlus = indexTable(scoreTable(res.pitching, true));

  // Combined rank spans both pools; competition ranking so equal scores share a rank.
  const allScores = [...battingPlus.values(), ...pitchingPlus.values()].sort((a, b) => b - a);
  const rankOf = (plus: number): number => upperBoundDesc(allScores, plus) + 1;

  const apply = (table: StatTable, plusByLine: Map<PlayerStatLine, number>): StatTable => ({
    columns: table.columns,
    players: table.players.map((line) => {
      const plus = plusByLine.get(line);
      if (plus === undefined) return line;
      return { ...line, sgptPlus: plus, sgptRank: rankOf(plus) };
    }),
  });

  return {
    leagueId: res.leagueId,
    batting: apply(res.batting, battingPlus),
    pitching: apply(res.pitching, pitchingPlus),
  };
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
