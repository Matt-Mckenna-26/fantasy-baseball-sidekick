import type { PlayerStatLine, StatColumn, StatValue } from '@fcm/contracts';
import { playerGameEligiblePositions } from '@fcm/contracts';
import type { CompareEntity } from '../components/charts/compareEntity';

/** Flat per-player grid row: fixed meta fields plus one numeric + one display value per stat. */
export type StatRow = Record<string, string | number | null>;

/**
 * Drop Util from a position list unless it's the only eligibility left - Util is a fantasy
 * slot almost every hitter has, so showing it next to OF/1B/etc. just adds noise.
 */
function withoutUtilUnlessOnly(positions: string[]): string[] {
  const cleaned = positions.map((p) => p.trim()).filter(Boolean);
  const nonUtil = cleaned.filter((p) => p !== 'Util');
  return nonUtil.length > 0 ? nonUtil : cleaned.filter((p) => p === 'Util');
}

/** Short position label for the stats grid filter (Yahoo display_position, else eligibles). */
export function playerPositionLabel(player: PlayerStatLine['player']): string | null {
  if (player.displayPosition?.trim()) {
    const parts = player.displayPosition.split(',').map((s) => s.trim()).filter(Boolean);
    const kept = withoutUtilUnlessOnly(parts);
    return kept.length > 0 ? kept.join(',') : null;
  }
  const elig = withoutUtilUnlessOnly(playerGameEligiblePositions(player.eligiblePositions));
  return elig.length > 0 ? elig.join(',') : null;
}

/** Parse a Yahoo stat value to a sortable number, or null when unavailable. */
export function toNumericValue(value: StatValue['value'] | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (value === '-' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** The raw text to display for a stat value ("-" is Yahoo's own missing placeholder). */
export function toDisplay(value: StatValue['value'] | undefined): string {
  if (value === undefined) return '-';
  return String(value);
}

/**
 * H/AB is a raw hits-over-at-bats display column (kept only in Rosters), not a scoring
 * category we grid, rank, or chart, so drop it wherever we build a stat pool.
 */
export function scoringColumns(columns: StatColumn[]): StatColumn[] {
  return columns.filter((c) => c.label.trim().toUpperCase() !== 'H/AB');
}

/** Map a stat line to a flat grid row (numeric + `${key}__d` display value per column). */
export function toStatRow(line: PlayerStatLine, columns: StatColumn[]): StatRow {
  const row: StatRow = {
    playerId: line.player.playerId,
    fullName: line.player.fullName,
    mlbTeamAbbr: line.player.mlbTeamAbbr ?? null,
    headshotUrl: line.player.headshotUrl ?? null,
    position: playerPositionLabel(line.player),
    owner: line.owner ?? null,
    ownerLogoUrl: line.ownerLogoUrl ?? null,
    overallRank: line.overallRank ?? null,
    sgptPlus: line.sgptPlus ?? null,
    sgptRank: line.sgptRank ?? null,
  };
  const byKey = new Map(line.stats.map((s) => [s.key, s.value]));
  for (const col of columns) {
    const raw = byKey.get(col.key);
    row[col.key] = toNumericValue(raw);
    row[`${col.key}__d`] = toDisplay(raw);
  }
  return row;
}

/** Map a stat line to the shared compare-card entity shape (avatar, owner subtitle, stats). */
export function toCompareEntity(line: PlayerStatLine): CompareEntity {
  return {
    id: line.player.playerId,
    name: line.player.fullName,
    kind: 'player',
    stats: line.stats,
    ...(line.player.headshotUrl ? { imageUrl: line.player.headshotUrl } : {}),
    ...(line.owner ? { subtitle: line.owner } : {}),
    ...(line.sgptPlus !== undefined ? { sgptPlus: line.sgptPlus } : {}),
    ...(line.sgptRank !== undefined ? { sgptRank: line.sgptRank } : {}),
  };
}
