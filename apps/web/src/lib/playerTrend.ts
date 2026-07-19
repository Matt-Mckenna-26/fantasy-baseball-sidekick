import type {
  LeagueFreeAgentsResponse,
  PlayerStatLine,
  PlayerStatsResponse,
  StatRange,
} from '@fcm/contracts';
import { getFreeAgents, getPlayerStats } from '../api/client';
import { buildStatPercentiles } from './percentile';
import { toNumericValue } from './teamTrend';

/**
 * All lookback windows the trend view loads. The chart plots each player's PERCENTILE
 * within the rostered pool (not the raw value), which puts every window on the same
 * 0-100 scale regardless of window length. Season is kept separate as a baseline
 * reference (see buildPlayerTrendSeries); the recent windows form the trend line.
 */
export function playerTrendWindows(supportsLast14 = false): { range: StatRange; label: string }[] {
  return [
    { range: 'season', label: 'Season' },
    { range: 'last30', label: 'Last 30' },
    // Last 21 and Last 14 only exist when the MLB stats source serves them; omit them
    // otherwise so the trend doesn't wait on (or repeatedly fail) windows Yahoo cannot
    // provide. `supportsLast14` doubles as the "MLB source on" flag for both windows.
    ...(supportsLast14
      ? [
          { range: 'last21' as StatRange, label: 'Last 21' },
          { range: 'last14' as StatRange, label: 'Last 14' },
        ]
      : []),
    { range: 'last7', label: 'Last 7' },
  ];
}

/**
 * The recent windows drawn as the connected trend line, oldest to newest (left to right).
 * Last 21 and Last 14 are listed but only contribute a point when that window was actually
 * loaded (buildPlayerTrendSeries filters to windows present in `byRange`).
 */
const TREND_LINE_WINDOWS: { range: StatRange; label: string }[] = [
  { range: 'last30', label: 'Last 30' },
  { range: 'last21', label: 'Last 21' },
  { range: 'last14', label: 'Last 14' },
  { range: 'last7', label: 'Last 7' },
];

/** Responses cached by the range they cover; reused across the grid and both charts. */
export type PlayerStatsByRange = Partial<Record<StatRange, PlayerStatsResponse>>;

/** Free-agent responses cached by window, so free agents can also be charted over time. */
export type FreeAgentsByRange = Partial<Record<StatRange, LeagueFreeAgentsResponse>>;

/**
 * Fetch any trend windows missing from `existing`, reusing already-loaded ranges to
 * avoid redundant calls. Requests are silent read-only GETs (no global overlay). Each
 * range is ~12 Yahoo calls server-side, so windows are fetched one at a time rather
 * than in a burst, and a window that fails is skipped so the rest still render.
 */
export async function fetchPlayerTrendWindows(
  leagueId: string,
  existing: PlayerStatsByRange,
  supportsLast14 = false,
  onProgress?: (partial: PlayerStatsByRange) => void,
): Promise<PlayerStatsByRange> {
  const result: PlayerStatsByRange = { ...existing };
  for (const { range } of playerTrendWindows(supportsLast14)) {
    if (result[range]) continue;
    try {
      result[range] = await getPlayerStats(leagueId, range, { silent: true });
      // Surface each window as it lands so callers can render the trend progressively
      // instead of waiting on the slowest window (a fresh copy so consumers can setState).
      onProgress?.({ ...result });
    } catch {
      // Skip a window that fails to load; the remaining windows still form the trend.
    }
  }
  return result;
}

/**
 * Fetch any free-agent trend windows missing from `existing`, so free agents charted in the
 * trend get a percentile per window (against the rostered pool). Same reuse/skip semantics as
 * fetchPlayerTrendWindows; a failed or empty window just leaves those free agents unplotted.
 */
export async function fetchFreeAgentTrendWindows(
  leagueId: string,
  existing: FreeAgentsByRange,
  supportsLast14 = false,
): Promise<FreeAgentsByRange> {
  const result: FreeAgentsByRange = { ...existing };
  for (const { range } of playerTrendWindows(supportsLast14)) {
    if (result[range]) continue;
    try {
      result[range] = await getFreeAgents(leagueId, range, { silent: true });
    } catch {
      // Skip a window that fails to load; free agents just won't appear for it.
    }
  }
  return result;
}

/**
 * A single window's point for the trend line chart: `range`/`label` are reserved axis
 * keys and every other key is a `playerId` mapped to that player's percentile (0-100)
 * for the selected metric that window (null when unavailable). Flattened for Recharts.
 */
export type PlayerTrendRow = Record<string, number | string | null>;

/** The line rows plus each player's season baseline percentile (drawn as a reference). */
export interface PlayerTrendData {
  rows: PlayerTrendRow[];
  /** playerId -> season percentile (0-100), or null when the player has no season value. */
  seasonBaseline: Record<string, number | null>;
}

/**
 * Percentile (0-100) of each player for one metric in a single window's response. By default
 * the pool (and thus buildStatPercentiles' ranking + lower-is-better inversion) is the ROSTERED
 * players, and free agents from `faResponse` are scored against that same pool so they show
 * "where they'd rank" without shifting anyone's percentile. When `includeFreeAgentsInPool` is
 * set (the Stats page "Free agents only" filter), free agents join the ranking pool too, so the
 * trend matches the grid's colors for the same filter.
 */
function windowPercentiles(
  response: PlayerStatsResponse,
  faResponse: LeagueFreeAgentsResponse | undefined,
  tab: 'batting' | 'pitching',
  metricKey: string,
  isPitching: boolean,
  includeFreeAgentsInPool = false,
): Map<string, number> {
  const tableData = response[tab];
  const metricColumn = tableData.columns.find((c) => c.key === metricKey);
  const result = new Map<string, number>();
  if (!metricColumn) return result;

  const toRow = (p: PlayerStatLine) => {
    const found = p.stats.find((s) => s.key === metricKey);
    return { playerId: p.player.playerId, [metricKey]: toNumericValue(found?.value) };
  };
  const rosteredRows = tableData.players.map(toRow);

  // Everyone we assign a percentile to: rostered players plus any free agents not already rostered.
  const scored = [...rosteredRows];
  if (faResponse) {
    const seen = new Set(rosteredRows.map((r) => r.playerId));
    for (const p of faResponse[tab].players) {
      if (!seen.has(p.player.playerId)) scored.push(toRow(p));
    }
  }

  const poolRows = includeFreeAgentsInPool ? scored : rosteredRows;
  const lookup = buildStatPercentiles(poolRows, [metricColumn], isPitching).get(metricKey);
  if (!lookup) return result;

  for (const row of scored) {
    const value = row[metricKey];
    if (typeof value === 'number') {
      result.set(row.playerId as string, Math.round(lookup(value) * 100));
    }
  }
  return result;
}

/**
 * Build the percentile trend for the selected players: a line across the recent windows
 * (Last 30 -> Last 7) plus each player's Season percentile as a separate baseline. Only
 * windows present in `byRange` contribute; `tab`/`isPitching` select the table and the
 * lower-is-better inversion. Percentiles are within the rostered pool unless
 * `includeFreeAgentsInPool` is set, when free agents join the pool (matching the grid's
 * "Free agents only" filter).
 */
export function buildPlayerTrendSeries(
  byRange: PlayerStatsByRange,
  tab: 'batting' | 'pitching',
  metricKey: string,
  playerIds: string[],
  isPitching: boolean,
  faByRange: FreeAgentsByRange = {},
  includeFreeAgentsInPool = false,
): PlayerTrendData {
  const rows: PlayerTrendRow[] = TREND_LINE_WINDOWS.filter((w) => byRange[w.range]).map((w) => {
    const pct = windowPercentiles(
      byRange[w.range]!,
      faByRange[w.range],
      tab,
      metricKey,
      isPitching,
      includeFreeAgentsInPool,
    );
    const row: PlayerTrendRow = { range: w.range, label: w.label };
    for (const id of playerIds) row[id] = pct.get(id) ?? null;
    return row;
  });

  const seasonBaseline: Record<string, number | null> = {};
  const seasonResponse = byRange.season;
  if (seasonResponse) {
    const pct = windowPercentiles(
      seasonResponse,
      faByRange.season,
      tab,
      metricKey,
      isPitching,
      includeFreeAgentsInPool,
    );
    for (const id of playerIds) seasonBaseline[id] = pct.get(id) ?? null;
  }

  return { rows, seasonBaseline };
}

/**
 * Trend for ONE player across MANY metrics: each metric becomes a series (a line of the
 * player's percentile per recent window) plus a season baseline per metric. This is the
 * transpose of buildPlayerTrendSeries (one metric, many players), used by the player-focus
 * card to show a single player's form across all their scoring categories at once. Keys in
 * `rows`/`seasonBaseline` are metric keys (not player ids). Percentiles are within the
 * rostered pool for the tab.
 */
export function buildPlayerMetricTrend(
  byRange: PlayerStatsByRange,
  tab: 'batting' | 'pitching',
  playerId: string,
  metricKeys: string[],
  isPitching: boolean,
): PlayerTrendData {
  const rows: PlayerTrendRow[] = TREND_LINE_WINDOWS.filter((w) => byRange[w.range]).map((w) => {
    const row: PlayerTrendRow = { range: w.range, label: w.label };
    for (const key of metricKeys) {
      const pct = windowPercentiles(byRange[w.range]!, undefined, tab, key, isPitching);
      row[key] = pct.get(playerId) ?? null;
    }
    return row;
  });

  const seasonBaseline: Record<string, number | null> = {};
  const seasonResponse = byRange.season;
  if (seasonResponse) {
    for (const key of metricKeys) {
      const pct = windowPercentiles(seasonResponse, undefined, tab, key, isPitching);
      seasonBaseline[key] = pct.get(playerId) ?? null;
    }
  }

  return { rows, seasonBaseline };
}
