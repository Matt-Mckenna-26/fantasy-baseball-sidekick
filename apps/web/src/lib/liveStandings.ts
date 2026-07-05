import type { Matchup, MatchupTeam, StandingsRow } from '@fcm/contracts';

/** Win fraction (ties count as half) used to rank a category-record standings row. */
function winFraction(row: Pick<StandingsRow, 'wins' | 'losses' | 'ties'>): number {
  const wins = row.wins ?? 0;
  const games = wins + (row.losses ?? 0) + (row.ties ?? 0);
  return games > 0 ? (wins + (row.ties ?? 0) * 0.5) / games : 0;
}

/** Format a fraction the way Yahoo shows win % - three decimals, no leading zero. */
function formatPct(value: number): string {
  const fixed = value.toFixed(3);
  return fixed.startsWith('0') ? fixed.slice(1) : fixed;
}

/**
 * Project the in-progress week onto the season standings and re-rank. Only
 * `midevent` matchups are applied: completed weeks are already reflected in the
 * season totals, and weeks that have not started carry no result. This is a
 * head-to-head categories league, so the season W-L-T is a cumulative count of
 * category results - each live matchup adds that team's category wins, losses,
 * and ties to its record (e.g. a 6-2-2 week adds 6/2/2). Win %, rank, and games
 * back are recomputed so the table stays coherent. When there is nothing live to
 * apply (roto/offseason/preevent), the input rows are returned unchanged.
 */
export function computeLiveStandings(
  standings: StandingsRow[],
  matchups: Matchup[],
): StandingsRow[] {
  const live = matchups.filter((m) => m.status === 'midevent' && m.teams.length === 2);
  if (live.length === 0) return standings;

  const delta = new Map<string, { w: number; l: number; t: number }>();
  const bump = (team: MatchupTeam, opponent: MatchupTeam) => {
    const d = delta.get(team.teamId) ?? { w: 0, l: 0, t: 0 };
    d.w += team.categoriesWon;
    d.l += team.categoriesLost ?? opponent.categoriesWon;
    d.t += team.categoriesTied ?? 0;
    delta.set(team.teamId, d);
  };
  for (const m of live) {
    const [a, b] = m.teams;
    if (!a || !b) continue;
    bump(a, b);
    bump(b, a);
  }

  const projected = standings.map((row) => {
    const d = delta.get(row.teamId);
    if (!d) return { ...row };
    const wins = (row.wins ?? 0) + d.w;
    const losses = (row.losses ?? 0) + d.l;
    const ties = (row.ties ?? 0) + d.t;
    const games = wins + losses + ties;
    const next: StandingsRow = { ...row, wins, losses, ties };
    if (games > 0) next.winPercentage = formatPct((wins + ties * 0.5) / games);
    return next;
  });

  projected.sort((x, y) => {
    const pctDiff = winFraction(y) - winFraction(x);
    if (pctDiff !== 0) return pctDiff;
    return (y.wins ?? 0) - (x.wins ?? 0);
  });

  const leader = projected[0];
  return projected.map((row, i) => {
    const next: StandingsRow = { ...row, rank: i + 1 };
    if (leader) {
      const gb =
        ((leader.wins ?? 0) - (row.wins ?? 0) + ((row.losses ?? 0) - (leader.losses ?? 0))) / 2;
      next.gamesBack = gb <= 0 ? '-' : gb.toFixed(1).replace(/\.0$/, '');
    }
    return next;
  });
}

/** One team's rank change after live-week projection (positive = moved up). */
export type StandingsMover = {
  teamId: string;
  teamName: string;
  logoUrl?: string;
  baselineRank: number;
  projectedRank: number;
  rankDelta: number;
};

function rankOf(row: StandingsRow, rows: StandingsRow[], index: number): number {
  return row.rank ?? index + 1;
}

/** Compare baseline vs projected standings and return teams whose rank changed. */
export function computeStandingsMovers(
  baseline: StandingsRow[],
  projected: StandingsRow[],
): StandingsMover[] {
  const projectedById = new Map(projected.map((row, i) => [row.teamId, { row, index: i }]));
  const movers: StandingsMover[] = [];

  baseline.forEach((row, i) => {
    const live = projectedById.get(row.teamId);
    if (!live) return;
    const baselineRank = rankOf(row, baseline, i);
    const projectedRank = rankOf(live.row, projected, live.index);
    const rankDelta = baselineRank - projectedRank;
    if (rankDelta === 0) return;
    movers.push({
      teamId: row.teamId,
      teamName: row.teamName,
      ...(row.logoUrl ?? live.row.logoUrl ? { logoUrl: row.logoUrl ?? live.row.logoUrl } : {}),
      baselineRank,
      projectedRank,
      rankDelta,
    });
  });

  return movers.sort((a, b) => {
    const absDiff = Math.abs(b.rankDelta) - Math.abs(a.rankDelta);
    if (absDiff !== 0) return absDiff;
    return a.teamId.localeCompare(b.teamId);
  });
}

/** Pick the largest upward and downward rank movers (deterministic tie-break on team id). */
export function pickStandingsMoverHighlights(movers: StandingsMover[]): {
  hot: StandingsMover | null;
  cold: StandingsMover | null;
} {
  const hot = [...movers]
    .filter((m) => m.rankDelta > 0)
    .sort((a, b) => b.rankDelta - a.rankDelta || a.teamId.localeCompare(b.teamId))[0];
  const cold = [...movers]
    .filter((m) => m.rankDelta < 0)
    .sort((a, b) => a.rankDelta - b.rankDelta || a.teamId.localeCompare(b.teamId))[0];
  return { hot: hot ?? null, cold: cold ?? null };
}

/** Short deterministic copy for a standings mover blurb (team name rendered separately). */
export function formatMoverBlurb(mover: StandingsMover, tone: 'hot' | 'cold'): string {
  const { baselineRank, projectedRank, rankDelta } = mover;
  const spots = Math.abs(rankDelta);

  if (tone === 'hot') {
    if (projectedRank === 1 && baselineRank > 1) return ' takes over 1st place';
    if (rankDelta >= 2) return ` climbs ${spots} spots to #${projectedRank}`;
    return ` moves up to #${projectedRank}`;
  }

  if (baselineRank === 1 && projectedRank > 1) return ` drops from 1st to #${projectedRank}`;
  if (rankDelta <= -2) return ` falls ${spots} spots to #${projectedRank}`;
  return ` slips to #${projectedRank}`;
}
