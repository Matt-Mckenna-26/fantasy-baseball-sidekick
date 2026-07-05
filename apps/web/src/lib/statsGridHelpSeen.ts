type StatsGridHelpScope = 'players' | 'teams' | 'matchup';

const storageKey = (scope: StatsGridHelpScope) => `fcm.statsGridHelpSeen.${scope}`;

export function hasSeenStatsGridHelp(scope: StatsGridHelpScope): boolean {
  try {
    return localStorage.getItem(storageKey(scope)) === '1';
  } catch {
    return false;
  }
}

export function markStatsGridHelpSeen(scope: StatsGridHelpScope): void {
  try {
    localStorage.setItem(storageKey(scope), '1');
  } catch {
    // Ignore storage failures (e.g. private mode); badge may reappear next visit.
  }
}
