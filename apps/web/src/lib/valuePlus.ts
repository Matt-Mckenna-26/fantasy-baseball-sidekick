/**
 * Single source of truth for the "Value+" label and its explanation, so every surface that
 * shows the stat (Players grid, compare/mentioned-player chips, the player modal, and hovers
 * inside chat replies) uses the exact same copy.
 */

export const VALUE_PLUS_LABEL = 'Value+';

/** Plain-language explainer used as the hover text everywhere Value+ appears. */
export const VALUE_PLUS_EXPLAINER =
  "Value+ rates a player's overall fantasy value from their average percentile across your " +
  'league’s scoring categories, indexed so 100 = league average and higher is better. Hitters ' +
  'and pitchers share one scale, so the rank spans both. Innings pitched isn’t scored — it only ' +
  'sets the minimum innings a pitcher needs to qualify, so relievers aren’t punished for low volume. ' +
  'Role-only categories (Saves/Holds for relievers, Quality Starts for starters) count only for ' +
  'the pitchers who actually pitch that role, so a reliever isn’t docked for Quality Starts nor a starter for Saves.';

/** Hover text for an empty Value+ cell (unqualified pitcher, or a player with no scored cats). */
export const VALUE_PLUS_UNQUALIFIED =
  'No Value+ yet — not enough innings pitched to qualify, or no scored categories. ' +
  VALUE_PLUS_EXPLAINER;

/**
 * Full hover text for a Value+ badge: leads with this player's number and cross-position rank,
 * then the shared explainer. Falls back gracefully when the value or rank is missing.
 */
export function valuePlusTitle(plus?: number | null, rank?: number | null): string {
  const head =
    typeof plus === 'number'
      ? typeof rank === 'number'
        ? `Value+ ${plus} · #${rank} overall (hitters + pitchers).`
        : `Value+ ${plus}.`
      : 'Value+.';
  return `${head} ${VALUE_PLUS_EXPLAINER}`;
}
