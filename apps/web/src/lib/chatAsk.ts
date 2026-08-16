/** Query param ChatRuntimeProvider reads to auto-send a prompt in a fresh thread. */
export const CHAT_ASK_PARAM = 'ask';

/** True when the card's fantasy owner is the user's selected team. Free agents (no owner)
 *  and other managers' players are not on my team. */
export function playerIsOnMyTeam(
  owner: string | undefined,
  myTeamName: string | undefined,
): boolean {
  return Boolean(owner && myTeamName && owner === myTeamName);
}

/** Prompt the player-card "Ask TheShowGPT" button launches. Rostered-on-my-team players
 *  get "value to my team"; everyone else is framed as a potential add. */
export function playerResearchPrompt(fullName: string, onMyTeam: boolean): string {
  const valueClause = onMyTeam
    ? 'his value to my team'
    : 'his potential value if added to my team';
  return `Help me research ${fullName} and ${valueClause}`;
}

/** Chat route that starts a new thread and sends `prompt`. */
export function chatAskPath(prompt: string): string {
  return `/chat?${CHAT_ASK_PARAM}=${encodeURIComponent(prompt)}`;
}
