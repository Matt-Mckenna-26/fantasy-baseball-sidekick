import { useMemo, useState } from 'react';
import type { MentionedPlayer } from '@fcm/contracts';
import { CompareEntityTiles } from './charts/CompareEntityTiles';
import { PlayerNameButton } from './PlayerNameButton';
import type { CompareEntity } from './charts/compareEntity';
import type { LeagueStatPool } from '../hooks/useLeagueStatPool';
import { toCompareEntity } from '../lib/statPool';
import styles from './MentionedPlayers.module.css';

const INITIAL_TILE_LIMIT = 4;

type TileEntry = { table: 'batting' | 'pitching'; entity: CompareEntity };
type TilesMode = 'collapsed' | 'preview' | 'expanded';

/**
 * The "Players mentioned" section rendered under an assistant reply: the same rank cards as
 * the Players page (CompareEntityTiles) for every player the co-manager tagged, plus a button
 * that opens those players on the Players tab. Ranks come from the shared league pool so the
 * cards match the Players grid exactly.
 */
export function MentionedPlayers({
  players,
  pool,
  onAnalyze,
}: {
  players: MentionedPlayer[];
  pool: LeagueStatPool;
  onAnalyze: (playerIds: string[]) => void;
}) {
  const [tilesMode, setTilesMode] = useState<TilesMode>('preview');

  // Preserve mention order; each tile ranks against batting or pitching columns as appropriate.
  const { allTiles, unresolved } = useMemo(() => {
    const tiles: TileEntry[] = [];
    const missing: MentionedPlayer[] = [];
    for (const player of players) {
      const isPitcher =
        player.positionType === 'P' ||
        (player.positionType === undefined && pool.pitching.lineById.has(player.playerId));
      const table = isPitcher ? pool.pitching : pool.batting;
      const line = table.lineById.get(player.playerId);
      if (line) {
        tiles.push({
          table: isPitcher ? 'pitching' : 'batting',
          entity: toCompareEntity(line),
        });
      } else {
        missing.push(player);
      }
    }
    return { allTiles: tiles, unresolved: missing };
  }, [players, pool]);

  const visibleTiles = useMemo(() => {
    if (tilesMode === 'collapsed') return [];
    if (tilesMode === 'expanded') return allTiles;
    return allTiles.slice(0, INITIAL_TILE_LIMIT);
  }, [allTiles, tilesMode]);

  const battingVisible = useMemo(
    () => visibleTiles.filter((t) => t.table === 'batting').map((t) => t.entity),
    [visibleTiles],
  );
  const pitchingVisible = useMemo(
    () => visibleTiles.filter((t) => t.table === 'pitching').map((t) => t.entity),
    [visibleTiles],
  );

  if (players.length === 0) return null;

  const totalTiles = allTiles.length;
  const hasCards = totalTiles > 0;
  const showTiles = tilesMode !== 'collapsed';

  return (
    <section className={styles.section} aria-label="Players mentioned">
      <div className={styles.header}>
        <h3 className={styles.title}>Players mentioned</h3>
        <button
          type="button"
          className={styles.analyzeBtn}
          onClick={() => onAnalyze(players.map((p) => p.playerId))}
        >
          Analyze players mentioned
        </button>
      </div>

      {pool.status === 'loading' && !hasCards ? (
        <p className={styles.note}>Loading player cards…</p>
      ) : null}

      {showTiles && battingVisible.length > 0 ? (
        <CompareEntityTiles
          entities={battingVisible}
          columns={pool.batting.columns}
          percentiles={pool.batting.percentiles}
          ranks={pool.batting.ranks}
        />
      ) : null}

      {showTiles && pitchingVisible.length > 0 ? (
        <CompareEntityTiles
          entities={pitchingVisible}
          columns={pool.pitching.columns}
          percentiles={pool.pitching.percentiles}
          ranks={pool.pitching.ranks}
        />
      ) : null}

      {totalTiles > 0 ? (
        <div className={styles.tileControls}>
          {tilesMode === 'collapsed' ? (
            <button
              type="button"
              className={styles.tileToggle}
              onClick={() => setTilesMode('preview')}
            >
              Show player cards ({totalTiles})
            </button>
          ) : (
            <>
              {tilesMode === 'preview' && totalTiles > INITIAL_TILE_LIMIT ? (
                <button
                  type="button"
                  className={styles.tileToggle}
                  onClick={() => setTilesMode('expanded')}
                >
                  Show {totalTiles - INITIAL_TILE_LIMIT} more
                </button>
              ) : null}
              {tilesMode === 'expanded' && totalTiles > INITIAL_TILE_LIMIT ? (
                <button
                  type="button"
                  className={styles.tileToggle}
                  onClick={() => setTilesMode('preview')}
                >
                  Show less
                </button>
              ) : null}
              <button
                type="button"
                className={styles.tileToggle}
                onClick={() => setTilesMode('collapsed')}
              >
                Hide cards
              </button>
            </>
          )}
        </div>
      ) : null}

      {showTiles && pool.status === 'ready' && unresolved.length > 0 ? (
        <div className={styles.chips}>
          {unresolved.map((p) => (
            <span key={p.playerId} className={styles.chip}>
              <PlayerNameButton
                target={{
                  playerId: p.playerId,
                  fullName: p.fullName,
                  ...(p.mlbTeamAbbr ? { mlbTeamAbbr: p.mlbTeamAbbr } : {}),
                  ...(p.positionType ? { positionType: p.positionType } : {}),
                  ...(p.headshotUrl ? { headshotUrl: p.headshotUrl } : {}),
                }}
              />
              {p.mlbTeamAbbr ? <span className={styles.chipTeam}> ({p.mlbTeamAbbr})</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
