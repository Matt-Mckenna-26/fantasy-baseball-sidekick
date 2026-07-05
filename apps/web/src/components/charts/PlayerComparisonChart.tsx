import { memo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { PlayerStatLine } from '@fcm/contracts';
import { toNumericValue } from '../../lib/teamTrend';
import { CHART_COLORS, CHART_THEME } from './palette';
import styles from './charts.module.css';

interface ComparisonRow {
  playerId: string;
  name: string;
  value: number;
}

/**
 * Horizontal bar chart comparing the selected players' values for one metric in the
 * currently loaded range. Sorted best-first (ascending for lower-is-better stats like
 * ERA). Mirrors TeamComparisonChart but with players as the series.
 */
export const PlayerComparisonChart = memo(function PlayerComparisonChart({
  players,
  metricKey,
  metricLabel,
  lowerIsBetter,
  colorMap,
}: {
  players: PlayerStatLine[];
  metricKey: string;
  metricLabel: string;
  lowerIsBetter: boolean;
  colorMap: Map<string, string>;
}) {
  const rows: ComparisonRow[] = players
    .map((p) => {
      const found = p.stats.find((s) => s.key === metricKey);
      return {
        playerId: p.player.playerId,
        name: p.player.fullName,
        value: toNumericValue(found?.value),
      };
    })
    .filter((r): r is ComparisonRow => r.value !== null);

  rows.sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));

  if (rows.length === 0) {
    return <p className={styles.empty}>No {metricLabel} values to compare for these players.</p>;
  }

  const height = Math.max(220, rows.length * 40 + 48);

  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 28, bottom: 8, left: 8 }}>
          <XAxis
            type="number"
            tick={{ fill: CHART_THEME.muted, fontSize: 12 }}
            axisLine={{ stroke: CHART_THEME.border }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tick={{ fill: CHART_THEME.text, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
            content={(props) => <ComparisonTooltip {...props} metricLabel={metricLabel} />}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive>
            {rows.map((r) => (
              <Cell key={r.playerId} fill={colorMap.get(r.playerId) ?? CHART_COLORS[0]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

function ComparisonTooltip({
  active,
  payload,
  metricLabel,
}: TooltipContentProps & { metricLabel: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ComparisonRow | undefined;
  if (!row) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTitle}>{row.name}</p>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipName}>{metricLabel}</span>
        <span className={styles.tooltipValue}>{row.value}</span>
      </div>
    </div>
  );
}
