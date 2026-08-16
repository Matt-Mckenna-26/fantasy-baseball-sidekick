import { Fragment, type ReactNode } from 'react';

import styles from './dataTable.module.css';

/**
 * Mobile-only sub-line under a player/team name that collapses metadata columns
 * (position, MLB/fantasy team, injury status, …) into the identity cell. This
 * frees the horizontal space those columns took so more stat columns fit without
 * scrolling — the whole point on phones. Hidden on desktop via CSS (.metaFooter),
 * so callers can render it unconditionally in every grid.
 */
export function PlayerMetaFooter({ items }: { items: ReactNode[] }) {
  const parts = items.filter((x) => x != null && x !== '');
  if (parts.length === 0) return null;
  return (
    <span className={styles.metaFooter}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span className={styles.metaSep} aria-hidden="true">
              ·
            </span>
          ) : null}
          <span className={styles.metaItem}>{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
