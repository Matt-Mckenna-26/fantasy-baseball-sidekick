import { memo } from 'react';
import type { PlayerStatLine, StatColumn } from '@fcm/contracts';
import { toNumericValue } from '../../lib/teamTrend';
import { heatColor } from '../PercentileHeatCell';
import { PlayerAvatar } from '../PlayerAvatar';
import styles from './charts.module.css';

/** English ordinal for a rank, e.g. 3 -> "3rd". */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Per-player reference tiles shown under the grouped compare chart: one card per player
 * being compared, listing every stat's raw value and the player's rank in that stat among
 * all rostered players (colored by percentile to echo the grid + chart). Grounds the
 * abstract percentile bars in concrete numbers right next to the view.
 */
export const ComparePlayerTiles = memo(function ComparePlayerTiles({
  players,
  columns,
  percentiles,
  ranks,
}: {
  players: PlayerStatLine[];
  columns: ReadonlyArray<StatColumn>;
  percentiles: Map<string, (value: number) => number>;
  ranks: Map<string, (value: number) => { rank: number; total: number }>;
}) {
  if (players.length === 0 || columns.length === 0) return null;

  return (
    <div className={styles.compareTiles}>
      {players.map((p) => {
        const byKey = new Map(p.stats.map((s) => [s.key, s.value]));
        return (
          <div key={p.player.playerId} className={styles.compareTile}>
            <div className={styles.compareTileHead}>
              <span className={styles.tooltipAvatar}>
                <PlayerAvatar
                  fullName={p.player.fullName}
                  {...(p.player.headshotUrl ? { headshotUrl: p.player.headshotUrl } : {})}
                />
              </span>
              <span className={styles.compareTileNameCol}>
                <span className={styles.compareTileName}>{p.player.fullName}</span>
                {p.owner ? <span className={styles.compareTileOwner}>{p.owner}</span> : null}
              </span>
            </div>
            <div className={styles.compareTileStats}>
              {columns.map((col) => {
                const raw = byKey.get(col.key);
                const num = toNumericValue(raw);
                const display = raw == null ? '-' : String(raw);
                const pct = num == null ? null : (percentiles.get(col.key)?.(num) ?? null);
                const r = num == null ? null : (ranks.get(col.key)?.(num) ?? null);
                return (
                  <div key={col.key} className={styles.compareStatRow}>
                    <span className={styles.compareStatLabel} title={col.description ?? col.label}>
                      {col.label}
                    </span>
                    <span className={styles.compareStatValue}>{display}</span>
                    <span
                      className={styles.compareStatRank}
                      style={pct == null ? undefined : { background: heatColor(pct) }}
                      title={r ? `${ordinal(r.rank)} of ${r.total} rostered` : undefined}
                    >
                      {r ? ordinal(r.rank) : '\u2013'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});
