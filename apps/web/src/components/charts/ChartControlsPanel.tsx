import { useEffect, useId, useState, type ReactNode, type RefObject } from 'react';
import styles from './ChartControlsPanel.module.css';

function SlidersIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.fabIcon}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d="M3 6h9m3 0h2M3 14h2m3 0h9M12 6a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0ZM5 14a1.8 1.8 0 1 0 3.6 0A1.8 1.8 0 0 0 5 14Z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.closeIcon}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M5 5l10 10M15 5L5 15"
      />
    </svg>
  );
}

/**
 * Floating, icon-gated container for the Analyze League chart controls. A small round
 * icon sticks to the top-right (like the back-to-top shortcut) and is only shown while
 * the charts are in view (`anchorRef`). Clicking it opens a panel anchored beneath it
 * for changing the metric, range, and teams; it collapses back to the icon via the
 * icon, the close button, or Escape. Deliberately has no dimming backdrop so the charts
 * (and their loading state) stay visible while tweaking controls.
 */
/** Default key marking that the user has opened the chart controls (hides the badge). */
const DEFAULT_SEEN_KEY = 'analyze-chart-controls-seen';

export function ChartControlsPanel({
  children,
  anchorRef,
  seenKey = DEFAULT_SEEN_KEY,
  showInlineTrigger = true,
}: {
  children: ReactNode;
  anchorRef: RefObject<HTMLElement | null>;
  /** localStorage key for the "new" badge, so separate pages track it independently. */
  seenKey?: string;
  /** Visible opener above the charts for users who miss the floating icon. */
  showInlineTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inView, setInView] = useState(false);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(seenKey) === '1';
    } catch {
      return false;
    }
  });
  const panelId = useId();

  const markSeen = () => {
    if (seen) return;
    setSeen(true);
    try {
      localStorage.setItem(seenKey, '1');
    } catch {
      // Non-fatal: a blocked localStorage just means the badge shows again next visit.
    }
  };

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      if (next) markSeen();
      return next;
    });
  };

  const openPanel = () => {
    markSeen();
    setOpen(true);
  };

  // Reveal the trigger only while the charts region intersects the viewport.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((e) => e.isIntersecting)),
      { rootMargin: '0px 0px -20% 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchorRef]);

  // Collapse when the charts scroll away, so the panel never floats over other views.
  useEffect(() => {
    if (!inView) setOpen(false);
  }, [inView]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {showInlineTrigger && (
        <div className={styles.inlineWrap}>
          <button
            type="button"
            className={styles.inlineTrigger}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={seen ? 'Open chart controls' : 'Open chart controls (new)'}
            onClick={openPanel}
          >
            <SlidersIcon />
            <span>Chart controls</span>
            {!seen && <span className={styles.inlineBadge} aria-hidden="true" />}
          </button>
        </div>
      )}

      {(inView || open) && (
        <button
          type="button"
          className={styles.fab}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={seen ? 'Chart controls' : 'Chart controls (new)'}
          onClick={toggle}
        >
          <SlidersIcon />
          {!seen && <span className={styles.badge} aria-hidden="true" />}
        </button>
      )}

      <div
        id={panelId}
        className={`${styles.panel}${open ? ` ${styles.panelOpen}` : ''}`}
        role="dialog"
        aria-label="Chart controls"
        inert={!open}
      >
        <div className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>Chart controls</h3>
          <button
            type="button"
            className={styles.close}
            aria-label="Collapse chart controls"
            onClick={() => setOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
        <div className={styles.panelBody}>{children}</div>
      </div>
    </>
  );
}
