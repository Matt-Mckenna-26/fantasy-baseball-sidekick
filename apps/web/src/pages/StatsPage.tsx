import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type {
  LeagueSummary,
  PlayerStatLine,
  PlayerStatsResponse,
  StatRange,
  StatValue,
} from '@fcm/contracts';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { themeQuartz, type ColDef, type GetRowIdParams, type GridApi } from 'ag-grid-community';
import { getPlayerStats } from '../api/client';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PercentileHeatCell, type StatCellContext } from '../components/PercentileHeatCell';
import { StatsGridHelp } from '../components/StatsGridHelp';
import { TeamPickemFilter } from '../components/TeamPickemFilter';
import { ChartControlsPanel } from '../components/charts/ChartControlsPanel';
import { ChartLoading } from '../components/charts/ChartLoading';
import { PlayerComparisonChart } from '../components/charts/PlayerComparisonChart';
import { PlayerTrendChart } from '../components/charts/PlayerTrendChart';
import { PlayerTrendHelp } from '../components/charts/PlayerTrendHelp';
import { PlayerPicker, type PlayerOption } from '../components/charts/PlayerPicker';
import { buildTeamColorMap } from '../components/charts/palette';
import { buildStatPercentiles, isLowerBetter } from '../lib/percentile';
import {
  buildPlayerTrendSeries,
  fetchPlayerTrendWindows,
  PLAYER_TREND_WINDOWS,
  type PlayerStatsByRange,
} from '../lib/playerTrend';
import chartStyles from '../components/charts/charts.module.css';
import styles from '../components/dataTable.module.css';
import gridStyles from './StatsPage.module.css';

type Tab = 'batting' | 'pitching';

/** Flat per-player grid row: fixed meta fields plus one numeric + one display value per stat. */
type StatRow = Record<string, string | number | null>;

const RANGES: { value: StatRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7' },
  { value: 'last30', label: 'Last 30' },
  { value: 'season', label: 'Season' },
];

/** The window the initial resource is loaded for (see useFirstLeagueResource). */
const INITIAL_RANGE: StatRange = 'season';

/** Max players charted at once, so the bars/lines stay readable. */
const PLAYER_CAP = 12;

/** How many top-ranked players seed the initial selection (and the "Top" preset). */
const DEFAULT_SELECT_COUNT = 10;

/** Human label for a range value, reused in the compare chart subtitle. */
function rangeLabel(range: StatRange): string {
  return RANGES.find((r) => r.value === range)?.label ?? 'Season';
}

/** The `count` best players by overall rank (unranked last), as player ids. */
function topByRank(players: PlayerStatLine[], count: number): string[] {
  return [...players]
    .sort((a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity))
    .slice(0, count)
    .map((p) => p.player.playerId);
}

/** Dark ag-grid theme tuned to the app's design tokens (styles.css). */
const gridTheme = themeQuartz.withParams({
  backgroundColor: '#1e293b',
  foregroundColor: '#e2e8f0',
  headerTextColor: '#94a3b8',
  headerBackgroundColor: '#1e293b',
  borderColor: '#334155',
  chromeBackgroundColor: '#1e293b',
  oddRowBackgroundColor: 'rgba(148, 163, 184, 0.04)',
  rowHoverColor: 'rgba(148, 163, 184, 0.08)',
  accentColor: '#7c3aed',
  fontFamily: 'inherit',
});

export function StatsPage() {
  const state = useFirstLeagueResource(getPlayerStats);

  if (state.status !== 'ready') {
    return <LeagueResourceNotice status={state.status} />;
  }
  return <StatsView initial={state.data} league={state.league} />;
}

function StatsView({ initial, league }: { initial: PlayerStatsResponse; league: LeagueSummary }) {
  const [tab, setTab] = useState<Tab>('batting');
  const [range, setRange] = useState<StatRange>(INITIAL_RANGE);
  const [cache, setCache] = useState<PlayerStatsByRange>(() => ({ [INITIAL_RANGE]: initial }));
  const [statsLoading, setStatsLoading] = useState(false);
  const apiRef = useRef<GridApi<StatRow> | null>(null);

  // Latest cache for effects that shouldn't re-run on every cache change (fetch guards).
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  // Data for the currently selected range, falling back to the season snapshot while a
  // new range loads. Every successful fetch is cached so the charts (and repeat visits
  // to a range) reuse it without re-requesting.
  const data = cache[range] ?? initial;

  // Fetch a range the first time it's needed. cacheRef keeps this from re-running when
  // the trend loader adds windows to the cache.
  useEffect(() => {
    if (cacheRef.current[range]) return;
    let stale = false;
    setStatsLoading(true);
    getPlayerStats(league.leagueId, range)
      .then((res) => {
        if (!stale) setCache((c) => ({ ...c, [range]: res }));
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) setStatsLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [league.leagueId, range]);

  const table = tab === 'batting' ? data.batting : data.pitching;

  // H/AB is a raw hits-over-at-bats display column (kept only in Rosters), not a scoring
  // category we grid, rank, or chart here, so drop it everywhere on this page.
  const columns = useMemo(
    () => table.columns.filter((c) => c.label.trim().toUpperCase() !== 'H/AB'),
    [table.columns],
  );

  const rows = useMemo<StatRow[]>(() => {
    return table.players.map((line) => {
      const row: StatRow = {
        playerId: line.player.playerId,
        fullName: line.player.fullName,
        mlbTeamAbbr: line.player.mlbTeamAbbr ?? null,
        headshotUrl: line.player.headshotUrl ?? null,
        owner: line.owner ?? null,
        ownerLogoUrl: line.ownerLogoUrl ?? null,
        overallRank: line.overallRank ?? null,
      };
      const byKey = new Map(line.stats.map((s) => [s.key, s.value]));
      for (const col of columns) {
        const raw = byKey.get(col.key);
        row[col.key] = toNumericValue(raw);
        row[`${col.key}__d`] = toDisplay(raw);
      }
      return row;
    });
  }, [table.players, columns]);

  const percentiles = useMemo(
    () => buildStatPercentiles(rows, columns, tab === 'pitching'),
    [rows, columns, tab],
  );

  const context = useMemo<StatCellContext>(
    () => ({ percentiles, statsLoading }),
    [percentiles, statsLoading],
  );

  // Percentiles depend on the whole pool, so a new lookup must repaint every cell.
  useEffect(() => {
    apiRef.current?.refreshCells({ force: true });
  }, [percentiles]);

  const columnDefs = useMemo<ColDef<StatRow>[]>(() => {
    const base: ColDef<StatRow>[] = [
      {
        headerName: 'Rank',
        field: 'overallRank',
        type: 'numericColumn',
        width: 96,
        headerTooltip: 'Overall season rank across the league player pool (lower is better)',
        cellRenderer: RankCell,
        comparator: rankComparator,
        sort: 'asc',
        filter: 'agNumberColumnFilter',
      },
      {
        headerName: 'Player',
        field: 'fullName',
        minWidth: 220,
        flex: 2,
        cellRenderer: PlayerCell,
        tooltipField: 'fullName',
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Team',
        field: 'owner',
        minWidth: 160,
        flex: 1,
        cellRenderer: OwnerCell,
        filter: TeamPickemFilter,
      },
    ];
    const statCols: ColDef<StatRow>[] = columns.map((col) => ({
      headerName: col.label,
      field: col.key,
      type: 'numericColumn',
      width: 92,
      ...(col.description ? { headerTooltip: col.description } : {}),
      cellRenderer: PercentileHeatCell,
      cellStyle: { padding: 0 },
      filter: 'agNumberColumnFilter',
    }));
    return [...base, ...statCols];
  }, [columns]);

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, filter: true, resizable: true }),
    [],
  );

  // --- Charts: metric + a per-tab player series shared by both visualizations. ---
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  // Default to Home Runs when available, else the first metric.
  const defaultMetric =
    columns.find((c) => c.label.trim().toUpperCase() === 'HR')?.key ?? columns[0]?.key ?? '';
  // Fall back to the default when the picked metric isn't in the active tab (e.g. after
  // switching Batters <-> Pitchers), without needing a reset effect.
  const effectiveMetric = columns.some((c) => c.key === selectedMetric)
    ? selectedMetric
    : defaultMetric;
  const metricColumn = columns.find((c) => c.key === effectiveMetric);
  // Charts read like prose ("Saves"), so prefer Yahoo's full stat name (description)
  // over the terse grid abbreviation (label). The short label still drives sort
  // direction, since isLowerBetter matches on the abbreviation set.
  const metricLabel = metricColumn?.description ?? metricColumn?.label ?? effectiveMetric;
  const metricLowerIsBetter = isLowerBetter(metricColumn?.label ?? '', tab === 'pitching');

  // Player series is kept per tab: batting and pitching categories don't overlap, so each
  // tab has its own set. Tiles are the sticky chips shown; `inactive` are the ones toggled
  // off. Only active tiles (tiles minus inactive) are charted. Seeded with the top few.
  const [tilesBatting, setTilesBatting] = useState<string[]>(() =>
    topByRank(initial.batting.players, DEFAULT_SELECT_COUNT),
  );
  const [tilesPitching, setTilesPitching] = useState<string[]>(() =>
    topByRank(initial.pitching.players, DEFAULT_SELECT_COUNT),
  );
  const [inactiveBatting, setInactiveBatting] = useState<ReadonlySet<string>>(new Set());
  const [inactivePitching, setInactivePitching] = useState<ReadonlySet<string>>(new Set());
  const tiles = tab === 'batting' ? tilesBatting : tilesPitching;
  const setTiles = tab === 'batting' ? setTilesBatting : setTilesPitching;
  const inactive = tab === 'batting' ? inactiveBatting : inactivePitching;
  const setInactive = tab === 'batting' ? setInactiveBatting : setInactivePitching;

  const activeIds = useMemo(() => tiles.filter((id) => !inactive.has(id)), [tiles, inactive]);

  const presetIds = useMemo(() => topByRank(table.players, DEFAULT_SELECT_COUNT), [table.players]);

  // --- Selection actions (tile lifecycle + active/inactive toggling). ---
  const addTile = (id: string) => {
    if (!tiles.includes(id)) setTiles([...tiles, id]);
    // New tile is active unless the charted set is already full, then it lands inactive.
    if (!tiles.includes(id) && activeIds.length >= PLAYER_CAP) {
      setInactive(new Set([...inactive, id]));
    }
  };
  const removeTile = (id: string) => {
    setTiles(tiles.filter((t) => t !== id));
    if (inactive.has(id)) {
      const next = new Set(inactive);
      next.delete(id);
      setInactive(next);
    }
  };
  const toggleTile = (id: string) => {
    if (inactive.has(id)) {
      if (activeIds.length >= PLAYER_CAP) return; // charted set full; leave it off
      const next = new Set(inactive);
      next.delete(id);
      setInactive(next);
    } else {
      setInactive(new Set([...inactive, id]));
    }
  };
  // Double-click a tile: isolate it (everything else in this tab goes inactive).
  const soloTile = (id: string) => setInactive(new Set(tiles.filter((t) => t !== id)));
  const clearTiles = () => {
    setTiles([]);
    setInactive(new Set());
  };
  const loadPreset = () => {
    setTiles(presetIds);
    setInactive(new Set());
  };

  const colorMap = useMemo(() => buildTeamColorMap(activeIds), [activeIds]);

  const playerOptions = useMemo<PlayerOption[]>(
    () =>
      [...table.players]
        .sort((a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity))
        .map((p) => ({
          id: p.player.playerId,
          name: p.player.fullName,
          ...(p.player.mlbTeamAbbr ? { abbr: p.player.mlbTeamAbbr } : {}),
        })),
    [table.players],
  );

  // Fantasy-team shortcuts: load one owner's players (rank-ordered, capped) as the series.
  const teamShortcuts = useMemo(() => {
    const ranked = [...table.players].sort(
      (a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity),
    );
    const byOwner = new Map<string, { owner: string; logoUrl?: string; ids: string[] }>();
    for (const p of ranked) {
      if (!p.owner) continue;
      const entry = byOwner.get(p.owner);
      if (entry) entry.ids.push(p.player.playerId);
      else
        byOwner.set(p.owner, {
          owner: p.owner,
          ...(p.ownerLogoUrl ? { logoUrl: p.ownerLogoUrl } : {}),
          ids: [p.player.playerId],
        });
    }
    return [...byOwner.values()].sort((a, b) => a.owner.localeCompare(b.owner));
  }, [table.players]);

  // Key of the loaded tiles, to highlight a team badge when its roster is loaded.
  const tilesKey = [...tiles].sort().join('|');

  // Active players' current-range lines for the comparison bars, in selection order.
  const selectedLines = useMemo(
    () =>
      activeIds
        .map((id) => table.players.find((p) => p.player.playerId === id))
        .filter((p): p is PlayerStatLine => Boolean(p)),
    [activeIds, table.players],
  );

  const trendPlayers = useMemo(
    () =>
      selectedLines.map((p) => ({
        id: p.player.playerId,
        name: p.player.fullName,
        ...(p.player.headshotUrl ? { headshotUrl: p.player.headshotUrl } : {}),
        ...(p.owner ? { owner: p.owner } : {}),
      })),
    [selectedLines],
  );

  // Trend: lazily load the Season/Last 30/Last 7 windows once the trend section nears
  // the viewport, reusing whatever ranges are already cached. Silent read-only GETs.
  const chartsSectionRef = useRef<HTMLDivElement | null>(null);
  const trendSectionRef = useRef<HTMLElement | null>(null);
  const trendRequested = useRef(false);

  useEffect(() => {
    const el = trendSectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || trendRequested.current) return;
        trendRequested.current = true;
        fetchPlayerTrendWindows(league.leagueId, cacheRef.current).then((merged) =>
          // Keep any ranges that loaded meanwhile; fill in the newly fetched windows.
          setCache((c) => ({ ...merged, ...c })),
        );
      },
      { rootMargin: '160px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [league.leagueId]);

  const trendReady = PLAYER_TREND_WINDOWS.every((w) => cache[w.range]);
  const trend = useMemo(
    () => buildPlayerTrendSeries(cache, tab, effectiveMetric, activeIds, tab === 'pitching'),
    [cache, tab, effectiveMetric, activeIds],
  );

  const jumpTo = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section>
      <div className={styles.page__header}>
        <div>
          <h1>Player Stats</h1>
          <EntityLabel
            label={league.name}
            className="muted"
            {...(league.logoUrl ? { imageUrl: league.logoUrl } : {})}
          />
        </div>
        <nav className={gridStyles.jumpBadges} aria-label="Jump to section">
          <a className={gridStyles.jumpBadge} href="#table" onClick={jumpTo('table')}>
            Table
          </a>
          <a className={gridStyles.jumpBadge} href="#compare" onClick={jumpTo('compare')}>
            Compare
          </a>
          <a className={gridStyles.jumpBadge} href="#trends" onClick={jumpTo('trends')}>
            Trend
          </a>
        </nav>
      </div>

      <div className={styles.tabToolbar}>
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'batting'}
            className={`${styles.tab}${tab === 'batting' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setTab('batting')}
          >
            Batters
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pitching'}
            className={`${styles.tab}${tab === 'pitching' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setTab('pitching')}
          >
            Pitchers
          </button>
        </div>
        <div className={styles.rangeToggle} role="group" aria-label="Stat range">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              className={r.value === range ? styles.rangeButtonActive : styles.rangeButton}
              aria-pressed={r.value === range}
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div id="table" className={`${styles.tableCard} ${gridStyles.scrollAnchor}`}>
        <div className={gridStyles.tableCardTitleRow}>
          <h2 className={`${styles.tableCardTitle} ${gridStyles.tableCardTitleInRow}`}>
            {tab === 'batting' ? 'Batters' : 'Pitchers'}
          </h2>
          <StatsGridHelp />
        </div>
        <div className={gridStyles.gridWrap}>
          <AgGridReact<StatRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            context={context}
            getRowId={(p: GetRowIdParams<StatRow>) => String(p.data.playerId)}
            onGridReady={(e) => {
              apiRef.current = e.api;
            }}
            animateRows
            suppressCellFocus
            tooltipShowDelay={300}
            overlayNoRowsTemplate={`<span class="ag-overlay-no-rows-center" style="color: var(--muted)">No ${
              tab === 'batting' ? 'batters' : 'pitchers'
            } on your roster.</span>`}
          />
        </div>
      </div>

      {columns.length > 0 && (
        <div className={gridStyles.chartsSection} ref={chartsSectionRef}>
          <ChartControlsPanel anchorRef={chartsSectionRef} seenKey="player-chart-controls-seen">
            <div className={chartStyles.controlGroup}>
              <label className={chartStyles.controlGroupLabel} htmlFor="player-metric">
                Metric
              </label>
              <select
                id="player-metric"
                className={styles.select}
                value={effectiveMetric}
                onChange={(e) => setSelectedMetric(e.target.value)}
              >
                {columns.map((col) => (
                  <option key={col.key} value={col.key}>
                    {col.description ?? col.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={chartStyles.controlGroup}>
              <span className={chartStyles.controlGroupLabel}>Range (compare)</span>
              <div className={styles.rangeToggle} role="group" aria-label="Compare range">
                {RANGES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={r.value === range ? styles.rangeButtonActive : styles.rangeButton}
                    aria-pressed={r.value === range}
                    onClick={() => setRange(r.value)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={chartStyles.controlGroup}>
              <span className={chartStyles.controlGroupLabel}>
                Players ({tab === 'batting' ? 'Batters' : 'Pitchers'})
              </span>
              {teamShortcuts.length > 0 && (
                <>
                  <p className={chartStyles.shortcutHint}>
                    Load a team&rsquo;s {tab === 'batting' ? 'batters' : 'pitchers'}
                  </p>
                  <div
                    className={chartStyles.teamToggles}
                    role="group"
                    aria-label="Load a fantasy team's players"
                  >
                    {teamShortcuts.map((t) => {
                      const active = t.ids.length > 0 && [...t.ids].sort().join('|') === tilesKey;
                      return (
                        <button
                          key={t.owner}
                          type="button"
                          aria-pressed={active}
                          className={`${chartStyles.teamChip}${active ? ` ${chartStyles.teamChipActive}` : ''}`}
                          // Load the whole roster as sticky tiles; chart the top `cap`,
                          // leave the rest as inactive tiles to toggle on individually.
                          onClick={() => {
                            setTiles(t.ids);
                            setInactive(new Set(t.ids.slice(PLAYER_CAP)));
                          }}
                        >
                          <EntityAvatar
                            label={t.owner}
                            {...(t.logoUrl ? { imageUrl: t.logoUrl } : {})}
                          />
                          {t.owner}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <PlayerPicker
                options={playerOptions}
                tiles={tiles}
                inactive={inactive}
                colorMap={colorMap}
                cap={PLAYER_CAP}
                presetCount={presetIds.length}
                onAdd={addTile}
                onRemove={removeTile}
                onToggle={toggleTile}
                onSolo={soloTile}
                onClear={clearTiles}
                onPreset={loadPreset}
              />
            </div>
          </ChartControlsPanel>

          <section
            id="compare"
            className={`${chartStyles.card} ${gridStyles.scrollAnchor}`}
            aria-label={`${metricLabel} comparison`}
          >
            <div className={chartStyles.header}>
              <div>
                <h2 className={chartStyles.title}>{metricLabel} by player</h2>
                <p className={chartStyles.subtitle}>{rangeLabel(range)}</p>
              </div>
            </div>
            <div className={chartStyles.chartArea}>
              {statsLoading && (
                <div className={chartStyles.chartBusy} aria-hidden="true">
                  <span className={chartStyles.spinner} />
                </div>
              )}
              {activeIds.length === 0 ? (
                <p className={chartStyles.empty}>Search and add players above to compare.</p>
              ) : (
                <PlayerComparisonChart
                  players={selectedLines}
                  metricKey={effectiveMetric}
                  metricLabel={metricLabel}
                  lowerIsBetter={metricLowerIsBetter}
                  colorMap={colorMap}
                />
              )}
            </div>
          </section>

          <section
            id="trends"
            ref={trendSectionRef}
            className={`${chartStyles.card} ${gridStyles.scrollAnchor}`}
            aria-label={`${metricLabel} recent form`}
          >
            <div className={chartStyles.header}>
              <div>
                <div className={gridStyles.tableCardTitleRow}>
                  <h2 className={`${chartStyles.title} ${gridStyles.tableCardTitleInRow}`}>
                    {metricLabel} recent form
                  </h2>
                  <PlayerTrendHelp />
                </div>
                <p className={chartStyles.subtitle}>
                  Percentile among rostered {tab === 'batting' ? 'batters' : 'pitchers'}; dashed line
                  is each player&rsquo;s season baseline
                </p>
              </div>
            </div>
            {activeIds.length === 0 ? (
              <p className={chartStyles.empty}>Search and add players above to see recent form.</p>
            ) : !trendReady ? (
              <ChartLoading
                verbs={['Pulling recent windows', 'Reading the box scores', 'Charting the trend']}
              />
            ) : (
              <PlayerTrendChart
                rows={trend.rows}
                seasonBaseline={trend.seasonBaseline}
                players={trendPlayers}
                metricLabel={metricLabel}
                colorMap={colorMap}
              />
            )}
          </section>
        </div>
      )}
    </section>
  );
}

/** Season overall-rank badge; unranked players show a muted dash. */
function RankCell(params: CustomCellRendererProps) {
  const value = params.value as number | null | undefined;
  if (value == null) return <span className={gridStyles.rankEmpty}>-</span>;
  return <span className={gridStyles.rankBadge}>{value}</span>;
}

/** Fantasy team cell: logo avatar + team name. */
function OwnerCell(params: CustomCellRendererProps) {
  const owner = params.value as string | null | undefined;
  if (!owner) return <span className={gridStyles.rankEmpty}>-</span>;
  const logoUrl = (params.data as StatRow).ownerLogoUrl as string | null;
  return (
    <span className={styles.playerCellInner}>
      <EntityAvatar label={owner} {...(logoUrl ? { imageUrl: logoUrl } : {})} />
      <span className={gridStyles.ownerName}>{owner}</span>
    </span>
  );
}

/** Player cell: headshot avatar + name with the MLB team abbr in muted parens. */
function PlayerCell(params: CustomCellRendererProps) {
  const data = params.data as StatRow;
  const fullName = String(data.fullName ?? '');
  const abbr = data.mlbTeamAbbr as string | null;
  const headshotUrl = data.headshotUrl as string | null;
  return (
    <span className={styles.playerCellInner}>
      <PlayerAvatar fullName={fullName} {...(headshotUrl ? { headshotUrl } : {})} />
      <span className={styles.playerName}>
        {fullName}
        {abbr ? <span className="muted"> ({abbr})</span> : null}
      </span>
    </span>
  );
}

/** Rank sort that keeps unranked players at the bottom in both directions. */
function rankComparator(
  a: number | null,
  b: number | null,
  _nodeA: unknown,
  _nodeB: unknown,
  isDescending: boolean,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return isDescending ? -1 : 1;
  if (b == null) return isDescending ? 1 : -1;
  return a - b;
}

/** Parse a Yahoo stat value to a sortable number, or null when unavailable. */
function toNumericValue(value: StatValue['value'] | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value === '-' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** The raw text to display for a stat value ("-" is Yahoo's own missing placeholder). */
function toDisplay(value: StatValue['value'] | undefined): string {
  if (value === undefined) return '-';
  return String(value);
}
