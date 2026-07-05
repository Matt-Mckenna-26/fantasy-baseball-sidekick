import { useEffect, useId, useRef, useState } from 'react';
import styles from '../../pages/StatsPage.module.css';

const SEEN_KEY = 'player-trend-help-seen';

/**
 * "?" popover explaining the percentile recent-form chart, styled like the grid's help.
 * Clarifies that lines are percentiles within the rostered pool (so windows compare on
 * one scale) and that the dashed line is each player's season baseline.
 */
export function PlayerTrendHelp() {
  const [open, setOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== '1';
    } catch {
      return false;
    }
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.gridHelp} ref={rootRef}>
      <button
        type="button"
        className={styles.gridHelpTrigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          showBadge ? 'How the recent-form chart works (new guide)' : 'How the recent-form chart works'
        }
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next && showBadge) {
              setShowBadge(false);
              try {
                localStorage.setItem(SEEN_KEY, '1');
              } catch {
                // Non-fatal: a blocked localStorage just means the badge shows again next visit.
              }
            }
            return next;
          });
        }}
      >
        ?{showBadge ? <span className={styles.gridHelpBadge} aria-hidden /> : null}
      </button>
      {open ? (
        <div
          id={panelId}
          className={styles.gridHelpPanel}
          role="dialog"
          aria-label="Recent-form chart guide"
        >
          <p className={styles.gridHelpLead}>
            Each line tracks a player&rsquo;s <strong>percentile (0-100)</strong> for the selected
            stat among all rostered {`batters or pitchers`} in your league, so different windows
            compare on one scale.
          </p>
          <section className={styles.gridHelpSection}>
            <h3 className={styles.gridHelpHeading}>Reading the chart</h3>
            <ul className={styles.gridHelpList}>
              <li>
                The solid line connects <strong>Last 30 &rarr; Last 7</strong> &mdash; the recent
                trend. Rising means the player is heating up relative to the pool.
              </li>
              <li>
                The <strong>dashed line</strong> in each player&rsquo;s color is their{' '}
                <strong>season</strong> percentile &mdash; the baseline. Above it = hotter than their
                season-long rank; below it = cooling off.
              </li>
              <li>
                Percentiles use the same rank as the grid&rsquo;s heat colors, so for lower-is-better
                stats (ERA, WHIP, etc.) a higher percentile still means better.
              </li>
              <li>Hover a point to see each player&rsquo;s percentile and their season baseline.</li>
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
