/**
 * Persists the league the user chose at sign-in so it carries across pages
 * (Home picker -> Rosters/Stats). This is UX state only - the closed-beta
 * allowlist is enforced server-side, so a stale/tampered value cannot grant access.
 */
const STORAGE_KEY = 'fcm.selectedLeagueId';

export function getSelectedLeagueId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setSelectedLeagueId(leagueId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, leagueId);
  } catch {
    // Ignore storage failures (e.g. private mode); selection just won't persist.
  }
}
