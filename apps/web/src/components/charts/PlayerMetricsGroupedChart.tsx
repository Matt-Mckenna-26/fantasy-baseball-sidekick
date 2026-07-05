import { memo, useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { PlayerStatLine, StatColumn } from '@fcm/contracts';
import { toNumericValue } from '../../lib/teamTrend';
import { PlayerAvatar } from '../PlayerAvatar';
import { CHART_COLORS, CHART_THEME } from './palette';
import styles from './charts.module.css';

type GroupedRow = Record<string, string | number | null>;

/**
 * Grouped bar chart: one cluster of bars per player, one bar per stat metric. Bars are
 * the value's percentile (0-100) among the rostered pool so metrics on very different
 * raw scales (AVG vs RBI) stay directly comparable; the raw value rides along for the
 * tooltip.
 */
export const PlayerMetricsGroupedChart = memo(function PlayerMetricsGroupedChart({
  players,
  columns,
  percentiles,
}: {
  players: PlayerStatLine[];
  columns: ReadonlyArray<StatColumn>;
  percentiles: Map<string, (value: number) => number>;
}) {
  const rows = useMemo<GroupedRow[]>(() => {
    return players.map((p) => {
      const byKey = new Map(p.stats.map((s) => [s.key, s.value]));
      const row: GroupedRow = {
        name: p.player.fullName,
        playerId: p.player.playerId,
        headshotUrl: p.player.headshotUrl ?? null,
        owner: p.owner ?? null,
      };
      for (const col of columns) {
        const raw = toNumericValue(byKey.get(col.key));
        const pct = raw == null ? null : (percentiles.get(col.key)?.(raw) ?? null);
        row[col.key] = pct == null ? null : Math.round(pct * 100);
        row[`${col.key}__raw`] = raw == null ? '-' : String(byKey.get(col.key));
      }
      return row;
    });
  }, [players, columns, percentiles]);

  if (players.length === 0 || columns.length === 0) {
    return <p className={styles.empty}>Select players in the grid to compare.</p>;
  }

  // Fill the row when there's space, but keep a floor so clusters never get too cramped
  // (scrolls horizontally below that floor).
  const minWidth = Math.max(520, players.length * (columns.length * 12 + 56));

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <div style={{ minWidth, width: '100%', height: 400 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }} barGap={1} barCategoryGap="18%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.border} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fill: CHART_THEME.text, fontSize: 12 }}
              axisLine={{ stroke: CHART_THEME.border }}
              tickLine={false}
              interval={0}
            />
            <YAxis
              type="number"
              domain={[0, 100]}
              tick={{ fill: CHART_THEME.muted, fontSize: 12 }}
              axisLine={{ stroke: CHART_THEME.border }}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
              content={(props) => <GroupedTooltip {...props} columns={columns} />}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {columns.map((col, i) => (
              <Bar
                key={col.key}
                dataKey={col.key}
                name={col.label}
                fill={CHART_COLORS[i % CHART_COLORS.length]!}
                radius={[3, 3, 0, 0]}
                isAnimationActive
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

function GroupedTooltip({
  active,
  payload,
  label,
  columns,
}: TooltipContentProps & { columns: ReadonlyArray<StatColumn> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as GroupedRow | undefined;
  if (!row) return null;
  const name = String(row.name ?? label ?? '');
  const headshotUrl = typeof row.headshotUrl === 'string' ? row.headshotUrl : undefined;
  const owner = typeof row.owner === 'string' ? row.owner : undefined;
  const colByKey = new Map(columns.map((c) => [c.key, c]));
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipMetricsName} style={{ marginBottom: '0.4rem' }}>
        <span className={styles.tooltipAvatar}>
          <PlayerAvatar fullName={name} {...(headshotUrl ? { headshotUrl } : {})} />
        </span>
        <span className={styles.tooltipNameCol}>
          <span className={styles.tooltipPlayerName}>{name}</span>
          {owner ? <span className={styles.tooltipOwner}>{owner}</span> : null}
        </span>
      </div>
      {payload.map((entry) => {
        const key = String(entry.dataKey);
        const col = colByKey.get(key);
        const raw = row[`${key}__raw`];
        return (
          <div key={key} className={styles.tooltipRow}>
            <span className={styles.tooltipSwatch} style={{ background: entry.color }} />
            <span className={styles.tooltipName}>{col?.label ?? key}</span>
            <span className={styles.tooltipValue}>
              {raw != null ? String(raw) : '-'} &middot; {String(entry.value ?? '-')}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
