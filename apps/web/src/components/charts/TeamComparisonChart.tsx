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
import type { TeamStatLine } from '@fcm/contracts';
import { toNumericValue } from '../../lib/teamTrend';
import { CHART_COLORS, CHART_THEME } from './palette';
import styles from './charts.module.css';

interface ComparisonRow {
  teamId: string;
  teamName: string;
  value: number;
}

/**
 * Horizontal bar chart comparing every team's value for one metric in the currently
 * loaded bucket. Sorted best-first (ascending for lower-is-better stats like ERA).
 */
export const TeamComparisonChart = memo(function TeamComparisonChart({
  teams,
  metricKey,
  metricLabel,
  lowerIsBetter,
  colorMap,
}: {
  teams: TeamStatLine[];
  metricKey: string;
  metricLabel: string;
  lowerIsBetter: boolean;
  colorMap: Map<string, string>;
}) {
  const rows: ComparisonRow[] = teams
    .map((t) => {
      const found = t.stats.find((s) => s.key === metricKey);
      return { teamId: t.teamId, teamName: t.teamName, value: toNumericValue(found?.value) };
    })
    .filter((r): r is ComparisonRow => r.value !== null);

  rows.sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value));

  if (rows.length === 0) {
    return <p className={styles.empty}>No {metricLabel} values to compare for this range.</p>;
  }

  const height = Math.max(220, rows.length * 34 + 48);

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
            dataKey="teamName"
            width={130}
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
              <Cell key={r.teamId} fill={colorMap.get(r.teamId) ?? CHART_COLORS[0]} />
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
      <p className={styles.tooltipTitle}>{row.teamName}</p>
      <div className={styles.tooltipRow}>
        <span className={styles.tooltipName}>{metricLabel}</span>
        <span className={styles.tooltipValue}>{row.value}</span>
      </div>
    </div>
  );
}
