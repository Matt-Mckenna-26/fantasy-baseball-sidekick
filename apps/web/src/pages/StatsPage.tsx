import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  LeagueFreeAgentsResponse,
  LeagueSummary,
  PlayerStatLine,
  PlayerStatsResponse,
  StatRange,
} from '@fcm/contracts';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import {
  themeQuartz,
  type ColDef,
  type GetRowIdParams,
  type GridApi,
  type IRowNode,
  type RowClickedEvent,
} from 'ag-grid-community';
import { getAdvancedLeagueStats, getFreeAgents, getPlayerStats } from '../api/client';
import { useSession } from '../context/SessionContext';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerNameButton } from '../components/PlayerNameButton';
import { PercentileHeatCell, type StatCellContext } from '../components/PercentileHeatCell';
import { StatsGridHelp } from '../components/StatsGridHelp';
import { CompareGuide } from '../components/CompareGuide';
import { CompareEntitiesDialog } from '../components/CompareEntitiesDialog';
import { PickemFilter } from '../components/PickemFilter';
import { ChartControlsPanel } from '../components/charts/ChartControlsPanel';
import { ChartLoading } from '../components/charts/ChartLoading';
import { CompareMetricsPanel } from '../components/charts/CompareMetricsPanel';
import type { CompareEntity, CompareEntityOption } from '../components/charts/compareEntity';
import { PlayerTrendChart } from '../components/charts/PlayerTrendChart';
import { PlayerTrendHelp } from '../components/charts/PlayerTrendHelp';
import { PlayerPicker, type PlayerOption } from '../components/charts/PlayerPicker';
import { buildTeamColorMap } from '../components/charts/palette';
import { GRID_FILTER_PARAMS } from '../lib/gridFilterParams';
import { buildStatPercentiles, buildStatRanks } from '../lib/percentile';
import { scoringColumns, toCompareEntity, toStatRow, type StatRow } from '../lib/statPool';
import {
  buildPlayerTrendSeries,
  fetchFreeAgentTrendWindows,
  fetchPlayerTrendWindows,
  playerTrendWindows,
  type PlayerStatsByRange,
} from '../lib/playerTrend';
import chartStyles from '../components/charts/charts.module.css';
import styles from '../components/dataTable.module.css';
import gridStyles from './StatsPage.module.css';

type Tab = 'batting' | 'pitching';

const RANGES: { value: StatRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7' },
  { value: 'last14', label: 'Last 14' },
  { value: 'last30', label: 'Last 30' },
  { value: 'season', label: 'Season' },
];

/** The window the initial resource is loaded for (see useFirstLeagueResource). */
const INITIAL_RANGE: StatRange = 'season';

/** Max players charted at once, so the bars/lines stay readable. */
const PLAYER_CAP = 10;

/** How many of the grid's current top rows the "compare" grouped chart plots. */
const COMPARE_LIMIT = 10;

/** Stable empty table so the advanced view has a valid shape before its data loads. */
const EMPTY_TABLE: PlayerStatsResponse['batting'] = { columns: [], players: [] };

/** Which category set the grid/compare show: league scoring stats or MLB advanced/expected. */
type ColumnSet = 'scoring' | 'advanced';

/** How many top-ranked players seed the initial selection (and the "Top" preset). */
const DEFAULT_SELECT_COUNT = 10;

/** Max fantasy rosters loaded as tiles at once, for head-to-head team comparison. */
const MAX_TEAMS = 2;

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
  const { session } = useSession();
  // Last 14 is an MLB-source-only window; only offer it when the server advertises it.
  const supportsLast14 = session.status === 'connected' && session.supportsLast14;
  const visibleRanges = useMemo(
    () => RANGES.filter((r) => r.value !== 'last14' || supportsLast14),
    [supportsLast14],
  );
  const [tab, setTab] = useState<Tab>('batting');
  const [range, setRange] = useState<StatRange>(INITIAL_RANGE);
  const [columnSet, setColumnSet] = useState<ColumnSet>('scoring');
  const isAdvanced = columnSet === 'advanced';
  const [cache, setCache] = useState<PlayerStatsByRange>(() => ({ [INITIAL_RANGE]: initial }));
  const [statsLoading, setStatsLoading] = useState(false);
  // League-wide advanced/expected stats (season-only), fetched once when first switched on.
  const [advData, setAdvData] = useState<PlayerStatsResponse | undefined>(undefined);
  const [advError, setAdvError] = useState(false);
  const apiRef = useRef<GridApi<StatRow> | null>(null);

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
      const id = api.getDisplayedRowAtIndex(i)?.data?.playerId;
      if (id != null) ids.push(String(id));
    }
    // Keep the same reference when nothing changed, so the sync effect below doesn't churn.
    setTopRowIds((prev) =>
      prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids,
    );
  };

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

  // Fetch the league's advanced/expected table the first time the Advanced view is opened.
  useEffect(() => {
    if (!isAdvanced || advData) return;
    let stale = false;
    setAdvError(false);
    getAdvancedLeagueStats(league.leagueId)
      .then((res) => {
        if (!stale) setAdvData(res);
      })
      .catch(() => {
        if (!stale) setAdvError(true);
      });
    return () => {
      stale = true;
    };
  }, [isAdvanced, advData, league.leagueId]);

  // Active table: advanced view swaps in the expected-stat table (season-only, includes free
  // agents already); scoring view uses the selected range's window.
  const advTable = advData ? (tab === 'batting' ? advData.batting : advData.pitching) : undefined;
  const table = isAdvanced
    ? (advTable ?? EMPTY_TABLE)
    : tab === 'batting'
      ? data.batting
      : data.pitching;
  // Grid overlay + dimmed cells while the advanced table is still loading (not on error).
  const advPending = isAdvanced && !advData && !advError;

  // Free agents for the current window, fetched in parallel and merged into the grid so the
  // "Show FA only" filter and waiver scanning work without a separate view. Cached per range.
  const [faCache, setFaCache] = useState<Partial<Record<StatRange, LeagueFreeAgentsResponse>>>({});
  const faCacheRef = useRef(faCache);
  faCacheRef.current = faCache;
  useEffect(() => {
    if (faCacheRef.current[range]) return;
    let stale = false;
    getFreeAgents(league.leagueId, range, { silent: true })
      .then((res) => {
        if (!stale) setFaCache((c) => ({ ...c, [range]: res }));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [league.leagueId, range]);
  // The advanced table already folds in free agents, so its own players list is the pool; the
  // scoring view merges the per-range free-agent table below.
  const faTable = isAdvanced
    ? undefined
    : tab === 'batting'
      ? faCache[range]?.batting
      : faCache[range]?.pitching;

  // H/AB is a raw hits-over-at-bats display column (kept only in Rosters), not a scoring
  // category we grid, rank, or chart here, so drop it in the scoring view. Advanced columns
  // carry their own explicit set (and direction), so pass them straight through.
  const columns = useMemo(
    () => (isAdvanced ? table.columns : scoringColumns(table.columns)),
    [isAdvanced, table.columns],
  );

  // The default rank/percentile pool: rostered players only, so ranks stay stable and a free
  // agent shows where they'd slot in among rostered players (see poolRows for the FA-only case).
  const rosteredRows = useMemo<StatRow[]>(
    () => table.players.map((line) => toStatRow(line, columns)),
    [table.players, columns],
  );

  // Grid rows = rostered + free agents (deduped by playerId; rostered wins).
  const rows = useMemo<StatRow[]>(() => {
    if (!faTable) return rosteredRows;
    const seen = new Set(rosteredRows.map((r) => String(r.playerId)));
    const faRows = faTable.players
      .filter((line) => !seen.has(line.player.playerId))
      .map((line) => toStatRow(line, columns));
    return [...rosteredRows, ...faRows];
  }, [rosteredRows, faTable, columns]);

  // Chartable pool = rostered + free agents (deduped; rostered wins). Everything the charts,
  // picker, and Compare dialog resolve against reads from here, so a free agent that lands as
  // a grid top row (or is searched/added) is chartable just like a rostered player. Ranks and
  // percentiles come from the rostered-only pool by default (see poolRows), so a free agent
  // shows where they'd slot; the "Free agents only" filter widens that pool to include them.
  const chartPlayers = useMemo<PlayerStatLine[]>(() => {
    if (!faTable) return table.players;
    const seen = new Set(table.players.map((p) => p.player.playerId));
    return [...table.players, ...faTable.players.filter((line) => !seen.has(line.player.playerId))];
  }, [table.players, faTable]);

  // "Free agents only" filter toggle. Declared here (above the pool memos) because it also
  // selects which pool the ranks/percentiles rank against.
  const [faOnly, setFaOnly] = useState(false);

  // When scanning free agents only, rank/color against the full on-screen pool (rostered +
  // free agents) so the heat reflects the data set being shown. Otherwise use the rostered-
  // only pool, which keeps colors stable as free-agent data streams in after first paint.
  const poolRows = faOnly ? rows : rosteredRows;

  const percentiles = useMemo(
    () => buildStatPercentiles(poolRows, columns, tab === 'pitching'),
    [poolRows, columns, tab],
  );

  const ranks = useMemo(
    () => buildStatRanks(poolRows, columns, tab === 'pitching'),
    [poolRows, columns, tab],
  );

  const context = useMemo<StatCellContext>(
    () => ({
      percentiles,
      statsLoading: statsLoading || advPending,
      ...(faOnly ? { scopeSuffix: 'among rostered + free agents' } : {}),
    }),
    [percentiles, statsLoading, advPending, faOnly],
  );

  // Percentiles depend on the whole pool, so a new lookup must repaint every cell.
  useEffect(() => {
    apiRef.current?.refreshCells({ force: true });
  }, [percentiles]);

  // The grid's current top rows resolved back to stat lines, in displayed order, for the
  // grouped "compare" card. Ranked against the whole pool via `percentiles` above.
  const compareLines = useMemo(() => {
    const byId = new Map(chartPlayers.map((p) => [p.player.playerId, p]));
    return topRowIds.map((id) => byId.get(id)).filter((p): p is PlayerStatLine => Boolean(p));
  }, [topRowIds, chartPlayers]);
  const canCompare = compareLines.length >= 1;
  const compareCardRef = useRef<HTMLElement | null>(null);

  // Grid's compare set as generic entities for the shared grouped chart + tiles footer.
  const compareEntities = useMemo<CompareEntity[]>(
    () => compareLines.map(toCompareEntity),
    [compareLines],
  );

  // --- Free-agent filter + pinned focus row ---------------------------------------------
  const [searchParams] = useSearchParams();
  const [gridReady, setGridReady] = useState(false);
  // Covers the grid while a chat "Analyze players" deep-link filter is being applied.
  const [filteringAnalyzedPlayers, setFilteringAnalyzedPlayers] = useState(
    () => searchParams.get('players') != null,
  );
  const [focusPlayerId, setFocusPlayerId] = useState<string | null>(null);

  // Re-run the external (FA-only) filter whenever the toggle flips.
  useEffect(() => {
    apiRef.current?.onFilterChanged();
  }, [faOnly]);

  // The focused player pinned to the top row, so it stays visible while sorting/filtering
  // (e.g. scan the FA list against your guy). Looked up across rostered + FA rows.
  const pinnedTopRowData = useMemo<StatRow[] | undefined>(() => {
    if (!focusPlayerId) return undefined;
    const row = rows.find((r) => String(r.playerId) === focusPlayerId);
    return row ? [row] : undefined;
  }, [focusPlayerId, rows]);

  // playerId -> { display name, which tab } across BOTH rostered tables and free agents, so a
  // chat deep-link that mixes hitters and pitchers resolves every id (not just the active tab).
  const identityById = useMemo(() => {
    const map = new Map<string, { name: string; tab: Tab }>();
    const add = (lines: PlayerStatLine[], t: Tab) => {
      for (const line of lines) {
        if (!map.has(line.player.playerId)) {
          map.set(line.player.playerId, { name: line.player.fullName, tab: t });
        }
      }
    };
    add(data.batting.players, 'batting');
    add(data.pitching.players, 'pitching');
    const fa = faCache[range];
    if (fa) {
      add(fa.batting.players, 'batting');
      add(fa.pitching.players, 'pitching');
    }
    return map;
  }, [data, faCache, range]);

  // Mentioned players from a chat deep-link (?players=), split by position and kept in the
  // background so each tab holds its own filter - switching to Pitchers shows the mentioned
  // pitchers instead of an empty grid.
  const playersParam = searchParams.get('players');
  const deepLinkNames = useMemo(() => {
    if (!playersParam) return null;
    const ids = playersParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const batting: string[] = [];
    const pitching: string[] = [];
    for (const id of ids) {
      const hit = identityById.get(id);
      if (!hit) continue;
      (hit.tab === 'pitching' ? pitching : batting).push(hit.name);
    }
    return { ids, batting, pitching };
  }, [playersParam, identityById]);

  // Apply the deep-link once the grid is ready: open the tab that has mentioned players and
  // filter it to them, and pin ?focus=. Waits one beat for free agents if some ids are still
  // unresolved (they may be loading), so mixed FA/rostered links resolve fully.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (playersParam) {
      deepLinkApplied.current = false;
      setFilteringAnalyzedPlayers(true);
    } else {
      setFilteringAnalyzedPlayers(false);
    }
  }, [playersParam]);

  useEffect(() => {
    if (deepLinkApplied.current || !gridReady) return;
    const api = apiRef.current;
    if (!api) return;
    if (deepLinkNames) {
      const faReady = faCache[range] !== undefined;
      const resolved = deepLinkNames.batting.length + deepLinkNames.pitching.length;
      if (resolved < deepLinkNames.ids.length && !faReady) return;
      const startTab: Tab =
        deepLinkNames.batting.length === 0 && deepLinkNames.pitching.length > 0
          ? 'pitching'
          : 'batting';
      if (startTab !== tab) setTab(startTab);
      api.setFilterModel({ ...api.getFilterModel(), fullName: deepLinkNames[startTab] });
      requestAnimationFrame(() => setFilteringAnalyzedPlayers(false));
    }
    const focusParam = searchParams.get('focus');
    if (focusParam && identityById.has(focusParam)) setFocusPlayerId(focusParam);
    deepLinkApplied.current = true;
  }, [gridReady, deepLinkNames, faCache, range, searchParams, identityById, tab]);

  // After arriving from a chat deep-link, re-apply the active tab's mentioned players whenever
  // the user switches tabs, so the per-position selection persists in the background.
  useEffect(() => {
    if (!deepLinkApplied.current || !deepLinkNames) return;
    const api = apiRef.current;
    if (!api) return;
    api.setFilterModel({ ...api.getFilterModel(), fullName: deepLinkNames[tab] });
  }, [tab, deepLinkNames]);

  const handleRowClicked = (e: RowClickedEvent<StatRow>) => {
    if (e.node.rowPinned) {
      setFocusPlayerId(null); // click the pinned row to unpin
      return;
    }
    const id = e.data?.playerId;
    if (id != null) setFocusPlayerId((cur) => (cur === String(id) ? null : String(id)));
  };

  // Friendly "Compare players" flow: filter the grid to the chosen players (via the Player
  // column's pick-em model); the always-on compare card then tracks them. No column controls.
  const runCompareForPlayers = (ids: string[]) => {
    const api = apiRef.current;
    setShowCompareDialog(false);
    if (!api || ids.length === 0) return;
    const byId = new Map(chartPlayers.map((p) => [p.player.playerId, p]));
    const names = ids
      .map((id) => byId.get(id)?.player.fullName)
      .filter((n): n is string => Boolean(n));
    if (names.length === 0) return;
    api.setFilterModel({ ...api.getFilterModel(), fullName: names });
    // Bring the compare card into view once the grid has re-filtered.
    requestAnimationFrame(() =>
      compareCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  };

  const isNarrow = useIsNarrow();

  const columnDefs = useMemo<ColDef<StatRow>[]>(() => {
    const pinMeta = !isNarrow;
    const base: ColDef<StatRow>[] = [
      {
        headerName: 'Rank',
        field: 'overallRank',
        type: 'numericColumn',
        width: 88,
        ...(pinMeta ? { pinned: 'left' as const } : {}),
        headerTooltip: 'Overall season rank across the league player pool (lower is better)',
        cellRenderer: RankCell,
        comparator: rankComparator,
        sort: 'asc',
        filter: 'agNumberColumnFilter',
      },
      {
        headerName: 'Value+',
        field: 'sgptPlus',
        type: 'numericColumn',
        width: 96,
        ...(pinMeta ? { pinned: 'left' as const } : {}),
        headerTooltip:
          'Value+: overall fantasy value from percentiles across the league scoring categories. 100 = league average, higher is better; the rank spans both hitters and pitchers.',
        cellRenderer: SgptCell,
        comparator: rankComparator,
        filter: 'agNumberColumnFilter',
      },
      {
        headerName: 'Pos',
        field: 'position',
        width: 88,
        ...(pinMeta ? { pinned: 'left' as const } : {}),
        headerTooltip: 'Eligible / display position (filter e.g. SP, RP, 2B)',
        filter: PickemFilter,
        filterParams: { tokenize: true },
      },
      {
        headerName: 'Player',
        field: 'fullName',
        minWidth: isNarrow ? 140 : 200,
        flex: 2,
        pinned: 'left',
        cellRenderer: PlayerCell,
        tooltipField: 'fullName',
        filter: PickemFilter,
        filterParams: { searchable: true, searchPlaceholder: 'Search players\u2026' },
      },
      {
        headerName: 'Team',
        field: 'owner',
        minWidth: isNarrow ? 120 : 160,
        flex: 1,
        cellRenderer: OwnerCell,
        filter: PickemFilter,
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
  // Trend chart reads like prose ("Saves"), so prefer Yahoo's full stat name (description)
  // over the terse grid abbreviation (label).
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

  const presetIds = useMemo(() => topByRank(chartPlayers, DEFAULT_SELECT_COUNT), [chartPlayers]);

  // Seed the chart's player series from the grid's current top rows (the "compare" set)
  // and keep it in sync as the grid is sorted/filtered. Users can still tweak via the
  // picker below until the next grid-driven change. Ignore stale ids mid tab-switch.
  useEffect(() => {
    if (topRowIds.length === 0) return;
    const valid = new Set(chartPlayers.map((p) => p.player.playerId));
    if (!topRowIds.every((id) => valid.has(id))) return;
    if (tab === 'batting') {
      setTilesBatting(topRowIds);
      setInactiveBatting(new Set());
    } else {
      setTilesPitching(topRowIds);
      setInactivePitching(new Set());
    }
  }, [topRowIds, tab, chartPlayers]);

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
      [...chartPlayers]
        .sort((a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity))
        .map((p) => ({
          id: p.player.playerId,
          name: p.player.fullName,
          ...(p.player.mlbTeamAbbr ? { abbr: p.player.mlbTeamAbbr } : {}),
        })),
    [chartPlayers],
  );

  // Richer options (headshot + owner) for the friendly Compare players dialog. Free agents
  // have no owner, so their card simply omits the subtitle.
  const compareDialogOptions = useMemo<CompareEntityOption[]>(
    () =>
      [...chartPlayers]
        .sort((a, b) => (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity))
        .map((p) => ({
          id: p.player.playerId,
          name: p.player.fullName,
          kind: 'player' as const,
          ...(p.player.headshotUrl ? { imageUrl: p.player.headshotUrl } : {}),
          ...(p.owner ? { subtitle: p.owner } : {}),
        })),
    [chartPlayers],
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

  // Which fantasy rosters are currently loaded as tiles (used to light up team badges).
  const loadedOwners = teamShortcuts
    .filter((t) => t.ids.length > 0 && t.ids.every((id) => tiles.includes(id)))
    .map((t) => t.owner);

  // Toggle a whole roster in/out of the tiles. Up to MAX_TEAMS rosters can be loaded at
  // once for head-to-head comparison; the top PLAYER_CAP tiles stay charted and the rest
  // become inactive tiles the user can toggle on. Adding past the limit evicts the oldest.
  const capInactive = (list: string[]) => new Set(list.slice(PLAYER_CAP));
  const toggleTeam = (team: { owner: string; ids: string[] }) => {
    if (loadedOwners.includes(team.owner)) {
      const remove = new Set(team.ids);
      const next = tiles.filter((id) => !remove.has(id));
      setTiles(next);
      setInactive(capInactive(next));
      return;
    }
    let base = tiles;
    if (loadedOwners.length >= MAX_TEAMS) {
      const oldest = loadedOwners
        .map((owner) => {
          const ids = teamShortcuts.find((s) => s.owner === owner)?.ids ?? [];
          const firstIdx = Math.min(...ids.map((id) => tiles.indexOf(id)).filter((i) => i >= 0));
          return { firstIdx, ids: new Set(ids) };
        })
        .sort((a, b) => a.firstIdx - b.firstIdx)[0];
      if (oldest) base = tiles.filter((id) => !oldest.ids.has(id));
    }
    const next = [...base, ...team.ids.filter((id) => !base.includes(id))];
    setTiles(next);
    setInactive(capInactive(next));
  };

  // Active players' current-range lines for the comparison bars, in selection order.
  const selectedLines = useMemo(
    () =>
      activeIds
        .map((id) => chartPlayers.find((p) => p.player.playerId === id))
        .filter((p): p is PlayerStatLine => Boolean(p)),
    [activeIds, chartPlayers],
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
        fetchPlayerTrendWindows(league.leagueId, cacheRef.current, supportsLast14).then((merged) =>
          // Keep any ranges that loaded meanwhile; fill in the newly fetched windows.
          setCache((c) => ({ ...merged, ...c })),
        );
        // Free-agent windows in parallel, so free agents charted in the trend get a
        // percentile per window (against the rostered pool). Fills in as it arrives.
        fetchFreeAgentTrendWindows(league.leagueId, faCacheRef.current, supportsLast14).then(
          (merged) => setFaCache((c) => ({ ...merged, ...c })),
        );
      },
      { rootMargin: '160px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [league.leagueId]);

  const trendReady = playerTrendWindows(supportsLast14).every((w) => cache[w.range]);
  const trend = useMemo(
    () =>
      buildPlayerTrendSeries(
        cache,
        tab,
        effectiveMetric,
        activeIds,
        tab === 'pitching',
        faCache,
        faOnly,
      ),
    [cache, tab, effectiveMetric, activeIds, faCache, faOnly],
  );

  // How the Compare/Trend percentile pool reads in subtitles, matching the grid: rostered
  // only by default, rostered + free agents while the "Free agents only" filter is on.
  const poolDesc = `${faOnly || isAdvanced ? 'rostered + free-agent' : 'rostered'} ${
    tab === 'batting' ? 'batters' : 'pitchers'
  }`;
  // Advanced stats are season-scoped, so its compare card always reads "Season".
  const rangeText = isAdvanced ? 'Season' : rangeLabel(range);

  const jumpTo = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section>
      <CompareGuide noun="player" seenKey="fcm.comparePlayersGuideSeen.v5" />
      <CompareEntitiesDialog
        open={showCompareDialog}
        onClose={() => setShowCompareDialog(false)}
        options={compareDialogOptions}
        max={COMPARE_LIMIT}
        noun="player"
        onCompare={runCompareForPlayers}
      />
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
        <div className={gridStyles.toolbarRight}>
          <div className={styles.rangeToggle} role="group" aria-label="Stat category set">
            <button
              type="button"
              className={!isAdvanced ? styles.rangeButtonActive : styles.rangeButton}
              aria-pressed={!isAdvanced}
              onClick={() => setColumnSet('scoring')}
              title="League scoring categories"
            >
              Scoring
            </button>
            <button
              type="button"
              className={isAdvanced ? styles.rangeButtonActive : styles.rangeButton}
              aria-pressed={isAdvanced}
              onClick={() => setColumnSet('advanced')}
              title="MLB advanced / expected stats (xBA, xSLG, xwOBA, K%, K/9\u2026)"
            >
              Advanced
            </button>
          </div>
          {!isAdvanced ? (
            <div className={styles.rangeToggle} role="group" aria-label="Stat range">
              {visibleRanges.map((r) => (
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
          ) : null}
        </div>
      </div>

      <div id="table" className={`${styles.tableCard} ${gridStyles.scrollAnchor}`}>
        <div className={gridStyles.tableCardTitleRow}>
          <h2 className={`${styles.tableCardTitle} ${gridStyles.tableCardTitleInRow}`}>
            {tab === 'batting' ? 'Batters' : 'Pitchers'}
          </h2>
          <StatsGridHelp />
          <button
            type="button"
            className={`${gridStyles.faToggle}${faOnly ? ` ${gridStyles.faToggleActive}` : ''}`}
            aria-pressed={faOnly}
            onClick={() => setFaOnly((v) => !v)}
            title="Show only unrostered free agents"
          >
            Free agents only
          </button>
          <button
            type="button"
            className={gridStyles.comparePlayersBtn}
            onClick={() => setShowCompareDialog(true)}
            title="Search players and compare them"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1" y="8" width="3" height="7" rx="0.5" />
              <rect x="6.5" y="4" width="3" height="11" rx="0.5" />
              <rect x="12" y="1" width="3" height="14" rx="0.5" />
            </svg>
            Compare players
          </button>
        </div>
        <div className={gridStyles.gridWrap}>
          {filteringAnalyzedPlayers || advPending ? (
            <div className={gridStyles.gridFilterOverlay} role="status" aria-live="polite">
              <span className={chartStyles.spinner} aria-hidden="true" />
              <span className={chartStyles.loadingVerb}>
                {advPending ? 'Loading advanced stats' : 'Filtering to the analyzed players..'}
                <span className={chartStyles.ellipsis} aria-hidden="true" />
              </span>
            </div>
          ) : null}
          <AgGridReact<StatRow>
            theme={gridTheme}
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            context={context}
            getRowId={(p: GetRowIdParams<StatRow>) => String(p.data.playerId)}
            pinnedTopRowData={pinnedTopRowData}
            isExternalFilterPresent={() => faOnly}
            doesExternalFilterPass={(node: IRowNode<StatRow>) => node.data?.owner == null}
            onRowClicked={handleRowClicked}
            onGridReady={(e) => {
              apiRef.current = e.api;
              setGridReady(true);
            }}
            onModelUpdated={syncTopRows}
            rowHeight={isNarrow ? 44 : undefined}
            animateRows
            suppressCellFocus
            tooltipShowDelay={300}
            overlayNoRowsTemplate={`<span class="ag-overlay-no-rows-center" style="color: var(--muted)">${
              advError
                ? 'Couldn&apos;t load advanced stats.'
                : `No ${tab === 'batting' ? 'batters' : 'pitchers'} on your roster.`
            }</span>`}
          />
        </div>
      </div>

      {/* TODO: sync chart-control changes (metric/range/player selection) to the grid and
          charts automatically, so all three views stay in lockstep without manual re-entry. */}
      {columns.length > 0 && (
        <ChartControlsPanel
          anchorRef={chartsSectionRef}
          seenKey="player-chart-controls-seen"
          alwaysVisible
        >
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

          {!isAdvanced ? (
            <div className={chartStyles.controlGroup}>
              <label className={chartStyles.controlGroupLabel} htmlFor="player-trend-metric">
                Trend metric
              </label>
              <select
                id="player-trend-metric"
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
          ) : null}

          {!isAdvanced ? (
            <div className={chartStyles.controlGroup}>
              <span className={chartStyles.controlGroupLabel}>Range (compare)</span>
              <div className={styles.rangeToggle} role="group" aria-label="Compare range">
                {visibleRanges.map((r) => (
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
          ) : null}

          <div className={chartStyles.controlGroup}>
            <span className={chartStyles.controlGroupLabel}>
              Players ({tab === 'batting' ? 'Batters' : 'Pitchers'})
            </span>
            {teamShortcuts.length > 0 && (
              <>
                <p className={chartStyles.shortcutHint}>
                  Load up to two teams&rsquo; {tab === 'batting' ? 'batters' : 'pitchers'} to
                  compare
                </p>
                <div
                  className={chartStyles.teamToggles}
                  role="group"
                  aria-label="Load a fantasy team's players"
                >
                  {teamShortcuts.map((t) => {
                    const active = loadedOwners.includes(t.owner);
                    return (
                      <button
                        key={t.owner}
                        type="button"
                        aria-pressed={active}
                        className={`${chartStyles.teamChip}${active ? ` ${chartStyles.teamChipActive}` : ''}`}
                        onClick={() => toggleTeam(t)}
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
      )}

      {canCompare ? (
        <section
          id="compare"
          ref={compareCardRef}
          className={`${chartStyles.card} ${gridStyles.compareCard} ${gridStyles.scrollAnchor}`}
          aria-label="Player metric comparison"
        >
          <div className={chartStyles.header}>
            <div>
              <h2 className={chartStyles.title}>
                Comparing {compareLines.length} {tab === 'batting' ? 'batters' : 'pitchers'}
              </h2>
              <p className={chartStyles.subtitle}>
                Percentile among {poolDesc} &middot; {rangeText} &middot; {compareColumns.length} of{' '}
                {columns.length} metrics
              </p>
            </div>
          </div>
          {compareColumns.length === 0 ? (
            <p className={chartStyles.empty}>Pick at least one metric in chart controls.</p>
          ) : (
            <>
              <CompareMetricsPanel
                entities={compareEntities}
                columns={compareColumns}
                percentiles={percentiles}
                ranks={ranks}
                exportTitle={`Comparing ${compareLines.length} ${tab === 'batting' ? 'batters' : 'pitchers'}`}
                exportSubtitle={`Percentile among ${poolDesc} · ${rangeText} · ${compareColumns.length} of ${columns.length} metrics`}
                exportFilename={`${tab}-compare`}
              />
            </>
          )}
        </section>
      ) : null}

      {!isAdvanced && columns.length > 0 && (
        <div className={gridStyles.chartsSection} ref={chartsSectionRef}>
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
                  Percentile among {poolDesc}; dashed line is each player&rsquo;s season baseline
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

/** Value+ cell: the value index as a badge, with the cross-position rank in the tooltip. */
function SgptCell(params: CustomCellRendererProps) {
  const value = params.value as number | null | undefined;
  if (value == null) return <span className={gridStyles.rankEmpty}>-</span>;
  const rank = (params.data as StatRow | undefined)?.sgptRank;
  const title =
    typeof rank === 'number' ? `Value+ ${value} - #${rank} overall (hitters + pitchers)` : `Value+ ${value}`;
  return (
    <span className={gridStyles.sgptBadge} title={title}>
      {value}
    </span>
  );
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
  const playerId = String(data.playerId ?? '');
  const abbr = data.mlbTeamAbbr as string | null;
  const headshotUrl = data.headshotUrl as string | null;
  return (
    <span className={styles.playerCellInner}>
      <PlayerAvatar fullName={fullName} {...(headshotUrl ? { headshotUrl } : {})} />
      <span className={styles.playerName}>
        <PlayerNameButton
          stopPropagation
          target={{
            playerId,
            fullName,
            ...(abbr ? { mlbTeamAbbr: abbr } : {}),
            ...(headshotUrl ? { headshotUrl } : {}),
          }}
        />
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
