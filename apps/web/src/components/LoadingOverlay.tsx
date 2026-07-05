import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../lib/loadingStore';
import styles from './LoadingOverlay.module.css';

/** Rotating status verbs; cycled while the overlay is visible. */
const VERBS = [
  'Stepping up to the plate',
  'Reading the box score',
  'Crunching the numbers',
  'Checking the lineup card',
  'Rounding the bases',
  'Consulting the dugout',
  'Tracking the runners',
];

/** Wait this long before showing, so quick requests never flash the overlay. */
const SHOW_DELAY_MS = 180;
/** Once shown, keep it up at least this long to avoid a jarring flicker. */
const MIN_VISIBLE_MS = 450;
/** How often the status verb changes while visible. */
const VERB_INTERVAL_MS = 1900;

/**
 * Global content-area loading overlay. Reads the shared request counter and,
 * after a short delay, covers the main content with a frosted spinner and a
 * gently cycling status verb until all tracked requests settle.
 */
export function LoadingOverlay() {
  const loading = useSyncExternalStore(subscribe, getSnapshot);
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    let showTimer: number | undefined;
    let hideTimer: number | undefined;

    if (loading) {
      showTimer = window.setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, SHOW_DELAY_MS);
    } else if (visible) {
      const elapsed = Date.now() - shownAt.current;
      const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
      hideTimer = window.setTimeout(() => setVisible(false), remaining);
    }

    return () => {
      if (showTimer) window.clearTimeout(showTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [loading, visible]);

  const [verbIndex, setVerbIndex] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => {
      setVerbIndex((i) => (i + 1) % VERBS.length);
    }, VERB_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.panel}>
        <span className={styles.spinner} aria-hidden="true" />
        <span key={verbIndex} className={styles.verb}>
          {VERBS[verbIndex]}
          <span className={styles.ellipsis} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
