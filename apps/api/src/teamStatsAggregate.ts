import type { StatColumn, StatValue, TeamStatWindow } from '@fcm/contracts';

/**
 * How many trailing fantasy weeks each multi-week helper window rolls up. These are
 * the "Last N weeks" badges on the Team Stats page; the aggregation happens here
 * (server-side) so the client just picks a window.
 */
export const TEAM_STAT_WINDOW_SIZE: Record<TeamStatWindow, number> = {
  last2weeks: 2,
  last3weeks: 3,
  last4weeks: 4,
};

/** The most-recent `size` weeks from an ascending week list (fewer if not enough exist). */
export function resolveWindowWeeks(weeks: number[], size: number): number[] {
  return size <= 0 ? [] : weeks.slice(-size);
}

/** Fractional digit count of a numeric string ("3.38" -> 2, ".278" -> 3, "736" -> 0). */
function fractionalDigits(value: string): number {
  const dot = value.indexOf('.');
  return dot < 0 ? 0 : value.length - dot - 1;
}

/** True when a value is a Yahoo ratio like "1234/4567" (e.g. the H/AB display stat). */
function isRatio(value: string): boolean {
  return /^\d+\/\d+$/.test(value.trim());
}

/** True when a column is innings pitched, whose fractions are thirds (.1 = 1/3), not decimals. */
function isInningsColumn(column: StatColumn): boolean {
  return column.key === '50' || column.label.toUpperCase() === 'IP';
}

/** Sum ratio strings component-wise: ["1/4", "2/5"] -> "3/9" (used for H/AB). */
function sumRatios(values: string[]): string {
  let num = 0;
  let den = 0;
  for (const v of values) {
    const [a, b] = v.trim().split('/');
    num += Number(a);
    den += Number(b);
  }
  return `${num}/${den}`;
}

/** Sum innings expressed in baseball thirds (".1" = 1/3, ".2" = 2/3), not as decimals. */
function sumInnings(values: string[]): string {
  let outs = 0;
  for (const v of values) {
    const [whole, frac = '0'] = v.trim().split('.');
    outs += Number(whole) * 3 + Number(frac[0] ?? '0');
  }
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

/** Format an aggregated number, preserving the source's decimals and leading-dot style. */
function formatNumber(value: number, decimals: number, leadingDot: boolean): string {
  const fixed = value.toFixed(decimals);
  return leadingDot ? fixed.replace(/^(-?)0\./, '$1.') : fixed;
}

/** Combine one column's weekly values by the rule appropriate to its stat type. */
function combineColumn(column: StatColumn, raws: (string | number)[]): StatValue['value'] {
  if (raws.length === 0) return '-';
  const strings = raws.map(String);

  // H/AB-style ratios: sum numerators and denominators.
  if (strings.every(isRatio)) return sumRatios(strings);
  // Innings pitched: sum in thirds so ".1"/".2" carry correctly.
  if (isInningsColumn(column)) return sumInnings(strings);

  const nums: number[] = [];
  let decimals = 0;
  let leadingDot = false;
  for (const s of strings) {
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    nums.push(n);
    decimals = Math.max(decimals, fractionalDigits(s));
    if (/^-?\.\d/.test(s)) leadingDot = true;
  }
  if (nums.length === 0) return '-';

  const total = nums.reduce((sum, n) => sum + n, 0);
  // Counting stats (aggregatable) sum; rate stats (AVG/ERA/WHIP/OPS) average - in a
  // weekly league each week is a score the team put up, so the mean is the roll-up.
  const combined = column.aggregatable ? total : total / nums.length;
  return formatNumber(combined, decimals, leadingDot);
}

/**
 * Roll up a team's per-week stat lines onto `columns`. Counting stats are summed and
 * rate stats are averaged (see combineColumn); ratio and innings stats get their own
 * correct treatment. Missing weekly values ("-") are ignored, and a stat absent every
 * week stays "-". Each `weekly` entry is a full stat line aligned to `columns` by key.
 */
export function aggregateWeeklyTeamStats(
  weekly: StatValue[][],
  columns: StatColumn[],
): StatValue[] {
  return columns.map((col) => {
    const raws: (string | number)[] = [];
    for (const line of weekly) {
      const found = line.find((s) => s.key === col.key);
      if (found && found.value !== '-') raws.push(found.value);
    }
    return { key: col.key, value: combineColumn(col, raws) };
  });
}
