/**
 * Chart palette + theme for the Analyze League visualizations. Colors are vivid but
 * readable on the app's dark surfaces; the theme constants mirror the design tokens in
 * styles.css (used where Recharts needs literal SVG colors, not CSS variables).
 */

/** Distinct team line/bar colors, cycled by team order for stable, consistent hues. */
export const CHART_COLORS = [
  '#7c3aed',
  '#22d3ee',
  '#f472b6',
  '#34d399',
  '#fbbf24',
  '#60a5fa',
  '#f87171',
  '#a3e635',
  '#c084fc',
  '#2dd4bf',
  '#fb923c',
  '#e879f9',
  '#38bdf8',
  '#facc15',
] as const;

/** Literal colors matching the styles.css tokens, for Recharts SVG props. */
export const CHART_THEME = {
  text: '#e2e8f0',
  muted: '#94a3b8',
  border: '#334155',
  panel: '#1e293b',
  accent: '#7c3aed',
} as const;

/** Map each team id to a stable color by its order in the list (consistent across charts). */
export function buildTeamColorMap(teamIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  teamIds.forEach((id, i) => {
    map.set(id, CHART_COLORS[i % CHART_COLORS.length]!);
  });
  return map;
}
