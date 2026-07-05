import type { CustomCellRendererProps } from 'ag-grid-react';
import styles from '../pages/StatsPage.module.css';

/** Context the Stats grid supplies to every heat cell. */
export type StatCellContext = {
  /** statKey -> value's percentile in [0, 1] among the current player pool. */
  percentiles: Map<string, (value: number) => number>;
  /** True while a range refetch is in flight (drives the "…" placeholder). */
  statsLoading: boolean;
  /**
   * Optional clause appended to the percentile tooltip to spell out the ranking
   * pool (e.g. "among this matchup"). Grids ranking against the whole league omit it.
   */
  scopeSuffix?: string;
};

const COLD_BLUE = [37, 99, 235] as const;
const NEUTRAL_SLATE = [100, 116, 139] as const;
const HOT_RED = [239, 68, 68] as const;

/**
 * Diverging heat color for a percentile in [0, 1]:
 * 0 -> deep cold blue, 0.5 -> near-transparent neutral slate (blends with the
 * panel), 1 -> hot red. Alpha is lowest at the midpoint so the "average" state
 * reads as a disabled/neutral cell while extremes are saturated.
 */
export function heatColor(p: number): string {
  const clamped = Math.min(1, Math.max(0, p));
  if (clamped <= 0.5) {
    const t = clamped / 0.5; // 0 at blue end, 1 at neutral
    const alpha = 0.55 - 0.43 * t;
    const rgb = COLD_BLUE.map((c, i) => Math.round(NEUTRAL_SLATE[i]! + (c - NEUTRAL_SLATE[i]!) * (1 - t)));
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`;
  }
  const t = (clamped - 0.5) / 0.5; // 0 at neutral, 1 at red end
  const alpha = 0.12 + 0.43 * t;
  const rgb = HOT_RED.map((c, i) => Math.round(NEUTRAL_SLATE[i]! + (c - NEUTRAL_SLATE[i]!) * t));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha.toFixed(2)})`;
}

/**
 * Stat cell renderer that paints the whole cell with a percentile hue. Cells with
 * no numeric value render plain (a muted "-" or "…" while loading), so only real
 * values get colored. Text stays readable via a light foreground + shadow.
 */
export function PercentileHeatCell(params: CustomCellRendererProps) {
  const key = params.colDef?.field;
  const ctx = params.context as StatCellContext | undefined;
  const data = params.data as Record<string, unknown> | undefined;
  const display = key && data ? (data[`${key}__d`] as string | undefined) : undefined;
  const numeric = params.value as number | null | undefined;

  if (numeric == null || display == null || display === '-') {
    return <span className={styles.heatEmpty}>{ctx?.statsLoading ? '…' : '-'}</span>;
  }

  const percentileFor = key ? ctx?.percentiles.get(key) : undefined;
  const percentile = percentileFor ? percentileFor(numeric) : null;
  const style = percentile == null ? undefined : { backgroundColor: heatColor(percentile) };
  const title =
    percentile == null
      ? undefined
      : `${Math.round(percentile * 100)}th percentile${ctx?.scopeSuffix ? ` ${ctx.scopeSuffix}` : ''}`;

  return (
    <span className={styles.heatCell} style={style} title={title}>
      {display}
    </span>
  );
}
