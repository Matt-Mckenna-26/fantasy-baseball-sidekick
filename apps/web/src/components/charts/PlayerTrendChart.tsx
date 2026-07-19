import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { PlayerTrendRow } from '../../lib/playerTrend';
import { downloadTrendChartPng, type TrendLegendRow } from '../../lib/chartExport';
import { PlayerAvatar } from '../PlayerAvatar';
import { CHART_THEME } from './palette';
import { ChartDownloadButton } from './ChartDownloadButton';
import styles from './charts.module.css';

export interface TrendPlayer {
  id: string;
  name: string;
  headshotUrl?: string;
  /** Fantasy team that rosters the player, shown as tooltip subtext. */
  owner?: string;
}

/** Value at a range for a player, or null; used to sort the tooltip and fill cells. */
function cell(v: number | string | null | undefined): number | null {
  return typeof v === 'number' ? v : null;
}

/**
 * Fit the y-axis to the plotted percentiles so the lines fill the chart instead of
 * bunching (e.g. all-elite players sitting near 100). Snaps to clean 5-point bounds
 * with a little padding, clamped to [0, 100], and returns matching round ticks.
 */
function fitScale(values: number[]): { domain: [number, number]; ticks: number[] } {
  if (values.length === 0) return { domain: [0, 100], ticks: [0, 25, 50, 75, 100] };
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const pad = Math.max(3, (mx - mn) * 0.12);
  let lo = Math.max(0, Math.floor((mn - pad) / 5) * 5);
  let hi = Math.min(100, Math.ceil((mx + pad) / 5) * 5);
  if (hi - lo < 10) {
    lo = Math.max(0, lo - 5);
    hi = Math.min(100, hi + 5);
  }
  const range = hi - lo;
  const step = range <= 25 ? 5 : range <= 60 ? 10 : 25;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + 0.001; t += step) ticks.push(t);
  return { domain: [lo, hi], ticks };
}

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

export function buildTrendLegendRows(
  rows: PlayerTrendRow[],
  players: TrendPlayer[],
  seasonBaseline: Record<string, number | null>,
  colorMap: Map<string, string>,
): { ranked: TrendLegendRow[]; hasL21: boolean; hasL14: boolean } {
  const last30 = rows.find((r) => r.range === 'last30');
  const last21 = rows.find((r) => r.range === 'last21');
  const last14 = rows.find((r) => r.range === 'last14');
  const last7 = rows.find((r) => r.range === 'last7');
  const hasL21 = last21 != null;
  const hasL14 = last14 != null;

  const ranked = players
    .map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.owner ? { owner: p.owner } : {}),
      ...(p.headshotUrl ? { headshotUrl: p.headshotUrl } : {}),
      color: colorMap.get(p.id) ?? CHART_THEME.accent,
      l30: cell(last30?.[p.id]),
      l21: cell(last21?.[p.id]),
      l14: cell(last14?.[p.id]),
      l7: cell(last7?.[p.id]),
      szn: cell(seasonBaseline[p.id]),
    }))
    .filter(
      (r) => r.l30 !== null || r.l21 !== null || r.l14 !== null || r.l7 !== null || r.szn !== null,
    )
    .sort((a, b) => (b.l7 ?? b.l14 ?? b.l21 ?? b.l30 ?? -1) - (a.l7 ?? a.l14 ?? a.l21 ?? a.l30 ?? -1));

  return { ranked, hasL21, hasL14 };
}

function TrendLegendTable({
  metricLabel,
  ranked,
  hasL21,
  hasL14,
  colorMap,
  hoveredId,
  activeRowRef,
  hideAvatars = false,
}: {
  metricLabel: string;
  ranked: TrendLegendRow[];
  hasL21: boolean;
  hasL14: boolean;
  colorMap: Map<string, string>;
  hoveredId?: string | null;
  activeRowRef?: RefObject<HTMLDivElement | null>;
  /** Omit the per-row avatar (used when series are metrics, not players). */
  hideAvatars?: boolean;
}) {
  if (ranked.length === 0) return null;

  return (
    <>
      <p className={styles.tooltipTitle}>{metricLabel} percentile</p>
      <div
        className={`${styles.tooltipMetricsHead}${hasL21 ? ` ${styles.withL21}` : ''}${hasL14 ? ` ${styles.withL14}` : ''}`}
      >
        <span className={styles.tooltipMetricsName} />
        <span className={styles.tooltipMetricCol}>L30</span>
        {hasL21 ? <span className={styles.tooltipMetricCol}>L21</span> : null}
        {hasL14 ? <span className={styles.tooltipMetricCol}>L14</span> : null}
        <span className={styles.tooltipMetricCol}>L7</span>
        <span className={styles.tooltipMetricCol}>Szn</span>
      </div>
      {ranked.map((row) => {
        const isActive = row.id === hoveredId;
        return (
          <div
            key={row.id}
            ref={isActive ? activeRowRef : null}
            className={`${styles.tooltipMetricsRow}${hasL21 ? ` ${styles.withL21}` : ''}${hasL14 ? ` ${styles.withL14}` : ''}${isActive ? ` ${styles.tooltipMetricsRowActive}` : ''}`}
          >
            <span className={styles.tooltipMetricsName}>
              <span className={styles.tooltipSwatch} style={{ background: row.color }} />
              {hideAvatars ? null : (
                <span className={styles.tooltipAvatar}>
                  <PlayerAvatar
                    fullName={row.name}
                    {...(row.headshotUrl ? { headshotUrl: row.headshotUrl } : {})}
                  />
                </span>
              )}
              <span className={styles.tooltipNameCol}>
                <span className={styles.tooltipPlayerName}>{row.name}</span>
                {row.owner ? <span className={styles.tooltipOwner}>{row.owner}</span> : null}
              </span>
            </span>
            <span className={styles.tooltipMetricCol}>
              {row.l30 == null ? '\u2013' : ordinal(row.l30)}
            </span>
            {hasL21 ? (
              <span className={styles.tooltipMetricCol}>
                {row.l21 == null ? '\u2013' : ordinal(row.l21)}
              </span>
            ) : null}
            {hasL14 ? (
              <span className={styles.tooltipMetricCol}>
                {row.l14 == null ? '\u2013' : ordinal(row.l14)}
              </span>
            ) : null}
            <span className={styles.tooltipMetricCol}>
              {row.l7 == null ? '\u2013' : ordinal(row.l7)}
            </span>
            <span className={styles.tooltipMetricCol}>
              {row.szn == null ? '\u2013' : ordinal(row.szn)}
            </span>
          </div>
        );
      })}
    </>
  );
}

/**
 * Combo "recent form" chart, all in percentile space (0-100) within the rostered pool so
 * every window is comparable regardless of length. A solid line connects each player's
 * recent-window percentiles (the trend), and a dashed horizontal line marks their
 * Season percentile as a separate baseline - so rising above the dashed line means the
 * player is hotter than their season-long rank. The tooltip lays out every player's full
 * set of series (Last 30 / Last 21 and Last 14 when available / Last 7 / Season) so the
 * whole picture reads at a glance.
 */
export const PlayerTrendChart = memo(function PlayerTrendChart({
  rows,
  seasonBaseline,
  players,
  metricLabel,
  colorMap,
  fillHeight = false,
  hideAvatars = false,
}: {
  rows: PlayerTrendRow[];
  seasonBaseline: Record<string, number | null>;
  players: TrendPlayer[];
  metricLabel: string;
  colorMap: Map<string, string>;
  /** Flex to fill the parent's height (for the fixed-height player-focus modal) instead of a fixed 475px. */
  fillHeight?: boolean;
  /** Omit legend avatars (used when each series is a metric rather than a player). */
  hideAvatars?: boolean;
}) {
  // Which series the cursor is over, so the tooltip and lines can focus on it.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  const legend = useMemo(
    () => buildTrendLegendRows(rows, players, seasonBaseline, colorMap),
    [rows, players, seasonBaseline, colorMap],
  );

  const handleExport = useCallback(async () => {
    if (!chartRef.current || exporting) return;
    setExporting(true);
    try {
      await downloadTrendChartPng({
        chartRoot: chartRef.current,
        metricLabel,
        legendRows: legend.ranked,
        hasL21: legend.hasL21,
        hasL14: legend.hasL14,
      });
    } catch (err) {
      console.error('PNG export failed', err);
    } finally {
      setExporting(false);
    }
  }, [exporting, legend, metricLabel]);

  if (rows.length === 0 || players.length === 0) {
    return <p className={styles.empty}>Add players to see their recent {metricLabel} form.</p>;
  }

  // Scale the axis to the plotted values (line points + season baselines) so the series
  // fill the chart rather than clustering at one end.
  const plotted: number[] = [];
  for (const row of rows) {
    for (const p of players) {
      const v = cell(row[p.id]);
      if (v !== null) plotted.push(v);
    }
  }
  for (const p of players) {
    const b = cell(seasonBaseline[p.id]);
    if (b !== null) plotted.push(b);
  }
  const { domain, ticks } = fitScale(plotted);

  return (
    <div className={`${styles.trendChartWrap}${fillHeight ? ` ${styles.trendChartFill}` : ''}`}>
      <div className={styles.trendChartActions}>
        <ChartDownloadButton
          onClick={() => void handleExport()}
          busy={exporting}
        />
      </div>
      <div
        ref={chartRef}
        data-chart-surface
        style={fillHeight ? { width: '100%', flex: 1, minHeight: 0 } : { width: '100%', height: 475 }}
      >
        <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          {/* Heat backdrop: reddish toward the top (high percentile), blueish toward
              the bottom (low), echoing the grid's hot/cold coloring. */}
          <defs>
            <linearGradient id="trendHeat" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.16} />
              <stop offset="50%" stopColor="#64748b" stopOpacity={0.02} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0.16} />
            </linearGradient>
          </defs>
          <ReferenceArea
            y1={domain[0]}
            y2={domain[1]}
            fill="url(#trendHeat)"
            fillOpacity={1}
            stroke="none"
          />
          <CartesianGrid stroke={CHART_THEME.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            // Only two points, so pad the edges to keep the dots off the walls.
            padding={{ left: 56, right: 56 }}
            tick={{ fill: CHART_THEME.muted, fontSize: 12 }}
            axisLine={{ stroke: CHART_THEME.border }}
            tickLine={false}
          />
          <YAxis
            domain={domain}
            ticks={ticks}
            allowDecimals={false}
            tickFormatter={(v: number) => ordinal(v)}
            tick={{ fill: CHART_THEME.muted, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          {/* Each player's season percentile as a dashed baseline, in their line color. */}
          {players.map((p) => {
            const base = seasonBaseline[p.id];
            if (base == null) return null;
            const dimmed = hoveredId != null && hoveredId !== p.id;
            return (
              <ReferenceLine
                key={`base-${p.id}`}
                y={base}
                stroke={colorMap.get(p.id) ?? CHART_THEME.accent}
                strokeDasharray="7 4"
                strokeWidth={hoveredId === p.id ? 2.5 : 2}
                strokeOpacity={dimmed ? 0.18 : hoveredId === p.id ? 0.95 : 0.7}
              />
            );
          })}
          <Tooltip
            cursor={{ stroke: CHART_THEME.muted, strokeWidth: 1 }}
            content={(props) => (
              <TrendTooltip
                {...props}
                rows={rows}
                players={players}
                metricLabel={metricLabel}
                seasonBaseline={seasonBaseline}
                colorMap={colorMap}
                hoveredId={hoveredId}
                hideAvatars={hideAvatars}
              />
            )}
          />
          {players.map((p) => {
            const dimmed = hoveredId != null && hoveredId !== p.id;
            return (
              <Line
                key={p.id}
                type="monotone"
                dataKey={p.id}
                name={p.name}
                stroke={colorMap.get(p.id) ?? CHART_THEME.accent}
                strokeWidth={hoveredId === p.id ? 3.5 : 2}
                strokeOpacity={dimmed ? 0.25 : 1}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls
                isAnimationActive={false}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
});

function TrendTooltip({
  active,
  rows,
  players,
  metricLabel,
  seasonBaseline,
  colorMap,
  hoveredId,
  hideAvatars = false,
}: TooltipContentProps & {
  rows: PlayerTrendRow[];
  players: TrendPlayer[];
  metricLabel: string;
  seasonBaseline: Record<string, number | null>;
  colorMap: Map<string, string>;
  hoveredId: string | null;
  hideAvatars?: boolean;
}) {
  const activeRowRef = useRef<HTMLDivElement>(null);
  // Keep the focused player's row visible even when the list overflows.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [hoveredId]);

  if (!active) return null;
  const { ranked, hasL21, hasL14 } = buildTrendLegendRows(rows, players, seasonBaseline, colorMap);
  if (ranked.length === 0) return null;

  // When the cursor is on one line, collapse the tooltip to just that player so it's
  // small and unambiguous; otherwise list everyone (best current form first).
  const focused = hoveredId ? ranked.filter((r) => r.id === hoveredId) : [];
  const list = focused.length > 0 ? focused : ranked;

  return (
    <div className={styles.tooltip}>
      <TrendLegendTable
        metricLabel={metricLabel}
        ranked={list}
        hasL21={hasL21}
        hasL14={hasL14}
        colorMap={colorMap}
        hoveredId={hoveredId}
        activeRowRef={activeRowRef}
        hideAvatars={hideAvatars}
      />
    </div>
  );
}
