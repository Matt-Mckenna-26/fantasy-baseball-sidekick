import type {
  LeagueFreeAgentsResponse,
  LeagueMatchupsResponse,
  LeagueRostersResponse,
  LeagueStandingsResponse,
  LeagueTeamStatsResponse,
  LeagueTransactionsResponse,
  PlayerStatsResponse,
  StatColumn,
  StatTable,
  StandingsRow,
  TeamStatsResponse,
} from '@fcm/contracts';
import { normalizeName } from './playerRegistry.js';

/**
 * DTO -> compact snapshot mappers for the AI co-manager. Tool results feed the model,
 * so these deliberately drop UI-only fields (logos, headshots, ids) and cap array sizes
 * to keep the token budget small while preserving the analytical signal. All functions
 * are pure and unit-tested without the network.
 */

/** Default cap on how many players a stat snapshot returns (top by overall rank). */
export const DEFAULT_PLAYER_CAP = 15;

/** Turn a StatColumn[] + StatValue[] into a plain { label: value } map (skips "-"). */
function statsByLabel(
  columns: StatColumn[],
  stats: { key: string; value: number | string }[],
): Record<string, number | string> {
  const labelByKey = new Map(columns.map((c) => [c.key, c.label]));
  const out: Record<string, number | string> = {};
  for (const s of stats) {
    if (s.value === '-' || s.value === '') continue;
    out[labelByKey.get(s.key) ?? s.key] = s.value;
  }
  return out;
}

export function snapshotStandings(dto: LeagueStandingsResponse): {
  teams: {
    teamId: string;
    rank?: number;
    team: string;
    manager?: string;
    w?: number;
    l?: number;
    pct?: string;
    gb?: string;
  }[];
} {
  return {
    teams: dto.teams.map((t: StandingsRow) => ({
      // teamId is required so the model can chain into get_team_stats without asking.
      teamId: t.teamId,
      ...(t.rank !== undefined ? { rank: t.rank } : {}),
      team: t.teamName,
      ...(t.managerName ? { manager: t.managerName } : {}),
      ...(t.wins !== undefined ? { w: t.wins } : {}),
      ...(t.losses !== undefined ? { l: t.losses } : {}),
      ...(t.winPercentage ? { pct: t.winPercentage } : {}),
      ...(t.gamesBack ? { gb: t.gamesBack } : {}),
    })),
  };
}

export function snapshotTransactions(dto: LeagueTransactionsResponse): {
  transactions: {
    date: string;
    type: string;
    adds: string[];
    drops: string[];
    teams: string[];
  }[];
} {
  return {
    transactions: dto.transactions.map((tx) => {
      const teams = new Set<string>();
      const adds: string[] = [];
      const drops: string[] = [];
      for (const p of tx.players) {
        if (p.destinationTeamName) teams.add(p.destinationTeamName);
        if (p.sourceTeamName) teams.add(p.sourceTeamName);
        // Trades read as a move onto the destination team; adds/drops keep their side.
        if (p.movement === 'drop') drops.push(p.fullName);
        else adds.push(p.fullName);
      }
      return {
        // ISO date (day granularity) keeps recency legible without a full timestamp.
        date: new Date(tx.timestamp * 1000).toISOString().slice(0, 10),
        type: tx.type,
        adds,
        drops,
        teams: [...teams],
      };
    }),
  };
}

/**
 * Head-to-head matchups for a week. `won/lost/tied` are the category counts; when the week's
 * per-team totals are supplied (`teamStats`, same fantasy week), each side also gets a `stats`
 * map of the ACTUAL per-category totals (e.g. HR: 14) joined by teamId - so the model can judge
 * a matchup on the raw numbers and margins, not just who is currently ahead in each category.
 */
export function snapshotMatchups(
  dto: LeagueMatchupsResponse,
  teamStats?: LeagueTeamStatsResponse,
): {
  week: number;
  categories?: string[];
  matchups: {
    teams: {
      team: string;
      won: number;
      lost?: number;
      tied?: number;
      stats?: Record<string, number | string>;
    }[];
  }[];
} {
  const columns = teamStats ? [...teamStats.battingColumns, ...teamStats.pitchingColumns] : [];
  const statsByTeamId = new Map<string, Record<string, number | string>>();
  if (teamStats) {
    for (const t of teamStats.teams) statsByTeamId.set(t.teamId, statsByLabel(columns, t.stats));
  }
  return {
    week: dto.week,
    ...(columns.length > 0 ? { categories: columns.map((c) => c.label) } : {}),
    matchups: dto.matchups.map((m) => ({
      teams: m.teams.map((t) => {
        const stats = statsByTeamId.get(t.teamId);
        return {
          team: t.teamName,
          won: t.categoriesWon,
          ...(t.categoriesLost !== undefined ? { lost: t.categoriesLost } : {}),
          ...(t.categoriesTied !== undefined ? { tied: t.categoriesTied } : {}),
          ...(stats && Object.keys(stats).length > 0 ? { stats } : {}),
        };
      }),
    })),
  };
}

export function snapshotRosters(
  dto: LeagueRostersResponse,
  playerCap = 30,
): { teams: { teamId: string; team: string; manager?: string; players: string[] }[] } {
  return {
    teams: dto.teams.map((t) => ({
      // teamId lets the model resolve "my team" -> a team to pull stats for, unaided.
      teamId: t.teamId,
      team: t.teamName,
      ...(t.managerName ? { manager: t.managerName } : {}),
      players: t.slots
        .slice(0, playerCap)
        .map((s) => `${s.player.fullName} (${s.selectedPosition})`),
    })),
  };
}

export function snapshotLeagueTeamStats(dto: LeagueTeamStatsResponse): {
  bucket: LeagueTeamStatsResponse['bucket'];
  columns: string[];
  teams: { team: string; stats: Record<string, number | string> }[];
} {
  const columns = [...dto.battingColumns, ...dto.pitchingColumns];
  return {
    bucket: dto.bucket,
    columns: columns.map((c) => c.label),
    teams: dto.teams.map((t) => ({ team: t.teamName, stats: statsByLabel(columns, t.stats) })),
  };
}

export function snapshotTeamPlayers(dto: TeamStatsResponse): {
  teamId: string;
  range: TeamStatsResponse['range'];
  players: { name: string; pos: string; status?: string; stats: Record<string, number | string> }[];
} {
  const columns = [...dto.battingColumns, ...dto.pitchingColumns];
  return {
    teamId: dto.teamId,
    range: dto.range,
    players: dto.players.map((p) => ({
      name: p.player.fullName,
      pos: p.player.eligiblePositions.join('/'),
      ...(p.player.status ? { status: p.player.status } : {}),
      stats: statsByLabel(columns, p.stats),
    })),
  };
}

/**
 * Top-N players from a stat table as compact rows. Sorted by Yahoo overall rank by default; set
 * `byValue` to lead with the best Value+ (sgptRank) instead, falling back to overall rank - used
 * for free agents so the highest-value pickups surface first.
 */
function topPlayers(table: StatTable, cap: number, byValue = false) {
  return [...table.players]
    .sort((a, b) => {
      if (byValue) {
        const ra = a.sgptRank ?? Infinity;
        const rb = b.sgptRank ?? Infinity;
        if (ra !== rb) return ra - rb;
      }
      return (a.overallRank ?? Infinity) - (b.overallRank ?? Infinity);
    })
    .slice(0, cap)
    .map((p) => ({
      name: p.player.fullName,
      ...(p.player.mlbTeamAbbr ? { team: p.player.mlbTeamAbbr } : {}),
      ...(p.overallRank !== undefined ? { rank: p.overallRank } : {}),
      // Value+ index (100 = league average) and its rank across hitters + pitchers.
      ...(p.sgptPlus !== undefined ? { sgptPlus: p.sgptPlus } : {}),
      ...(p.sgptRank !== undefined ? { sgptRank: p.sgptRank } : {}),
      ...(p.owner ? { owner: p.owner } : {}),
      ...(p.player.status ? { status: p.player.status } : {}),
      stats: statsByLabel(table.columns, p.stats),
    }));
}

export function snapshotPlayerLeaders(dto: PlayerStatsResponse, cap = DEFAULT_PLAYER_CAP) {
  return {
    batting: topPlayers(dto.batting, cap),
    pitching: topPlayers(dto.pitching, cap),
  };
}

/**
 * Value+ scores for a specific set of named players, resolved across both the batting
 * and pitching pools. Returns the compact per-player value line (score, cross-position rank,
 * and category values) sorted best-first, plus any names that didn't match the rostered pool.
 * Purpose-built for head-to-head value comparisons the co-manager makes on demand.
 */
export function snapshotValueScores(
  dto: PlayerStatsResponse,
  names: string[],
): {
  players: {
    name: string;
    pos: 'B' | 'P';
    team?: string;
    sgptPlus?: number;
    sgptRank?: number;
    owner?: string;
    status?: string;
    stats: Record<string, number | string>;
  }[];
  unmatched?: string[];
} {
  const index = new Map<
    string,
    {
      line: PlayerStatsResponse['batting']['players'][number];
      columns: StatColumn[];
      pos: 'B' | 'P';
    }
  >();
  for (const [pos, table] of [
    ['B', dto.batting],
    ['P', dto.pitching],
  ] as const) {
    for (const line of table.players) {
      const key = normalizeName(line.player.fullName);
      if (!index.has(key)) index.set(key, { line, columns: table.columns, pos });
    }
  }

  const players: ReturnType<typeof snapshotValueScores>['players'] = [];
  const unmatched: string[] = [];
  for (const name of names) {
    const hit = index.get(normalizeName(name));
    if (!hit) {
      unmatched.push(name);
      continue;
    }
    const { line, columns, pos } = hit;
    players.push({
      name: line.player.fullName,
      pos,
      ...(line.player.mlbTeamAbbr ? { team: line.player.mlbTeamAbbr } : {}),
      ...(line.sgptPlus !== undefined ? { sgptPlus: line.sgptPlus } : {}),
      ...(line.sgptRank !== undefined ? { sgptRank: line.sgptRank } : {}),
      ...(line.owner ? { owner: line.owner } : {}),
      ...(line.player.status ? { status: line.player.status } : {}),
      stats: statsByLabel(columns, line.stats),
    });
  }
  // Best value first; unscored players sort last.
  players.sort((a, b) => (a.sgptRank ?? Infinity) - (b.sgptRank ?? Infinity));
  return { players, ...(unmatched.length > 0 ? { unmatched } : {}) };
}

export function snapshotFreeAgents(dto: LeagueFreeAgentsResponse, cap = DEFAULT_PLAYER_CAP) {
  return {
    range: dto.range,
    // Lead with the best Value+ pickups (scored against the rostered pool), not Yahoo's order.
    batting: topPlayers(dto.batting, cap, true),
    pitching: topPlayers(dto.pitching, cap, true),
  };
}
