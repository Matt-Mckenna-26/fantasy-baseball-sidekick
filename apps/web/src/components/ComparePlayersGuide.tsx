import { useEffect, useState } from 'react';
import styles from '../pages/StatsPage.module.css';

const SEEN_KEY = 'fcm.comparePlayersGuideSeen.v5';

function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * One-time modal shown on a user's first visit to Player Stats, walking them through the
 * filter -> Compare -> grouped-chart flow for comparing players. Dismissal is remembered
 * in localStorage so it never interrupts again.
 */
export function ComparePlayersGuide() {
  const [open, setOpen] = useState(() => !hasSeen());

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Ignore storage failures (e.g. private mode); the guide may reappear next visit.
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={styles.guideOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-guide-title"
    >
      <div className={styles.guideCard}>
        <span className={styles.guideKicker}>New</span>
        <h2 id="compare-guide-title" className={styles.guideTitle}>
          Compare players head-to-head
        </h2>
        <p className={styles.guideLead}>
          The comparison chart is always on &mdash; it tracks the grid&rsquo;s top ten rows across
          every stat.
        </p>
        <ol className={styles.guideSteps}>
          <li>
            <strong>Easiest: use Compare players.</strong> Click the{' '}
            <em>Compare players</em> button above the grid, search and add the players you want, then
            hit Compare &mdash; the grid filters and the chart scrolls into view.
          </li>
          <li>
            <strong>Or work from the grid.</strong> Sort by any stat header, or filter the{' '}
            <em>Player</em> / <em>Team</em> column &mdash; the chart automatically shows the grid&rsquo;s
            top ten.
          </li>
          <li>
            <strong>Read the chart &amp; tiles.</strong> The grouped bars show each player&rsquo;s
            percentile per metric (taller = better); the tiles below list every stat&rsquo;s raw
            value and that player&rsquo;s rank among all rostered players. In chart controls, click a
            metric to toggle it or double-click to isolate one.
          </li>
        </ol>
        <button type="button" className={styles.guidePrimary} onClick={dismiss} autoFocus>
          Got it
        </button>
      </div>
    </div>
  );
}
