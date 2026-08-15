import { memo } from 'react';
import type { StatColumn } from '@fcm/contracts';
import { toNumericValue } from '../../lib/teamTrend';
import { valuePlusTitle } from '../../lib/valuePlus';
import { heatColor } from '../PercentileHeatCell';
import { PlayerNameButton } from '../PlayerNameButton';
import { CompareAvatar, type CompareEntity } from './compareEntity';
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
 * Per-entity reference tiles shown under the grouped compare chart: one card per entity
 * (player or team) being compared, listing every stat's raw value and its rank in that
 * stat among the whole pool (colored by percentile to echo the grid + chart). Grounds the
 * abstract percentile bars in concrete numbers right next to the view.
 */
export const CompareEntityTiles = memo(function CompareEntityTiles({
  entities,
  columns,
  percentiles,
  ranks,
  hideHeader = false,
  fillHeight = false,
}: {
  entities: CompareEntity[];
  columns: ReadonlyArray<StatColumn>;
  percentiles: Map<string, (value: number) => number>;
  ranks: Map<string, (value: number) => { rank: number; total: number }>;
  /** Suppress the per-tile avatar/name header (the caller renders its own, e.g. a prominent card header). */
  hideHeader?: boolean;
  /** Stretch the tile(s) to fill the parent's height, spacing rows out so ranks read large. */
  fillHeight?: boolean;
}) {
  if (entities.length === 0 || columns.length === 0) return null;

  return (
    <div className={`${styles.compareTiles}${fillHeight ? ` ${styles.compareTilesFill}` : ''}`}>
      {entities.map((e) => {
        const byKey = new Map(e.stats.map((s) => [s.key, s.value]));
        return (
          <div
            key={e.id}
            className={`${styles.compareTile}${fillHeight ? ` ${styles.compareTileFill}` : ''}`}
          >
            {hideHeader ? null : (
              <div className={styles.compareTileHead}>
                <span className={styles.tooltipAvatar}>
                  <CompareAvatar
                    name={e.name}
                    kind={e.kind}
                    {...(e.imageUrl ? { imageUrl: e.imageUrl } : {})}
                  />
                </span>
                <span className={styles.compareTileNameCol}>
                  <span className={styles.compareTileName}>
                    {e.kind === 'player' ? (
                      <PlayerNameButton
                        target={{
                          playerId: e.id,
                          fullName: e.name,
                          ...(e.imageUrl ? { headshotUrl: e.imageUrl } : {}),
                        }}
                      />
                    ) : (
                      e.name
                    )}
                  </span>
                  {e.subtitle ? (
                    <span className={styles.compareTileOwner}>{e.subtitle}</span>
                  ) : null}
                </span>
                {typeof e.sgptPlus === 'number' ? (
                  <span
                    className={styles.compareTileSgpt}
                    title={valuePlusTitle(e.sgptPlus, e.sgptRank)}
                  >
                    <span className={styles.compareTileSgptLabel}>Value+</span>
                    <span className={styles.compareTileSgptValue}>{e.sgptPlus}</span>
                  </span>
                ) : null}
              </div>
            )}
            <div
              className={`${styles.compareTileStats}${fillHeight ? ` ${styles.compareTileStatsFill}` : ''}`}
            >
              {columns.map((col) => {
                const raw = byKey.get(col.key);
                const num = toNumericValue(raw);
                const display = raw == null ? '-' : String(raw);
                const pct = num == null ? null : (percentiles.get(col.key)?.(num) ?? null);
                const r = num == null ? null : (ranks.get(col.key)?.(num) ?? null);
                return (
                  <div
                    key={col.key}
                    className={`${styles.compareStatRow}${fillHeight ? ` ${styles.compareStatRowFill}` : ''}`}
                  >
                    <span className={styles.compareStatLabel} title={col.description ?? col.label}>
                      {col.label}
                    </span>
                    <span className={styles.compareStatValue}>{display}</span>
                    <span
                      className={styles.compareStatRank}
                      style={pct == null ? undefined : { background: heatColor(pct) }}
                      title={r ? `${ordinal(r.rank)} of ${r.total}` : undefined}
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
