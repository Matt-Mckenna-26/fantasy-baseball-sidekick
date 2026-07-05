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
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PercentileHeatCell, type StatCellContext } from '../components/PercentileHeatCell';
import { StatsGridHelp } from '../components/StatsGridHelp';
import { TeamPickemFilter } from '../components/TeamPickemFilter';
import { TeamComparisonChart } from '../components/charts/TeamComparisonChart';
import { TeamTrendChart } from '../components/charts/TeamTrendChart';
import { ChartLoading } from '../components/charts/ChartLoading';
import { ChartControlsPanel } from '../components/charts/ChartControlsPanel';
import { buildTeamColorMap } from '../components/charts/palette';
import { buildStatPercentiles, isLowerBetter } from '../lib/percentile';
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

/** The bucket the initial resource is loaded for (see useFirstLeagueResource). */
const INITIAL_BUCKET: TeamStatBucket = 'season';

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

  const context = useMemo<StatCellContext>(
    () => ({ percentiles, statsLoading }),
    [percentiles, statsLoading],
  );

  // Percentiles depend on the whole pool, so a new lookup must repaint every cell.
  useEffect(() => {
    apiRef.current?.refreshCells({ force: true });
  }, [percentiles]);

  const columnDefs = useMemo<ColDef<TeamStatRow>[]>(() => {
    const base: ColDef<TeamStatRow>[] = [
      {
        headerName: 'Team',
        field: 'teamName',
        minWidth: 200,
        flex: 2,
        cellRenderer: TeamCell,
        tooltipField: 'teamName',
        filter: TeamPickemFilter,
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
  }, [columns]);

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, filter: true, resizable: true }),
    [],
  );

  // --- Charts: metric selector shared by the comparison + trend visualizations. ---
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  // Fall back to the first column of the active tab when the picked metric isn't in it
  // (e.g. after switching Batting <-> Pitching), without needing a reset effect.
  const effectiveMetric = columns.some((c) => c.key === selectedMetric)
    ? selectedMetric
    : (columns[0]?.key ?? '');
  const metricColumn = columns.find((c) => c.key === effectiveMetric);
  // Charts read like prose ("Saves"), so prefer Yahoo's full stat name (description)
  // over the terse grid abbreviation (label, e.g. "SV"). The short label still drives
  // the sort direction below, since isLowerBetter matches on the abbreviation set.
  const metricLabel = metricColumn?.description ?? metricColumn?.label ?? effectiveMetric;
  const metricLowerIsBetter = isLowerBetter(metricColumn?.label ?? '', tab === 'pitching');

  const colorMap = useMemo(() => buildTeamColorMap(data.teams.map((t) => t.teamId)), [data.teams]);
  const chartTeams = useMemo(
    () => data.teams.map((t) => ({ teamId: t.teamId, teamName: t.teamName })),
    [data.teams],
  );

  // Team visibility, shared by both charts so clicking a chip adds/removes a team
  // across the comparison bars and the trend lines at once.
  const [hiddenTeams, setHiddenTeams] = useState<ReadonlySet<string>>(new Set());
  const toggleTeam = (teamId: string) => {
    setHiddenTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };
  const visibleTeams = useMemo(
    () => data.teams.filter((t) => !hiddenTeams.has(t.teamId)),
    [data.teams, hiddenTeams],
  );
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
              <label className={chartStyles.controlGroupLabel} htmlFor="analyze-metric">
                Metric
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
              <span className={chartStyles.controlGroupLabel}>Teams</span>
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
                      className={`${chartStyles.teamChip}${hidden ? ` ${chartStyles.teamChipHidden}` : ''}`}
                      onClick={() => toggleTeam(t.teamId)}
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

          <section
            id="compare"
            className={`${chartStyles.card} ${gridStyles.scrollAnchor}`}
            aria-label={`${metricLabel} comparison`}
          >
            <div className={chartStyles.header}>
              <div>
                <h2 className={chartStyles.title}>{metricLabel} by team</h2>
                <p className={chartStyles.subtitle}>{coverageLabel(data)}</p>
              </div>
            </div>
            <div className={chartStyles.chartArea}>
              {statsLoading && (
                <div className={chartStyles.chartBusy} aria-hidden="true">
                  <span className={chartStyles.spinner} />
                </div>
              )}
              <TeamComparisonChart
                teams={visibleTeams}
                metricKey={effectiveMetric}
                metricLabel={metricLabel}
                lowerIsBetter={metricLowerIsBetter}
                colorMap={colorMap}
              />
            </div>
          </section>

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
