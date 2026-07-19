import styles from './charts.module.css';

function DownloadIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.downloadIcon}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10 3.5v9m0 0 3.25-3.25M10 12.5 6.75 9.25M4.5 14.5v1.75c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25v-1.75"
      />
    </svg>
  );
}

/** Toolbar control for raster chart exports — standard download icon + PNG label. */
export function ChartDownloadButton({
  onClick,
  disabled,
  busy,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.downloadBtn}
      onClick={onClick}
      disabled={disabled || busy}
      aria-label="Download chart as PNG"
      aria-busy={busy || undefined}
    >
      <DownloadIcon />
      <span>{busy ? 'Downloading\u2026' : 'Download PNG'}</span>
    </button>
  );
}
