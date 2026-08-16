import { describe, it, expect } from 'vitest';
import { CHAT_ASK_PARAM, chatAskPath, playerIsOnMyTeam, playerResearchPrompt } from './chatAsk';

describe('chatAsk', () => {
  it('asks about value to my team when the player is already rostered there', () => {
    expect(playerResearchPrompt('Aaron Judge', true)).toBe(
      'Help me research Aaron Judge and his value to my team',
    );
  });

  it('asks about potential add value when the player is not on my team', () => {
    expect(playerResearchPrompt('Shohei Ohtani', false)).toBe(
      'Help me research Shohei Ohtani and his potential value if added to my team',
    );
  });

  it('treats a matching owner as on my team, and FAs / other owners as not', () => {
    expect(playerIsOnMyTeam('Bronx Bombers', 'Bronx Bombers')).toBe(true);
    expect(playerIsOnMyTeam('Windy City Heat', 'Bronx Bombers')).toBe(false);
    expect(playerIsOnMyTeam(undefined, 'Bronx Bombers')).toBe(false);
    expect(playerIsOnMyTeam('Bronx Bombers', undefined)).toBe(false);
  });

  it('routes to chat with the prompt as the ask query param', () => {
    const path = chatAskPath(playerResearchPrompt('Shohei Ohtani', false));
    expect(path.startsWith('/chat?')).toBe(true);
    const params = new URLSearchParams(path.slice(path.indexOf('?')));
    expect(params.get(CHAT_ASK_PARAM)).toBe(
      'Help me research Shohei Ohtani and his potential value if added to my team',
    );
  });
});
