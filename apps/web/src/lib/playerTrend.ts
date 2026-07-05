import type { PlayerStatsResponse, StatRange } from '@fcm/contracts';
import { getPlayerStats } from '../api/client';
import { buildStatPercentiles } from './percentile';
import { toNumericValue } from './teamTrend';

/**
 * All lookback windows the trend view loads. The chart plots each player's PERCENTILE
 * within the rostered pool (not the raw value), which puts every window on the same
 * 0-100 scale regardless of window length. Season is kept separate as a baseline
 * reference (see buildPlayerTrendSeries); the recent windows form the trend line.
 */
export const PLAYER_TREND_WINDOWS: { range: StatRange; label: string }[] = [
  { range: 'season', label: 'Season' },
  { range: 'last30', label: 'Last 30' },
  { range: 'last7', label: 'Last 7' },
];

/** The recent windows drawn as the connected trend line, oldest to newest (left to right). */
const TREND_LINE_WINDOWS: { range: StatRange; label: string }[] = [
  { range: 'last30', label: 'Last 30' },
  { range: 'last7', label: 'Last 7' },
];

/** Responses cached by the range they cover; reused across the grid and both charts. */
export type PlayerStatsByRange = Partial<Record<StatRange, PlayerStatsResponse>>;

/**
 * Fetch any trend windows missing from `existing`, reusing already-loaded ranges to
 * avoid redundant calls. Requests are silent read-only GETs (no global overlay). Each
 * range is ~12 Yahoo calls server-side, so windows are fetched one at a time rather
 * than in a burst, and a window that fails is skipped so the rest still render.
 */
export async function fetchPlayerTrendWindows(
  leagueId: string,
  existing: PlayerStatsByRange,
): Promise<PlayerStatsByRange> {
  const result: PlayerStatsByRange = { ...existing };
  for (const { range } of PLAYER_TREND_WINDOWS) {
    if (result[range]) continue;
    try {
      result[range] = await getPlayerStats(leagueId, range, { silent: true });
    } catch {
      // Skip a window that fails to load; the remaining windows still form the trend.
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
 * Percentile (0-100) of each rostered player for one metric in a single window's
 * response. Reuses buildStatPercentiles, which ranks against the whole pool and inverts
 * lower-is-better categories so a higher percentile always means better.
 */
function windowPercentiles(
  response: PlayerStatsResponse,
  tab: 'batting' | 'pitching',
  metricKey: string,
  isPitching: boolean,
): Map<string, number> {
  const tableData = response[tab];
  const metricColumn = tableData.columns.find((c) => c.key === metricKey);
  const result = new Map<string, number>();
  if (!metricColumn) return result;

  const rows = tableData.players.map((p) => {
    const found = p.stats.find((s) => s.key === metricKey);
    return { playerId: p.player.playerId, [metricKey]: toNumericValue(found?.value) };
  });
  const lookup = buildStatPercentiles(rows, [metricColumn], isPitching).get(metricKey);
  if (!lookup) return result;

  for (const row of rows) {
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
 * lower-is-better inversion. All values are percentiles within the rostered pool.
 */
export function buildPlayerTrendSeries(
  byRange: PlayerStatsByRange,
  tab: 'batting' | 'pitching',
  metricKey: string,
  playerIds: string[],
  isPitching: boolean,
): PlayerTrendData {
  const rows: PlayerTrendRow[] = TREND_LINE_WINDOWS.filter((w) => byRange[w.range]).map((w) => {
    const pct = windowPercentiles(byRange[w.range]!, tab, metricKey, isPitching);
    const row: PlayerTrendRow = { range: w.range, label: w.label };
    for (const id of playerIds) row[id] = pct.get(id) ?? null;
    return row;
  });

  const seasonBaseline: Record<string, number | null> = {};
  const seasonResponse = byRange.season;
  if (seasonResponse) {
    const pct = windowPercentiles(seasonResponse, tab, metricKey, isPitching);
    for (const id of playerIds) seasonBaseline[id] = pct.get(id) ?? null;
  }

  return { rows, seasonBaseline };
}
