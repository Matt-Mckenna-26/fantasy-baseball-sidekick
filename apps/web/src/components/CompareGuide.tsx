import { useEffect, useState } from 'react';
import styles from '../pages/StatsPage.module.css';

/**
 * One-time modal shown on a user's first visit to a stats page, walking them through the
 * filter -> Compare -> grouped-chart flow. `noun` tailors the copy for players or teams,
 * and `seenKey` scopes the "seen" flag so each page is remembered independently. Dismissal
 * is stored in localStorage so it never interrupts again.
 */
export function CompareGuide({ noun, seenKey }: { noun: 'player' | 'team'; seenKey: string }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(seenKey) !== '1';
    } catch {
      return false;
    }
  });

  const plural = noun === 'team' ? 'teams' : 'players';
  const filterLabel = noun === 'team' ? 'Team' : 'Player / Team';
  const poolLabel = noun === 'team' ? 'the league' : 'all rostered players';

  const dismiss = () => {
    try {
      localStorage.setItem(seenKey, '1');
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
          Compare {plural} head-to-head
        </h2>
        <p className={styles.guideLead}>
          The comparison chart is always on &mdash; it tracks the grid&rsquo;s top rows across every
          stat.
        </p>
        <ol className={styles.guideSteps}>
          <li>
            <strong>Easiest: use Compare {plural}.</strong> Click the <em>Compare {plural}</em> button
            above the grid, search and add the {plural} you want, then hit Compare &mdash; the grid
            filters and the chart scrolls into view.
          </li>
          <li>
            <strong>Or work from the grid.</strong> Sort by any stat header, or filter the{' '}
            <em>{filterLabel}</em> column &mdash; the chart automatically shows the grid&rsquo;s top
            rows.
          </li>
          <li>
            <strong>Read the chart &amp; tiles.</strong> The grouped bars show each {noun}&rsquo;s
            percentile per metric (taller = better); the tiles below list every stat&rsquo;s raw value
            and that {noun}&rsquo;s rank among {poolLabel}. In chart controls, click a metric to toggle
            it or double-click to isolate one.
          </li>
        </ol>
        <button type="button" className={styles.guidePrimary} onClick={dismiss} autoFocus>
          Got it
        </button>
      </div>
    </div>
  );
}
