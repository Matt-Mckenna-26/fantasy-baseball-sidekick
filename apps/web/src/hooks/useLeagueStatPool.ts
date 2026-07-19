import { useEffect, useState } from 'react';
import type { PlayerStatLine, StatColumn, StatRange, StatTable } from '@fcm/contracts';
import { getFreeAgents, getPlayerStats } from '../api/client';
import { buildStatPercentiles, buildStatRanks } from '../lib/percentile';
import { scoringColumns, toStatRow } from '../lib/statPool';

/** One table's pool: columns, every known line by id (rostered + FA), and rank/percentile maps. */
export interface StatPoolTable {
  columns: StatColumn[];
  /** Rostered + free-agent lines, keyed by playerId, for card lookups. */
  lineById: Map<string, PlayerStatLine>;
  /** Rank/percentile lookups built from the ROSTERED pool only, so numbers stay stable and a
   *  free agent shows "where they'd rank" among rostered players. */
  percentiles: Map<string, (value: number) => number>;
  ranks: Map<string, (value: number) => { rank: number; total: number }>;
}

export interface LeagueStatPool {
  status: 'idle' | 'loading' | 'ready' | 'error';
  batting: StatPoolTable;
  pitching: StatPoolTable;
}

function emptyTable(): StatPoolTable {
  return { columns: [], lineById: new Map(), percentiles: new Map(), ranks: new Map() };
}

function buildTable(rostered: StatTable, freeAgents: StatTable, isPitching: boolean): StatPoolTable {
  const columns = scoringColumns(rostered.columns);
  const rosteredRows = rostered.players.map((line) => toStatRow(line, columns));
  const lineById = new Map<string, PlayerStatLine>();
  for (const line of [...rostered.players, ...freeAgents.players]) {
    if (!lineById.has(line.player.playerId)) lineById.set(line.player.playerId, line);
  }
  return {
    columns,
    lineById,
    percentiles: buildStatPercentiles(rosteredRows, columns, isPitching),
    ranks: buildStatRanks(rosteredRows, columns, isPitching),
  };
}

/**
 * Fetch a league's rostered + free-agent stat pool for a window and derive the rank/percentile
 * lookups the compare cards need. Shared by the chat "Players mentioned" cards. Fetches only
 * when `enabled` (e.g. a reply actually tagged players), and refetches on league/range change.
 */
export function useLeagueStatPool(
  leagueId: string | undefined,
  range: StatRange,
  enabled: boolean,
): LeagueStatPool {
  const [pool, setPool] = useState<LeagueStatPool>({
    status: 'idle',
    batting: emptyTable(),
    pitching: emptyTable(),
  });

  useEffect(() => {
    if (!enabled || !leagueId) return;
    let stale = false;
    setPool((p) => ({ ...p, status: 'loading' }));
    Promise.all([
      getPlayerStats(leagueId, range, { silent: true }),
      // A missing/empty FA response must not break the cards; fall back to empty tables.
      getFreeAgents(leagueId, range, { silent: true }).catch(() => null),
    ])
      .then(([stats, fa]) => {
        if (stale) return;
        const emptyStatTable: StatTable = { columns: [], players: [] };
        setPool({
          status: 'ready',
          batting: buildTable(stats.batting, fa?.batting ?? emptyStatTable, false),
          pitching: buildTable(stats.pitching, fa?.pitching ?? emptyStatTable, true),
        });
      })
      .catch(() => {
        if (!stale) setPool({ status: 'error', batting: emptyTable(), pitching: emptyTable() });
      });
    return () => {
      stale = true;
    };
  }, [leagueId, range, enabled]);

  return pool;
}
