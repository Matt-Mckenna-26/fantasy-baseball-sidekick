import type { StatColumn } from '@fcm/contracts';

/**
 * Stat labels where a LOWER value is better, so the heat-map hue must invert
 * (a low ERA should read "hot"). This is a client-side heuristic keyed off the
 * league's display labels and split by player type, because Yahoo's per-category
 * sort order is not carried through the stats contract. Kept intentionally small
 * and conservative; promote to a contract field if exact per-league direction is
 * ever required (see plan).
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

/** True when a lower value is better for this stat (e.g. ERA, WHIP), split by player type. */
export function isLowerBetter(label: string, isPitching: boolean): boolean {
  const key = label.trim().toUpperCase();
  return isPitching ? PITCHING_LOWER_IS_BETTER.has(key) : BATTING_LOWER_IS_BETTER.has(key);
}

/** First index whose value is >= target (count of values strictly less than target). */
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

/** First index whose value is > target (count of values <= target). */
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

/**
 * Build a per-column percentile lookup over the current player pool. For each stat
 * column, returns a function mapping a raw value to its mid-rank percentile in
 * [0, 1] among all players that have a numeric value for that column. Lower-is-better
 * categories are inverted so the hot end of the scale always means "better".
 */
export function buildStatPercentiles(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<StatColumn>,
  isPitching: boolean,
): Map<string, (value: number) => number> {
  const lookup = new Map<string, (value: number) => number>();
  for (const col of columns) {
    const values: number[] = [];
    for (const row of rows) {
      const v = row[col.key];
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) continue;
    values.sort((a, b) => a - b);
    const n = values.length;
    const invert = isLowerBetter(col.label, isPitching);
    lookup.set(col.key, (value: number) => {
      // Mid-rank percentile: (strictlyLess + 0.5 * equal) / n.
      const p = (lowerBound(values, value) + upperBound(values, value)) / 2 / n;
      return invert ? 1 - p : p;
    });
  }
  return lookup;
}

/**
 * Build a per-column rank lookup over the current player pool. For each stat column,
 * returns a function mapping a raw value to its 1-based competition rank (1 = best) and
 * the pool size, among all players that have a numeric value for that column. Lower-is-
 * better categories rank ascending so "1st" always means the best value.
 */
export function buildStatRanks(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<StatColumn>,
  isPitching: boolean,
): Map<string, (value: number) => { rank: number; total: number }> {
  const lookup = new Map<string, (value: number) => { rank: number; total: number }>();
  for (const col of columns) {
    const values: number[] = [];
    for (const row of rows) {
      const v = row[col.key];
      if (typeof v === 'number' && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) continue;
    values.sort((a, b) => a - b);
    const n = values.length;
    const invert = isLowerBetter(col.label, isPitching);
    lookup.set(col.key, (value: number) => {
      // Count players strictly better, so ties share a rank (competition ranking).
      const better = invert ? lowerBound(values, value) : n - upperBound(values, value);
      return { rank: better + 1, total: n };
    });
  }
  return lookup;
}
