import { themeQuartz, type ColDef } from 'ag-grid-community';

/**
 * Dark quartz theme matching the night-diamond tokens in styles.css.
 * Literal colors because ag-grid paints onto canvas/DOM without CSS variables.
 */
export const gridTheme = themeQuartz.withParams({
  backgroundColor: '#141c2e',
  foregroundColor: '#f2f5fb',
  headerTextColor: '#9aa8bd',
  headerBackgroundColor: '#141c2e',
  borderColor: 'rgba(255, 255, 255, 0.1)',
  chromeBackgroundColor: '#141c2e',
  oddRowBackgroundColor: 'rgba(255, 255, 255, 0.03)',
  rowHoverColor: 'rgba(109, 77, 255, 0.12)',
  accentColor: '#8b74ff',
  fontFamily: 'inherit',
});

/** Tighter spacing so phones can show identity plus several scoring columns. */
export const gridThemeNarrow = themeQuartz.withParams({
  backgroundColor: '#141c2e',
  foregroundColor: '#f2f5fb',
  headerTextColor: '#9aa8bd',
  headerBackgroundColor: '#141c2e',
  borderColor: 'rgba(255, 255, 255, 0.1)',
  chromeBackgroundColor: '#141c2e',
  oddRowBackgroundColor: 'rgba(255, 255, 255, 0.03)',
  rowHoverColor: 'rgba(109, 77, 255, 0.12)',
  accentColor: '#8b74ff',
  fontFamily: 'inherit',
  spacing: 4,
  headerFontSize: 11,
  dataFontSize: 12,
  cellHorizontalPadding: 4,
});

/** Pinned player/team identity: enough for a headshot + readable name, not half the screen. */
export const NARROW_IDENTITY_COL = {
  minWidth: 118,
  width: 128,
  maxWidth: 148,
  flex: 0,
} satisfies Partial<ColDef>;

/** Rank / Value+ badges. */
export const NARROW_BADGE_COL = {
  width: 54,
  minWidth: 48,
  maxWidth: 60,
  flex: 0,
  suppressHeaderMenuButton: true,
} satisfies Partial<ColDef>;

/** Scoring cats (R, HR, ERA…): single-digit or short decimals. */
export const NARROW_STAT_COL = {
  width: 48,
  minWidth: 44,
  maxWidth: 56,
  flex: 0,
  suppressHeaderMenuButton: true,
} satisfies Partial<ColDef>;
