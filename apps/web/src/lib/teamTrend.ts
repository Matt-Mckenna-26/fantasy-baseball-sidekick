import type { LeagueTeamStatsResponse, StatValue } from '@fcm/contracts';
import { getLeagueTeamStats } from '../api/client';

/** How many trailing fantasy weeks the trend chart plots (see Analyze League plan). */
export const TREND_WEEK_COUNT = 6;

/**
 * Parse a Yahoo stat value to a plottable number, or null when unavailable.
 * Shared with the Analyze League grid so charts and cells parse identically.
 */
export function toNumericValue(value: StatValue['value'] | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value === '-' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** The most-recent `count` weeks from an ascending week list (fewer if not enough exist). */
export function trailingWeeks(weeks: number[], count = TREND_WEEK_COUNT): number[] {
  return count <= 0 ? [] : weeks.slice(-count);
}

/**
 * Fetch each of the trailing `count` fantasy weeks' team totals. Requests are silent
 * (no global loading overlay) and read-only GETs. Cost: one team-stats call per week
 * (~12 Yahoo calls each server-side), so weeks are fetched one at a time to avoid a
 * concurrent burst against Yahoo (the same "a week at a time" bound the server uses).
 * A week that fails is skipped rather than discarding the whole set, so the trend
 * still renders from the weeks that did load. Responses are in ascending week order.
 */
export async function fetchTrailingWeeks(
  leagueId: string,
  weeks: number[],
  count = TREND_WEEK_COUNT,
): Promise<LeagueTeamStatsResponse[]> {
  const targets = trailingWeeks(weeks, count);
  const responses: LeagueTeamStatsResponse[] = [];
  for (const week of targets) {
    try {
      responses.push(await getLeagueTeamStats(leagueId, week, { silent: true }));
    } catch {
      // Skip a week that fails to load; the remaining weeks still form the trend.
    }
  }
  return responses;
}

/**
 * A single week's point for the trend line chart: `week`/`label` are reserved axis
 * keys and every other key is a `teamId` mapped to that team's numeric value for the
 * selected metric (null when the team has no value that week). Flattened for Recharts.
 */
export type TrendRow = Record<string, number | string | null>;

/**
 * Assemble per-week trend rows for one metric across the fetched week responses.
 * Only weekly buckets are used (season/window responses are ignored), and rows are
 * returned in ascending week order. `currentWeek` labels the latest week "This wk".
 */
export function buildTrendSeries(
  responses: LeagueTeamStatsResponse[],
  metricKey: string,
  currentWeek?: number,
): TrendRow[] {
  return responses
    .filter((r): r is LeagueTeamStatsResponse & { bucket: number } => typeof r.bucket === 'number')
    .map((r) => {
      const week = r.bucket;
      const row: TrendRow = {
        week,
        label: currentWeek !== undefined && week === currentWeek ? 'This wk' : `Wk ${week}`,
      };
      for (const team of r.teams) {
        const found = team.stats.find((s) => s.key === metricKey);
        row[team.teamId] = toNumericValue(found?.value);
      }
      return row;
    })
    .sort((a, b) => (a.week as number) - (b.week as number));
}
