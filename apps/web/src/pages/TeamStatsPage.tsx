import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type {
  LeagueSummary,
  LeagueTeamStatsResponse,
  StatValue,
  TeamStatBucket,
  TeamStatWindow,
} from '@fcm/contracts';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { themeQuartz, type ColDef, type GetRowIdParams, type GridApi } from 'ag-grid-community';
import { getLeagueTeamStats } from '../api/client';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PercentileHeatCell, type StatCellContext } from '../components/PercentileHeatCell';
import { StatsGridHelp } from '../components/StatsGridHelp';
import { PickemFilter } from '../components/PickemFilter';
import { CompareGuide } from '../components/CompareGuide';
import { CompareEntitiesDialog } from '../components/CompareEntitiesDialog';
import { TeamTrendChart } from '../components/charts/TeamTrendChart';
import { CompareMetricsPanel } from '../components/charts/CompareMetricsPanel';
import type { CompareEntity, CompareEntityOption } from '../components/charts/compareEntity';
import { ChartLoading } from '../components/charts/ChartLoading';
import { ChartControlsPanel } from '../components/charts/ChartControlsPanel';
import { buildTeamColorMap } from '../components/charts/palette';
import { GRID_FILTER_PARAMS } from '../lib/gridFilterParams';
import { buildStatPercentiles, buildStatRanks } from '../lib/percentile';
import {
  buildTrendSeries,
  fetchTrailingWeeks,
  toNumericValue,
  TREND_WEEK_COUNT,
  type TrendRow,
} from '../lib/teamTrend';
import chartStyles from '../components/charts/charts.module.css';
import styles from '../components/dataTable.module.css';
import gridStyles from './StatsPage.module.css';

type Tab = 'batting' | 'pitching';

/** Flat per-team grid row: fixed meta fields plus one numeric + one display value per stat. */
type TeamStatRow = Record<string, string | number | null>;

/** One team's stat line (element of the response's teams array). */
type TeamStatLine = LeagueTeamStatsResponse['teams'][number];

/** The bucket the initial resource is loaded for (see useFirstLeagueResource). */
const INITIAL_BUCKET: TeamStatBucket = 'season';

/** How many of the grid's current top rows the "compare" grouped chart plots. */
const COMPARE_LIMIT = 12;

/** Multi-week helper windows, shown as quick badges once the league has enough weeks. */
const WINDOW_BADGES: { value: TeamStatWindow; label: string; minWeeks: number }[] = [
  { value: 'last2weeks', label: 'Last 2 wks', minWeeks: 2 },
  { value: 'last3weeks', label: 'Last 3 wks', minWeeks: 3 },
  { value: 'last4weeks', label: 'Last 4 wks', minWeeks: 4 },
];

/** Serialize a bucket for the refetch dedupe key (weeks are numbers, plus string buckets). */
function bucketKey(bucket: TeamStatBucket): string {
  return String(bucket);
}

/** The league's current fantasy week (last entry in start_week..current_week). */
function currentWeek(weeks: number[]): number | undefined {
  return weeks.length > 0 ? weeks[weeks.length - 1] : undefined;
}

/** Label for a selectable week in the dropdown and coverage summary. */
function weekLabel(week: number, weeks: number[]): string {
  return week === currentWeek(weeks) ? 'This Week' : `Week ${week}`;
}

/** Human summary of the coverage the currently-loaded data represents. */
function coverageLabel(data: LeagueTeamStatsResponse): string {
  if (typeof data.bucket === 'number') return weekLabel(data.bucket, data.weeks);
  if (data.bucket === 'season') return 'Full season';
  const weeks = data.aggregatedWeeks ?? [];
  if (weeks.length === 0) return 'Full season';
  return `Weeks ${weeks[0]}\u2013${weeks[weeks.length - 1]} combined`;
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

export function TeamStatsPage() {
  const state = useFirstLeagueResource(getLeagueTeamStats);

  if (state.status !== 'ready') {
    return <LeagueResourceNotice status={state.status} />;
  }
  return <TeamStatsView initial={state.data} league={state.league} />;
}

function TeamStatsView({
  initial,
  league,
}: {
  initial: LeagueTeamStatsResponse;
  league: LeagueSummary;
}) {
  const [tab, setTab] = useState<Tab>('batting');
  const [bucket, setBucket] = useState<TeamStatBucket>(INITIAL_BUCKET);
  const [data, setData] = useState<LeagueTeamStatsResponse>(initial);
  const [statsLoading, setStatsLoading] = useState(false);
  const apiRef = useRef<GridApi<TeamStatRow> | null>(null);

  // The grid's current top rows (respecting sort + filter) feed the grouped "compare"
  // chart. Refreshed on any model change so the chart tracks whatever is on top.
  const [topRowIds, setTopRowIds] = useState<string[]>([]);
  const [showCompareDialog, setShowCompareDialog] = useState(false);
  const syncTopRows = () => {
    const api = apiRef.current;
    if (!api) return;
    const ids: string[] = [];
    const count = Math.min(COMPARE_LIMIT, api.getDisplayedRowCount());
    for (let i = 0; i < count; i++) {
      const id = api.getDisplayedRowAtIndex(i)?.data?.teamId;
      if (id != null) ids.push(String(id));
    }
    // Keep the same reference when nothing changed, so downstream memos don't churn.
    setTopRowIds((prev) =>
      prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids,
    );
  };

  // Refetch when the selected bucket changes. The initial (season) bucket is already
  // loaded, so skip that first fetch to avoid a duplicate request on mount.
  const loadedBucket = useRef<string>(bucketKey(INITIAL_BUCKET));
  useEffect(() => {
    if (bucketKey(bucket) === loadedBucket.current) return;
    let stale = false;
    setStatsLoading(true);
    getLeagueTeamStats(league.leagueId, bucket)
      .then((res) => {
        if (!stale) {
          setData(res);
          loadedBucket.current = bucketKey(bucket);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) setStatsLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [league.leagueId, bucket]);

  // H/AB is a raw hits-over-at-bats display column, not a scoring category we chart or
  // rank, so drop it from both the grid and the metric options. Memoized to keep the
  // reference stable for the row/percentile/column memos below.
  const columns = useMemo(
    () =>
      (tab === 'batting' ? data.battingColumns : data.pitchingColumns).filter(
        (c) => c.label.trim().toUpperCase() !== 'H/AB',
      ),
    [tab, data.battingColumns, data.pitchingColumns],
  );

  const rows = useMemo<TeamStatRow[]>(() => {
    return data.teams.map((team) => {
      const row: TeamStatRow = {
        teamId: team.teamId,
        teamName: team.teamName,
        logoUrl: team.logoUrl ?? null,
      };
      const byKey = new Map(team.stats.map((s) => [s.key, s.value]));
      for (const col of columns) {
        const raw = byKey.get(col.key);
        row[col.key] = toNumericValue(raw);
        row[`${col.key}__d`] = toDisplay(raw);
      }
      return row;
    });
  }, [data.teams, columns]);

  const percentiles = useMemo(
    () => buildStatPercentiles(rows, columns, tab === 'pitching'),
    [rows, columns, tab],
  );

  const ranks = useMemo(
    () => buildStatRanks(rows, columns, tab === 'pitching'),
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

  // The grid's current top rows resolved back to team lines, in displayed order, for the
  // grouped "compare" card. Ranked against the whole pool via `percentiles` above.
  const compareTeams = useMemo<TeamStatLine[]>(() => {
    const byId = new Map(data.teams.map((t) => [t.teamId, t]));
    return topRowIds
      .map((id) => byId.get(id))
      .filter((t): t is TeamStatLine => Boolean(t));
  }, [topRowIds, data.teams]);
  const canCompare = compareTeams.length >= 1;
  const compareCardRef = useRef<HTMLElement | null>(null);

  // Compare set as generic entities for the shared grouped chart + tiles footer.
  const compareEntities = useMemo<CompareEntity[]>(
    () =>
      compareTeams.map((t) => ({
        id: t.teamId,
        name: t.teamName,
        kind: 'team' as const,
        stats: t.stats,
        ...(t.logoUrl ? { imageUrl: t.logoUrl } : {}),
      })),
    [compareTeams],
  );

  // Richer options for the friendly Compare teams dialog.
  const compareDialogOptions = useMemo<CompareEntityOption[]>(
    () =>
      data.teams.map((t) => ({
        id: t.teamId,
        name: t.teamName,
        kind: 'team' as const,
        ...(t.logoUrl ? { imageUrl: t.logoUrl } : {}),
      })),
    [data.teams],
  );

  // Friendly "Compare teams" flow: filter the grid to the chosen teams (via the Team
  // column's pick-em model); the always-on compare card then tracks them.
  const runCompareForTeams = (ids: string[]) => {
    const api = apiRef.current;
    setShowCompareDialog(false);
    if (!api || ids.length === 0) return;
    const byId = new Map(data.teams.map((t) => [t.teamId, t]));
    const names = ids
      .map((id) => byId.get(id)?.teamName)
      .filter((n): n is string => Boolean(n));
    if (names.length === 0) return;
    api.setFilterModel({ ...api.getFilterModel(), teamName: names });
    requestAnimationFrame(() =>
      compareCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const isNarrow = useIsNarrow();

  const columnDefs = useMemo<ColDef<TeamStatRow>[]>(() => {
    const base: ColDef<TeamStatRow>[] = [
      {
        headerName: 'Team',
        field: 'teamName',
        minWidth: isNarrow ? 140 : 200,
        flex: 2,
        ...(isNarrow ? { pinned: 'left' as const } : {}),
        cellRenderer: TeamCell,
        tooltipField: 'teamName',
        filter: PickemFilter,
      },
    ];
    const statCols: ColDef<TeamStatRow>[] = columns.map((col) => ({
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
  }, [columns, isNarrow]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: true,
      resizable: !isNarrow,
      filterParams: GRID_FILTER_PARAMS,
    }),
    [isNarrow],
  );

  // --- Trend chart: single-metric selector. Compare uses all metrics (grouped). ---
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  // Fall back to the first column of the active tab when the picked metric isn't in it
  // (e.g. after switching Batting <-> Pitching), without needing a reset effect.
  const effectiveMetric = columns.some((c) => c.key === selectedMetric)
    ? selectedMetric
    : (columns[0]?.key ?? '');
  const metricColumn = columns.find((c) => c.key === effectiveMetric);
  // Charts read like prose ("Saves"), so prefer Yahoo's full stat name (description)
  // over the terse grid abbreviation (label, e.g. "SV").
  const metricLabel = metricColumn?.description ?? metricColumn?.label ?? effectiveMetric;

  // Compare chart shows every metric by default (grouped bars); users can hide some here.
  const [hiddenMetrics, setHiddenMetrics] = useState<ReadonlySet<string>>(new Set());
  const toggleMetric = (key: string) =>
    setHiddenMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Double-click a metric chip: isolate it (hide every other metric).
  const isolateMetric = (key: string) =>
    setHiddenMetrics(new Set(columns.filter((c) => c.key !== key).map((c) => c.key)));
  const compareColumns = useMemo(
    () => columns.filter((c) => !hiddenMetrics.has(c.key)),
    [columns, hiddenMetrics],
  );

  const colorMap = useMemo(() => buildTeamColorMap(data.teams.map((t) => t.teamId)), [data.teams]);
  const chartTeams = useMemo(
    () => data.teams.map((t) => ({ teamId: t.teamId, teamName: t.teamName })),
    [data.teams],
  );

  // Team visibility for the trend chart: clicking a chip adds/removes a team's line.
  // (The compare card is driven by the grid's top rows instead.)
  const [hiddenTeams, setHiddenTeams] = useState<ReadonlySet<string>>(new Set());
  const toggleTeam = (teamId: string) => {
    setHiddenTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };
  // Double-click a badge: isolate that team (hide every other team in the trend chart).
  const soloTeam = (teamId: string) =>
    setHiddenTeams(new Set(data.teams.filter((t) => t.teamId !== teamId).map((t) => t.teamId)));
  const visibleChartTeams = useMemo(
    () => chartTeams.filter((t) => !hiddenTeams.has(t.teamId)),
    [chartTeams, hiddenTeams],
  );

  // Trend: fetch the trailing weeks once, lazily, when the section scrolls into view.
  // Weeks are constant per league across buckets, so this never refetches after the
  // first reveal. Requests are silent read-only GETs (see teamTrend.ts cost note).
  const hasWeeks = data.weeks.length > 0;
  const [trendResponses, setTrendResponses] = useState<LeagueTeamStatsResponse[] | null>(null);
  const trendSectionRef = useRef<HTMLElement | null>(null);
  const trendRequested = useRef(false);
  // Charts region: the floating controls icon reveals only while this is on screen.
  const chartsSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasWeeks) return;
    const el = trendSectionRef.current;
    if (!el) return;
    const weeks = data.weeks;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || trendRequested.current) return;
        trendRequested.current = true;
        fetchTrailingWeeks(league.leagueId, weeks)
          .then((res) => setTrendResponses(res))
          .catch(() => setTrendResponses([]));
      },
      { rootMargin: '160px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasWeeks, league.leagueId, data.weeks]);

  const trendRows = useMemo<TrendRow[]>(
    () =>
      trendResponses
        ? buildTrendSeries(trendResponses, effectiveMetric, currentWeek(data.weeks))
        : [],
    [trendResponses, effectiveMetric, data.weeks],
  );

  const jumpTo = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section>
      <CompareGuide noun="team" seenKey="fcm.compareTeamsGuideSeen.v1" />
      <CompareEntitiesDialog
        open={showCompareDialog}
        onClose={() => setShowCompareDialog(false)}
        options={compareDialogOptions}
        max={COMPARE_LIMIT}
        noun="team"
        onCompare={runCompareForTeams}
      />
      <div className={styles.page__header}>
        <div>
          <h1>Analyze League</h1>
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
          {hasWeeks && (
            <a className={gridStyles.jumpBadge} href="#trends" onClick={jumpTo('trends')}>
              Trend
            </a>
          )}
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
            Batting
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pitching'}
            className={`${styles.tab}${tab === 'pitching' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => setTab('pitching')}
          >
            Pitching
          </button>
        </div>
        <CoverageControls
          bucket={bucket}
          setBucket={setBucket}
          weeks={data.weeks}
          idPrefix="team-stats"
        />
      </div>

      <p className={styles.coverageHint} aria-live="polite">
        {coverageLabel(data)}
      </p>

      <div id="table" className={`${styles.tableCard} ${gridStyles.scrollAnchor}`}>
        <div className={gridStyles.tableCardTitleRow}>
          <h2 className={`${styles.tableCardTitle} ${gridStyles.tableCardTitleInRow}`}>
            {tab === 'batting' ? 'Batting' : 'Pitching'}
          </h2>
          <StatsGridHelp scope="teams" />
          <button
            type="button"
            className={gridStyles.comparePlayersBtn}
            onClick={() => setShowCompareDialog(true)}
            title="Search teams and compare them"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1" y="8" width="3" height="7" rx="0.5" />
              <rect x="6.5" y="4" width="3" height="11" rx="0.5" />
              <rect x="12" y="1" width="3" height="14" rx="0.5" />
            </svg>
            Compare teams
          </button>
        </div>
        <div className={gridStyles.gridWrap}>
          <AgGridReact<TeamStatRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            context={context}
            getRowId={(p: GetRowIdParams<TeamStatRow>) => String(p.data.teamId)}
            onGridReady={(e) => {
              apiRef.current = e.api;
            }}
            onModelUpdated={syncTopRows}
            rowHeight={isNarrow ? 44 : undefined}
            animateRows
            suppressCellFocus
            tooltipShowDelay={300}
            overlayNoRowsTemplate={`<span class="ag-overlay-no-rows-center" style="color: var(--muted)">No teams found for this league.</span>`}
          />
        </div>
      </div>

      {columns.length > 0 && (
        <div className={gridStyles.chartsSection} ref={chartsSectionRef}>
          <ChartControlsPanel anchorRef={chartsSectionRef}>
            <div className={chartStyles.controlGroup}>
              <span className={chartStyles.controlGroupLabel}>Metrics (compare)</span>
              <p className={chartStyles.shortcutHint}>
                Click a metric to toggle, double-click to isolate
              </p>
              <div
                className={chartStyles.teamToggles}
                role="group"
                aria-label="Show or hide compare metrics"
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
                      {col.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={chartStyles.controlGroup}>
              <label className={chartStyles.controlGroupLabel} htmlFor="analyze-metric">
                Trend metric
              </label>
              <select
                id="analyze-metric"
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
              <span className={chartStyles.controlGroupLabel}>Range</span>
              <CoverageControls
                bucket={bucket}
                setBucket={setBucket}
                weeks={data.weeks}
                idPrefix="analyze"
              />
            </div>

            <div className={chartStyles.controlGroup}>
              <span className={chartStyles.controlGroupLabel}>Teams (trend)</span>
              <p className={chartStyles.shortcutHint}>
                Click a team to toggle, double-click to isolate
              </p>
              <div className={chartStyles.teamToggles} role="group" aria-label="Show or hide teams">
                <div className={chartStyles.teamToggleActions}>
                  <button
                    type="button"
                    className={chartStyles.teamToggleAction}
                    onClick={() => setHiddenTeams(new Set())}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    className={chartStyles.teamToggleAction}
                    onClick={() => setHiddenTeams(new Set(data.teams.map((t) => t.teamId)))}
                  >
                    None
                  </button>
                </div>
                {data.teams.map((t) => {
                  const hidden = hiddenTeams.has(t.teamId);
                  return (
                    <button
                      key={t.teamId}
                      type="button"
                      aria-pressed={!hidden}
                      title="Click to toggle, double-click to isolate"
                      className={`${chartStyles.teamChip}${hidden ? ` ${chartStyles.teamChipHidden}` : ''}`}
                      onClick={() => toggleTeam(t.teamId)}
                      onDoubleClick={() => soloTeam(t.teamId)}
                    >
                      <span
                        className={chartStyles.teamSwatch}
                        style={{ background: colorMap.get(t.teamId) }}
                      />
                      {t.teamName}
                    </button>
                  );
                })}
              </div>
            </div>
          </ChartControlsPanel>

          {canCompare && (
            <section
              id="compare"
              ref={compareCardRef}
              className={`${chartStyles.card} ${gridStyles.compareCard} ${gridStyles.scrollAnchor}`}
              aria-label="Team metric comparison"
            >
              <div className={chartStyles.header}>
                <div>
                  <h2 className={chartStyles.title}>Comparing {compareTeams.length} teams</h2>
                  <p className={chartStyles.subtitle}>
                    Percentile among league teams &middot; {coverageLabel(data)} &middot;{' '}
                    {compareColumns.length} of {columns.length} metrics
                  </p>
                </div>
              </div>
              {compareColumns.length === 0 ? (
                <p className={chartStyles.empty}>Pick at least one metric in chart controls.</p>
              ) : (
                <div className={chartStyles.chartArea}>
                  {statsLoading && (
                    <div className={chartStyles.chartBusy} aria-hidden="true">
                      <span className={chartStyles.spinner} />
                    </div>
                  )}
                  <CompareMetricsPanel
                    entities={compareEntities}
                    columns={compareColumns}
                    percentiles={percentiles}
                    ranks={ranks}
                    exportTitle={`Comparing ${compareTeams.length} teams`}
                    exportSubtitle={`Percentile among league teams · ${coverageLabel(data)} · ${compareColumns.length} of ${columns.length} metrics`}
                    exportFilename="teams-compare"
                  />
                </div>
              )}
            </section>
          )}

          {hasWeeks && (
            <section
              id="trends"
              ref={trendSectionRef}
              className={`${chartStyles.card} ${gridStyles.scrollAnchor}`}
              aria-label={`${metricLabel} weekly trend`}
            >
              <div className={chartStyles.header}>
                <div>
                  <h2 className={chartStyles.title}>{metricLabel} trend</h2>
                  <p className={chartStyles.subtitle}>
                    Weekly totals, last {Math.min(TREND_WEEK_COUNT, data.weeks.length)} weeks
                  </p>
                </div>
              </div>
              {trendResponses === null ? (
                <ChartLoading weeks={Math.min(TREND_WEEK_COUNT, data.weeks.length)} />
              ) : (
                <TeamTrendChart
                  rows={trendRows}
                  teams={visibleChartTeams}
                  metricLabel={metricLabel}
                  colorMap={colorMap}
                />
              )}
            </section>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Coverage (range) picker: Season / trailing-window badges plus a specific-week select.
 * Rendered both in the page toolbar and the charts control bar, bound to the same
 * `bucket` state so changing it in either place reflects across the whole view.
 */
function CoverageControls({
  bucket,
  setBucket,
  weeks,
  idPrefix,
}: {
  bucket: TeamStatBucket;
  setBucket: (bucket: TeamStatBucket) => void;
  weeks: number[];
  idPrefix: string;
}) {
  const weekId = `${idPrefix}-week`;
  return (
    <div className={styles.coverageControls}>
      {weeks.length > 0 && (
        <div className={styles.weekField}>
          <label className={styles.fieldLabel} htmlFor={weekId}>
            Or a specific week
          </label>
          <select
            id={weekId}
            className={styles.select}
            value={typeof bucket === 'number' ? String(bucket) : ''}
            onChange={(e) => {
              if (e.target.value) setBucket(Number(e.target.value));
            }}
          >
            <option value="" disabled>
              Pick a week…
            </option>
            {weeks.map((week) => (
              <option key={week} value={week}>
                {weekLabel(week, weeks)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className={styles.rangeToggle} role="group" aria-label="Coverage">
        <button
          type="button"
          className={bucket === 'season' ? styles.rangeButtonActive : styles.rangeButton}
          aria-pressed={bucket === 'season'}
          onClick={() => setBucket('season')}
        >
          Season
        </button>
        {WINDOW_BADGES.filter((w) => weeks.length >= w.minWeeks).map((w) => (
          <button
            key={w.value}
            type="button"
            className={bucket === w.value ? styles.rangeButtonActive : styles.rangeButton}
            aria-pressed={bucket === w.value}
            onClick={() => setBucket(w.value)}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Fantasy team cell: logo avatar + team name. */
function TeamCell(params: CustomCellRendererProps) {
  const data = params.data as TeamStatRow;
  const teamName = String(data.teamName ?? '');
  const logoUrl = data.logoUrl as string | null;
  return (
    <span className={styles.playerCellInner}>
      <EntityAvatar label={teamName} {...(logoUrl ? { imageUrl: logoUrl } : {})} />
      <span className={styles.playerName}>{teamName}</span>
    </span>
  );
}

/** The raw text to display for a stat value ("-" is Yahoo's own missing placeholder). */
function toDisplay(value: StatValue['value'] | undefined): string {
  if (value === undefined) return '-';
  return String(value);
}
