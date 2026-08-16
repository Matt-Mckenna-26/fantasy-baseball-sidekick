import type { MlbGameState } from '@fcm/contracts';

/** A one-line summary of an MLB game plus whether it is live (so callers can style it). */
export interface MlbGameLine {
  live: boolean;
  text: string;
}

/** "NYY 3-2 TB" when scored, else "NYY @ TB". */
function scoreText(game: MlbGameState): string {
  if (game.homeScore !== undefined && game.awayScore !== undefined) {
    return `${game.awayAbbr} ${game.awayScore}-${game.homeScore} ${game.homeAbbr}`;
  }
  return `${game.awayAbbr} @ ${game.homeAbbr}`;
}

/**
 * Format a game's status line consistently across the Rosters ticker and the Matchups
 * player subtitle: live shows the half-inning + score, final/scheduled show a prefix +
 * score. Returns `null` when there is nothing to show.
 */
export function formatMlbGameLine(game: MlbGameState | undefined): MlbGameLine | null {
  if (!game) return null;
  const score = scoreText(game);
  if (game.state === 'live') {
    const half = [game.inningState, game.inning].filter(Boolean).join(' ');
    return { live: true, text: half ? `${half} · ${score}` : score };
  }
  if (game.state === 'final') {
    return { live: false, text: `Final · ${score}` };
  }
  const time = game.startTime
    ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'Scheduled';
  return { live: false, text: `${time} · ${score}` };
}
