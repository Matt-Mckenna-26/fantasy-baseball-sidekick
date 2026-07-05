import { useEffect, useMemo, useState } from 'react';
import styles from './charts.module.css';

/** How often the status verb changes while loading (mirrors the global overlay cadence). */
const VERB_INTERVAL_MS = 1900;

/**
 * Inline loading state for a chart while its data is fetched. Mirrors the global
 * LoadingOverlay's spinner + cycling baseball verb, scoped to the chart card so the
 * page overlay never pops for these silent trailing-week requests.
 */
export function ChartLoading({ weeks, verbs: verbsProp }: { weeks?: number; verbs?: string[] }) {
  const verbs = useMemo(
    () =>
      verbsProp ?? [
        `Pulling the last ${weeks} weeks`,
        'Reading the box scores',
        'Charting the trend',
      ],
    [weeks, verbsProp],
  );
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % verbs.length), VERB_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [verbs.length]);

  return (
    <div className={styles.loading} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <span key={i} className={styles.loadingVerb}>
        {verbs[i]}
        <span className={styles.ellipsis} aria-hidden="true" />
      </span>
    </div>
  );
}
