import { useEffect, useState } from 'react';
import styles from './BackToTop.module.css';

/** How far the user must scroll down before the button appears. */
const SHOW_AFTER_PX = 400;

/** Floating control that scrolls the window back to the top; shown on every view. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className={styles.backToTop}
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.icon}>
        <path fill="currentColor" d="M8 3.4 13.2 8.6 11.8 10 8 6.2 4.2 10 2.8 8.6 8 3.4Z" />
      </svg>
    </button>
  );
}
