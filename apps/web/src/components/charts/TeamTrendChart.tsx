import { memo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { TrendRow } from '../../lib/teamTrend';
import { CHART_THEME } from './palette';
import styles from './charts.module.css';

interface TrendTeam {
  teamId: string;
  teamName: string;
}

/**
 * Multi-line trend chart: one line per team showing its weekly value for the selected
 * metric across the trailing weeks. Legend entries toggle a team's line (Recharts
 * default), and the tooltip lists every team for the hovered week, best value first.
 */
export const TeamTrendChart = memo(function TeamTrendChart({
  rows,
  teams,
  metricLabel,
  colorMap,
}: {
  rows: TrendRow[];
  teams: TrendTeam[];
  metricLabel: string;
  colorMap: Map<string, string>;
}) {
  if (rows.length === 0) {
    return <p className={styles.empty}>No weekly {metricLabel} data for the recent weeks.</p>;
  }

  return (
    <div style={{ width: '100%', height: 380 }}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={CHART_THEME.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: CHART_THEME.muted, fontSize: 12 }}
            axisLine={{ stroke: CHART_THEME.border }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: CHART_THEME.muted, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ stroke: CHART_THEME.muted, strokeWidth: 1 }}
            content={(props) => <TrendTooltip {...props} teams={teams} metricLabel={metricLabel} />}
          />
          {teams.map((t) => (
            <Line
              key={t.teamId}
              type="monotone"
              dataKey={t.teamId}
              name={t.teamName}
              stroke={colorMap.get(t.teamId) ?? CHART_THEME.accent}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

function TrendTooltip({
  active,
  payload,
  label,
  teams,
  metricLabel,
}: TooltipContentProps & { teams: TrendTeam[]; metricLabel: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const nameById = new Map(teams.map((t) => [t.teamId, t.teamName]));
  const entries = payload
    .filter((p) => typeof p.value === 'number')
    .sort((a, b) => (b.value as number) - (a.value as number));
  if (entries.length === 0) return null;
  return (
    <div className={styles.tooltip}>
      <p className={styles.tooltipTitle}>
        {label} &middot; {metricLabel}
      </p>
      {entries.map((e) => (
        <div key={String(e.dataKey)} className={styles.tooltipRow}>
          <span className={styles.tooltipSwatch} style={{ background: e.color }} />
          <span className={styles.tooltipName}>{nameById.get(String(e.dataKey)) ?? e.name}</span>
          <span className={styles.tooltipValue}>{e.value}</span>
        </div>
      ))}
    </div>
  );
}
