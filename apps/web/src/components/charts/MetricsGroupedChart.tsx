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
import type { StatColumn } from '@fcm/contracts';
import { useIsNarrow } from '../../hooks/useIsNarrow';
import { toNumericValue } from '../../lib/teamTrend';
import { CHART_COLORS, CHART_THEME } from './palette';
import { CompareAvatar, type CompareEntity } from './compareEntity';
import styles from './charts.module.css';

type GroupedRow = Record<string, string | number | null>;

/** English ordinal for a percentile, e.g. 72 -> "72nd". */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Grouped bar chart: one cluster of bars per entity (player or team), one bar per stat
 * metric. Bars are the value's percentile (0-100) among the pool so metrics on very
 * different raw scales (AVG vs RBI) stay directly comparable; the raw value rides along
 * for the tooltip.
 */
export const MetricsGroupedChart = memo(function MetricsGroupedChart({
  entities,
  columns,
  percentiles,
}: {
  entities: CompareEntity[];
  columns: ReadonlyArray<StatColumn>;
  percentiles: Map<string, (value: number) => number>;
}) {
  const isNarrow = useIsNarrow();
  const rows = useMemo<GroupedRow[]>(() => {
    return entities.map((e) => {
      const byKey = new Map(e.stats.map((s) => [s.key, s.value]));
      const row: GroupedRow = {
        name: e.name,
        id: e.id,
        imageUrl: e.imageUrl ?? null,
        subtitle: e.subtitle ?? null,
        kind: e.kind,
      };
      for (const col of columns) {
        const raw = toNumericValue(byKey.get(col.key));
        const pct = raw == null ? null : (percentiles.get(col.key)?.(raw) ?? null);
        row[col.key] = pct == null ? null : Math.round(pct * 100);
        row[`${col.key}__raw`] = raw == null ? '-' : String(byKey.get(col.key));
      }
      return row;
    });
  }, [entities, columns, percentiles]);

  if (entities.length === 0 || columns.length === 0) {
    return <p className={styles.empty}>Select rows in the grid to compare.</p>;
  }

  // Desktop keeps a 520px floor so clusters stay readable; on phones fill the container
  // and only grow past the viewport when entity×metric width demands it.
  const contentWidth = entities.length * (columns.length * 12 + 56);
  const minWidth = isNarrow ? Math.max(contentWidth, 0) : Math.max(520, contentWidth);

  return (
    <div data-chart-scroll style={{ width: '100%', overflowX: 'auto' }}>
      <div data-chart-surface style={{ minWidth, width: '100%', height: isNarrow ? 320 : 400 }}>
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
              allowDecimals={false}
              tickFormatter={(v: number) => ordinal(v)}
              tick={{ fill: CHART_THEME.muted, fontSize: 12 }}
              axisLine={{ stroke: CHART_THEME.border }}
              tickLine={false}
              width={52}
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
                isAnimationActive={false}
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
  const imageUrl = typeof row.imageUrl === 'string' ? row.imageUrl : undefined;
  const subtitle = typeof row.subtitle === 'string' ? row.subtitle : undefined;
  const kind = row.kind === 'team' ? 'team' : 'player';
  const colByKey = new Map(columns.map((c) => [c.key, c]));
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipMetricsName} style={{ marginBottom: '0.4rem' }}>
        <span className={styles.tooltipAvatar}>
          <CompareAvatar name={name} kind={kind} {...(imageUrl ? { imageUrl } : {})} />
        </span>
        <span className={styles.tooltipNameCol}>
          <span className={styles.tooltipPlayerName}>{name}</span>
          {subtitle ? <span className={styles.tooltipOwner}>{subtitle}</span> : null}
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
