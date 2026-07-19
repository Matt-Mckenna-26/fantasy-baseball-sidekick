import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { PlayerNewsItem, PlayerStatsResponse, StatRange, StatTable } from '@fcm/contracts';
import { getAdvancedLeagueStats, getPlayerNews, getPlayerStats } from '../api/client';
import { usePlayerFocus, type PlayerFocusTarget } from '../context/PlayerFocusContext';
import { usePlayerTrend } from '../hooks/usePlayerTrend';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { buildPlayerMetricTrend, playerTrendWindows } from '../lib/playerTrend';
import { buildStatPercentiles, buildStatRanks } from '../lib/percentile';
import { scoringColumns, toCompareEntity, toStatRow } from '../lib/statPool';
import { buildTeamColorMap } from './charts/palette';
import { CompareEntityTiles } from './charts/CompareEntityTiles';
import { PlayerTrendChart, buildTrendLegendRows } from './charts/PlayerTrendChart';
import { ChartLoading } from './charts/ChartLoading';
import { buildCompareTileExports, downloadPlayerCardPng } from '../lib/chartExport';
import styles from './PlayerFocusModal.module.css';
import chartStyles from './charts/charts.module.css';

/** Default card size, kept in sync with the CSS so initial placement can be centered. */
const CARD_W = 1024;
const CARD_H = 672;
/** Smallest a card can be dragged-resized to, so its two panels stay usable. */
const MIN_W = 560;
const MIN_H = 420;
/** Below this card width the two panels don't both fit; collapse to one + a view toggle. */
const COMPACT_W = 780;
/** Each new card cascades down-right so stacked cards stay individually grabbable. */
const CASCADE = 30;
/** Module-level z-order counter: clicking/dragging a card raises it above the others. */
let zTop = 200;
/** Gap between a snapped card and the viewport edges / its neighbour. */
const SNAP_GAP = 10;
/** How close (px) the pointer must get to an edge/corner to trigger a snap zone. */
const SNAP_BAND = 80;
/** Side/quadrant snaps dock a third narrower than a half-screen so a docked card leaves room for the chat thread beside it. */
const SNAP_WIDTH_SCALE = 2 / 3;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Aero-snap target for the current pointer position: corners dock to a quadrant, the left/right
 * edges to a (narrowed) half, and the top edge maximizes. Returns null when the pointer isn't
 * near an edge, so the card free-floats. Sizes are computed against the live viewport so it
 * "autosizes" to park. Side/quadrant snaps are SNAP_WIDTH_SCALE of a half-width and the
 * right-side ones hug the right edge, so a docked card doesn't cover the chat thread.
 */
function snapZoneFor(x: number, y: number): Rect | null {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const halfH = (H - 3 * SNAP_GAP) / 2;
  const fullW = W - 2 * SNAP_GAP;
  const fullH = H - 2 * SNAP_GAP;
  const snapW = ((W - 3 * SNAP_GAP) / 2) * SNAP_WIDTH_SCALE;
  const leftX = SNAP_GAP;
  const rightX = W - SNAP_GAP - snapW;
  const botY = SNAP_GAP * 2 + halfH;

  const nearL = x <= SNAP_BAND;
  const nearR = x >= W - SNAP_BAND;
  const nearT = y <= SNAP_BAND;
  const nearB = y >= H - SNAP_BAND;

  if (nearT && nearL) return { x: leftX, y: SNAP_GAP, w: snapW, h: halfH };
  if (nearT && nearR) return { x: rightX, y: SNAP_GAP, w: snapW, h: halfH };
  if (nearB && nearL) return { x: leftX, y: botY, w: snapW, h: halfH };
  if (nearB && nearR) return { x: rightX, y: botY, w: snapW, h: halfH };
  if (nearL) return { x: leftX, y: SNAP_GAP, w: snapW, h: fullH };
  if (nearR) return { x: rightX, y: SNAP_GAP, w: snapW, h: fullH };
  if (nearT) return { x: SNAP_GAP, y: SNAP_GAP, w: fullW, h: fullH };
  return null;
}

/** Initials fallback for the prominent header avatar (mirrors EntityAvatar). */
function initials(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

/** Format an ISO / YYYY-MM-DD timestamp as a short local date; echo the raw string on failure. */
function formatDate(published: string | undefined): string {
  if (!published) return '';
  const d = new Date(published);
  return Number.isNaN(d.getTime()) ? published : d.toLocaleDateString();
}

/** A per-range compare table (columns + this range's lines + rank/percentile lookups). */
interface RangeTable {
  columns: ReturnType<typeof scoringColumns>;
  lineById: Map<string, StatTable['players'][number]>;
  percentiles: Map<string, (value: number) => number>;
  ranks: Map<string, (value: number) => { rank: number; total: number }>;
}

/** Build rank/percentile lookups for one window's rostered table (mirrors useLeagueStatPool). */
function buildRangeTable(table: StatTable | undefined, isPitching: boolean): RangeTable | null {
  if (!table) return null;
  const columns = scoringColumns(table.columns);
  const rows = table.players.map((l) => toStatRow(l, columns));
  const lineById = new Map(table.players.map((l) => [l.player.playerId, l]));
  return {
    columns,
    lineById,
    percentiles: buildStatPercentiles(rows, columns, isPitching),
    ranks: buildStatRanks(rows, columns, isPitching),
  };
}

function NewsRow({ item }: { item: PlayerNewsItem }) {
  const date = formatDate(item.published);
  const body = (
    <>
      <div className={styles.newsTop}>
        <span
          className={`${styles.newsSource} ${item.source === 'espn' ? styles.newsEspn : styles.newsMlb}`}
        >
          {item.source === 'espn' ? 'ESPN' : 'MLB'}
        </span>
        {item.type ? <span className={styles.newsType}>{item.type}</span> : null}
        {date ? <span className={styles.newsDate}>{date}</span> : null}
      </div>
      <p className={styles.newsHeadline}>{item.headline}</p>
      {item.description ? <p className={styles.newsDesc}>{item.description}</p> : null}
    </>
  );
  return (
    <li className={styles.newsItem}>
      {item.url ? (
        <a className={styles.newsLink} href={item.url} target="_blank" rel="noopener noreferrer">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}

/**
 * Advanced / expected ("luck") season stats for the player, fetched on its own so the rest of
 * the card renders immediately. Reuses the league-wide advanced pool to render the same
 * percentile-colored rank tiles as the scoring card (xBA, xSLG, xwOBA, BABIP, K%/BB% or K/9
 * etc.). Fails soft to a short note; shows nothing extra when the player isn't in the pool.
 */
export function AdvancedPanel({
  leagueId,
  playerId,
  isPitching,
}: {
  leagueId: string | undefined;
  playerId: string;
  isPitching: boolean;
}) {
  const [data, setData] = useState<PlayerStatsResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    if (!leagueId) {
      setStatus('error');
      return;
    }
    let stale = false;
    setStatus('loading');
    setData(null);
    getAdvancedLeagueStats(leagueId)
      .then((res) => {
        if (stale) return;
        setData(res);
        setStatus('ready');
      })
      .catch(() => {
        if (!stale) setStatus('error');
      });
    return () => {
      stale = true;
    };
  }, [leagueId]);

  const table = data ? (isPitching ? data.pitching : data.batting) : undefined;
  const adv = useMemo<RangeTable | null>(() => {
    if (!table) return null;
    const columns = table.columns;
    const rows = table.players.map((l) => toStatRow(l, columns));
    return {
      columns,
      lineById: new Map(table.players.map((l) => [l.player.playerId, l])),
      percentiles: buildStatPercentiles(rows, columns, isPitching),
      ranks: buildStatRanks(rows, columns, isPitching),
    };
  }, [table, isPitching]);
  const line = adv?.lineById.get(playerId);

  return (
    <section className={styles.advancedSection}>
      <h3 className={styles.sectionTitle}>Advanced (season)</h3>
      {status === 'loading' ? (
        <p className={styles.note}>Loading advanced stats…</p>
      ) : status === 'error' ? (
        <p className={styles.note}>Couldn&apos;t load advanced stats.</p>
      ) : !adv || !line ? (
        <p className={styles.note}>No advanced stats available.</p>
      ) : (
        <CompareEntityTiles
          entities={[toCompareEntity(line)]}
          columns={adv.columns}
          percentiles={adv.percentiles}
          ranks={adv.ranks}
          hideHeader
        />
      )}
    </section>
  );
}

/** Self-sized circular headshot (or initials) for the prominent card header. */
function CardAvatar({ fullName, headshotUrl }: { fullName: string; headshotUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(headshotUrl) && !failed;
  return (
    <span className={styles.headerAvatar} aria-hidden="true">
      {showImage ? (
        <img src={headshotUrl} alt="" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className={styles.headerInitials}>{initials(fullName)}</span>
      )}
    </span>
  );
}

/** Clamp a card's top-left so it always stays partly on screen while dragging. */
function clampPos(x: number, y: number): { x: number; y: number } {
  const maxX = Math.max(8, window.innerWidth - 160);
  const maxY = Math.max(8, window.innerHeight - 80);
  return { x: Math.min(Math.max(x, 8 - CARD_W + 200), maxX), y: Math.min(Math.max(y, 8), maxY) };
}

/**
 * One draggable, independently-closable player card. Reads the shared season pool + trend
 * cache from context (so multiple open cards don't multiply fetches). The trend plots one
 * line per scoring metric (toggle to show/hide, double-click to isolate); the stat card's
 * window is chosen by the Range chips - both grouped as one control cluster.
 */
function PlayerFocusCard({ target, index }: { target: PlayerFocusTarget; index: number }) {
  const { pool, leagueId, supportsLast14, closePlayerFocus, getTrendWindows, setTrendWindows } =
    usePlayerFocus();

  const playerId = target.playerId;
  const tab: 'batting' | 'pitching' =
    target.positionType === 'P' ||
    (target.positionType === undefined && pool.pitching.lineById.has(playerId))
      ? 'pitching'
      : 'batting';
  const isPitching = tab === 'pitching';
  const seasonTable = isPitching ? pool.pitching : pool.batting;
  const columns = seasonTable.columns;

  // --- Trend windows (shared cache) + metrics-as-series ---
  const trendCache = useMemo(
    () => ({ get: getTrendWindows, set: setTrendWindows }),
    [getTrendWindows, setTrendWindows],
  );
  const trend = usePlayerTrend({ leagueId, supportsLast14, enabled: true, cache: trendCache });

  // One stable color per metric so a series keeps its color as chips are toggled.
  const colorMap = useMemo(() => buildTeamColorMap(columns.map((c) => c.key)), [columns]);

  // Which metric series are hidden on the trend (single-click toggle, double-click isolate).
  const [hiddenMetrics, setHiddenMetrics] = useState<ReadonlySet<string>>(new Set());
  const activeColumns = useMemo(
    () => columns.filter((c) => !hiddenMetrics.has(c.key)),
    [columns, hiddenMetrics],
  );
  const toggleMetric = (key: string) =>
    setHiddenMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isolateMetric = (key: string) =>
    setHiddenMetrics(new Set(columns.filter((c) => c.key !== key).map((c) => c.key)));

  const metricTrend = useMemo(
    () =>
      buildPlayerMetricTrend(
        trend.windows,
        tab,
        playerId,
        activeColumns.map((c) => c.key),
        isPitching,
      ),
    [trend.windows, tab, playerId, activeColumns, isPitching],
  );
  const trendSeries = useMemo(
    () => activeColumns.map((c) => ({ id: c.key, name: c.description ?? c.label })),
    [activeColumns],
  );

  // --- Range (stat-card window) chips ---
  const rangeOptions = useMemo(() => playerTrendWindows(supportsLast14), [supportsLast14]);
  const [selectedRange, setSelectedRange] = useState<StatRange>('season');

  // The trend prefetch loads windows sequentially (season -> ... -> last7), so the shorter
  // windows can lag. Fetch whichever range the user selects on demand (once) so the chip is
  // responsive rather than waiting on the whole prefetch; failures surface in the tile.
  const [onDemand, setOnDemand] = useState<Record<string, PlayerStatsResponse>>({});
  const [rangeError, setRangeError] = useState<Record<string, boolean>>({});
  const windowFor = useCallback(
    (range: StatRange): PlayerStatsResponse | undefined =>
      range === 'season' ? undefined : (trend.windows[range] ?? onDemand[range]),
    [trend.windows, onDemand],
  );

  useEffect(() => {
    if (selectedRange === 'season' || !leagueId) return;
    if (trend.windows[selectedRange] || onDemand[selectedRange]) return;
    let stale = false;
    getPlayerStats(leagueId, selectedRange, { silent: true })
      .then((res) => {
        if (!stale) setOnDemand((prev) => ({ ...prev, [selectedRange]: res }));
      })
      .catch(() => {
        if (!stale) setRangeError((prev) => ({ ...prev, [selectedRange]: true }));
      });
    return () => {
      stale = true;
    };
  }, [selectedRange, leagueId, trend.windows, onDemand]);

  const rangeTable = useMemo<RangeTable | null>(() => {
    if (selectedRange === 'season') {
      return {
        columns: seasonTable.columns,
        lineById: seasonTable.lineById,
        percentiles: seasonTable.percentiles,
        ranks: seasonTable.ranks,
      };
    }
    return buildRangeTable(windowFor(selectedRange)?.[tab], isPitching);
  }, [selectedRange, seasonTable, windowFor, tab, isPitching]);
  const line = rangeTable?.lineById.get(playerId);

  // Per-range status for the stat card (season rides the shared pool; others the fetch above).
  const rangeIsReady =
    selectedRange === 'season' ? pool.status === 'ready' : Boolean(windowFor(selectedRange));
  const rangeIsError =
    selectedRange === 'season' ? pool.status === 'error' : Boolean(rangeError[selectedRange]);

  // --- News ---
  const [news, setNews] = useState<PlayerNewsItem[]>([]);
  const [newsStatus, setNewsStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  useEffect(() => {
    let stale = false;
    setNewsStatus('loading');
    setNews([]);
    getPlayerNews(target.fullName, target.mlbTeamAbbr)
      .then((res) => {
        if (stale) return;
        setNews(res.items);
        setNewsStatus('ready');
      })
      .catch(() => {
        if (!stale) setNewsStatus('error');
      });
    return () => {
      stale = true;
    };
  }, [target.fullName, target.mlbTeamAbbr]);

  // --- Whole-card PNG export (header + stat card + trend, minus news) ---
  const bodyRef = useRef<HTMLDivElement>(null);
  const [exportingCard, setExportingCard] = useState(false);

  // --- Dragging, resizing + z-order ---
  const [size, setSize] = useState(() => ({
    w: Math.min(CARD_W, window.innerWidth - 32),
    h: Math.min(CARD_H, window.innerHeight - 32),
  }));
  // When the card is narrow (e.g. snapped to a quadrant), show one panel at a time.
  const isCompact = size.w < COMPACT_W;
  const [compactView, setCompactView] = useState<'card' | 'chart'>('card');
  const [pos, setPos] = useState(() =>
    clampPos(
      (window.innerWidth - CARD_W) / 2 + index * CASCADE,
      (window.innerHeight - CARD_H) / 2 + index * CASCADE,
    ),
  );
  const [z, setZ] = useState(() => ++zTop);
  // Below the stacking breakpoint (46rem) the card is a fixed, centered sheet: drag/resize
  // and the desktop centering math (which pushes a 1024px-wide card off a phone screen)
  // are skipped in favor of the CSS mobile layout.
  const narrow = useIsNarrow(736);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const snap = useRef<Rect | null>(null);
  const [snapPreview, setSnapPreview] = useState<Rect | null>(null);

  const onMove = useCallback((e: MouseEvent) => {
    if (drag.current) {
      setPos(clampPos(e.clientX - drag.current.dx, e.clientY - drag.current.dy));
      // Show where the card would park; commit it on release (see onUp).
      const zone = snapZoneFor(e.clientX, e.clientY);
      snap.current = zone;
      setSnapPreview(zone);
    } else if (resizeStart.current) {
      const s = resizeStart.current;
      setSize({
        w: Math.max(MIN_W, Math.min(s.w + (e.clientX - s.x), window.innerWidth - 16)),
        h: Math.max(MIN_H, Math.min(s.h + (e.clientY - s.y), window.innerHeight - 16)),
      });
    }
  }, []);
  const onUp = useCallback(() => {
    // Parked in a snap zone: dock + autosize to it.
    if (drag.current && snap.current) {
      setPos({ x: snap.current.x, y: snap.current.y });
      setSize({ w: snap.current.w, h: snap.current.h });
    }
    drag.current = null;
    resizeStart.current = null;
    snap.current = null;
    setSnapPreview(null);
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }, [onMove]);
  const bringToFront = useCallback(() => setZ(++zTop), []);
  const startDrag = useCallback(
    (e: ReactMouseEvent) => {
      bringToFront();
      drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [pos, onMove, onUp, bringToFront],
  );
  const startResize = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      bringToFront();
      resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [size, onMove, onUp, bringToFront],
  );
  useEffect(() => () => onUp(), [onUp]);

  const status = line?.player.status;
  const teamAbbr = target.mlbTeamAbbr ?? line?.player.mlbTeamAbbr;
  const owner = line?.owner;
  const hasTrend = metricTrend.rows.length > 0 && trendSeries.length > 0;

  const canExportCard = Boolean(line && rangeTable);
  const handleExportCard = useCallback(async () => {
    if (exportingCard || !line || !rangeTable) return;
    setExportingCard(true);
    try {
      const tiles = buildCompareTileExports(
        [toCompareEntity(line)],
        rangeTable.columns,
        rangeTable.percentiles,
        rangeTable.ranks,
      );
      const legend = buildTrendLegendRows(
        metricTrend.rows,
        trendSeries,
        metricTrend.seasonBaseline,
        colorMap,
      );
      const rangeText = rangeOptions.find((o) => o.range === selectedRange)?.label ?? 'Season';
      const subtitle = [teamAbbr, owner, status, `${rangeText} stats`]
        .filter(Boolean)
        .join('  \u00b7  ');
      await downloadPlayerCardPng({
        chartRoot: bodyRef.current,
        title: target.fullName,
        subtitle,
        metricLabel: target.fullName,
        tiles,
        legendRows: legend.ranked,
        hasL21: legend.hasL21,
        hasL14: legend.hasL14,
        filename: `${target.fullName}-card`,
      });
    } catch (err) {
      console.error('Card PNG export failed', err);
    } finally {
      setExportingCard(false);
    }
  }, [
    exportingCard,
    line,
    rangeTable,
    metricTrend,
    trendSeries,
    colorMap,
    rangeOptions,
    selectedRange,
    teamAbbr,
    owner,
    status,
    target.fullName,
  ]);

  return (
    <>
      {snapPreview ? (
        <div
          className={styles.snapPreview}
          style={{
            left: snapPreview.x,
            top: snapPreview.y,
            width: snapPreview.w,
            height: snapPreview.h,
            zIndex: z - 1,
          }}
          aria-hidden="true"
        />
      ) : null}
      <div
        className={styles.card}
        role="dialog"
        aria-label={`${target.fullName} details`}
        style={
          narrow
            ? { zIndex: z }
            : { left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: z }
        }
        onMouseDown={bringToFront}
      >
        <div className={styles.topBar} onMouseDown={narrow ? undefined : startDrag}>
          <span className={styles.dragGrip} aria-hidden="true">
            ⠿
          </span>
          {isCompact ? (
            <div
              className={styles.viewToggle}
              role="group"
              aria-label="Switch panel"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`${styles.viewToggleBtn}${compactView === 'card' ? ` ${styles.viewToggleBtnActive}` : ''}`}
                aria-pressed={compactView === 'card'}
                onClick={() => setCompactView('card')}
              >
                Ranks
              </button>
              <button
                type="button"
                className={`${styles.viewToggleBtn}${compactView === 'chart' ? ` ${styles.viewToggleBtnActive}` : ''}`}
                aria-pressed={compactView === 'chart'}
                onClick={() => setCompactView('chart')}
              >
                Trend
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={styles.exportBtn}
            onClick={() => void handleExportCard()}
            onMouseDown={(e) => e.stopPropagation()}
            disabled={!canExportCard || exportingCard}
            aria-busy={exportingCard || undefined}
            aria-label="Export card as PNG"
            title="Export card as PNG (excludes News)"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.exportIcon}>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 3.5v9m0 0 3.25-3.25M10 12.5 6.75 9.25M4.5 14.5v1.75c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-1.75"
              />
            </svg>
            <span>{exportingCard ? 'Exporting\u2026' : 'PNG'}</span>
          </button>
          <button
            type="button"
            className={styles.close}
            onClick={() => closePlayerFocus(playerId)}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className={styles.body} ref={bodyRef}>
          <div className={styles.playerHeader}>
            <CardAvatar
              fullName={target.fullName}
              {...(target.headshotUrl ? { headshotUrl: target.headshotUrl } : {})}
            />
            <div className={styles.playerHeaderText}>
              <span className={styles.headerName}>{target.fullName}</span>
              <span className={styles.headerMeta}>
                {teamAbbr ? <span>{teamAbbr}</span> : null}
                {owner ? <span className={styles.headerOwner}>{owner}</span> : null}
                {typeof line?.sgptPlus === 'number' ? (
                  <span
                    className={styles.sgptBadge}
                    title={
                      typeof line.sgptRank === 'number'
                        ? `Value+ ${line.sgptPlus} - #${line.sgptRank} overall (hitters + pitchers)`
                        : `Value+ ${line.sgptPlus}`
                    }
                  >
                    Value+ {line.sgptPlus}
                    {typeof line.sgptRank === 'number' ? (
                      <span className={styles.sgptBadgeRank}> #{line.sgptRank}</span>
                    ) : null}
                  </span>
                ) : null}
                {status ? <span className={styles.statusBadge}>{status}</span> : null}
              </span>
            </div>
          </div>

          {columns.length > 0 ? (
            <div className={styles.controls}>
              <div className={chartStyles.controlGroup}>
                <span className={chartStyles.controlGroupLabel}>Range (stats)</span>
                <div className={chartStyles.teamToggles} role="group" aria-label="Stat card range">
                  {rangeOptions.map((opt) => {
                    const active = selectedRange === opt.range;
                    return (
                      <button
                        key={opt.range}
                        type="button"
                        aria-pressed={active}
                        title={opt.label}
                        className={`${chartStyles.teamChip}${active ? ` ${chartStyles.teamChipActive}` : ''}`}
                        onClick={() => setSelectedRange(opt.range)}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={chartStyles.controlGroup}>
                <span className={chartStyles.controlGroupLabel}>Metrics</span>
                <div
                  className={chartStyles.teamToggles}
                  role="group"
                  aria-label="Show or hide trend metrics"
                >
                  <div className={chartStyles.teamToggleActions}>
                    <button
                      type="button"
                      className={chartStyles.teamToggleAction}
                      onClick={() => setHiddenMetrics(new Set())}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={chartStyles.teamToggleAction}
                      onClick={() => setHiddenMetrics(new Set(columns.map((c) => c.key)))}
                    >
                      None
                    </button>
                  </div>
                  {columns.map((col) => {
                    const hidden = hiddenMetrics.has(col.key);
                    return (
                      <button
                        key={col.key}
                        type="button"
                        aria-pressed={!hidden}
                        title={`${col.description ?? col.label} \u2014 click to toggle, double-click to isolate`}
                        className={`${chartStyles.teamChip}${hidden ? ` ${chartStyles.teamChipHidden}` : ''}`}
                        onClick={() => toggleMetric(col.key)}
                        onDoubleClick={() => isolateMetric(col.key)}
                      >
                        <span
                          className={chartStyles.teamSwatch}
                          style={{ background: colorMap.get(col.key) }}
                        />
                        {col.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <div className={`${styles.panels}${isCompact ? ` ${styles.panelsCompact}` : ''}`}>
            {!isCompact || compactView === 'card' ? (
              <div className={styles.leftCol}>
                <section className={styles.statSection}>
                  <h3 className={styles.sectionTitle}>
                    {rangeOptions.find((o) => o.range === selectedRange)?.label ?? 'Season'}
                  </h3>
                  {line && rangeTable ? (
                    <CompareEntityTiles
                      entities={[toCompareEntity(line)]}
                      columns={rangeTable.columns}
                      percentiles={rangeTable.percentiles}
                      ranks={rangeTable.ranks}
                      hideHeader
                    />
                  ) : rangeIsError ? (
                    <p className={styles.note}>Couldn&apos;t load this player&apos;s stat card.</p>
                  ) : !rangeIsReady ? (
                    <p className={styles.note}>Loading stat card…</p>
                  ) : (
                    <p className={styles.note}>No stat line for this player in this range.</p>
                  )}
                </section>

                <AdvancedPanel leagueId={leagueId} playerId={playerId} isPitching={isPitching} />

                <section className={styles.newsSection}>
                  <h3 className={styles.sectionTitle}>News</h3>
                  {newsStatus === 'loading' ? (
                    <p className={styles.note}>Loading news…</p>
                  ) : newsStatus === 'error' ? (
                    <p className={styles.note}>Couldn&apos;t load news right now.</p>
                  ) : news.length === 0 ? (
                    <p className={styles.note}>No recent news.</p>
                  ) : (
                    <ul className={styles.newsList}>
                      {news.map((item) => (
                        <NewsRow key={item.id} item={item} />
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}

            {!isCompact || compactView === 'chart' ? (
              <div className={styles.rightCol}>
                <h3 className={styles.sectionTitle}>Recent form (percentile)</h3>
                <div className={styles.chartArea}>
                  {hasTrend ? (
                    <PlayerTrendChart
                      rows={metricTrend.rows}
                      seasonBaseline={metricTrend.seasonBaseline}
                      players={trendSeries}
                      metricLabel={target.fullName}
                      colorMap={colorMap}
                      fillHeight
                      hideAvatars
                    />
                  ) : trendSeries.length === 0 ? (
                    <p className={styles.note}>Select a metric to chart.</p>
                  ) : trend.status === 'error' ? (
                    <p className={styles.note}>Couldn&apos;t load the recent-form trend.</p>
                  ) : trend.status === 'ready' ? (
                    <p className={styles.note}>No recent-form data yet.</p>
                  ) : (
                    <ChartLoading verbs={['Reading the box scores', 'Charting recent form']} />
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {narrow ? null : (
          <div
            className={styles.resizeHandle}
            onMouseDown={startResize}
            title="Drag to resize"
            aria-hidden="true"
          />
        )}
      </div>
    </>
  );
}

/**
 * Floating layer of player cards. Up to five cards can be open at once (see MAX_PLAYER_CARDS),
 * each draggable by its top bar and closed by its own X - there is deliberately NO click-out
 * dismiss, so the rest of the app stays interactive and more cards can be opened alongside.
 * Escape closes the front-most card.
 */
export function PlayerFocusModal() {
  const { targets, closePlayerFocus } = usePlayerFocus();

  useEffect(() => {
    if (targets.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePlayerFocus(targets[targets.length - 1]!.playerId);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [targets, closePlayerFocus]);

  if (targets.length === 0) return null;

  return (
    <div className={styles.layer}>
      {targets.map((target, i) => (
        <PlayerFocusCard key={target.playerId} target={target} index={i} />
      ))}
    </div>
  );
}
