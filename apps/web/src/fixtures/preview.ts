/**
 * PREVIEW-ONLY fixtures for the AI chat UI. Chat is not Yahoo data, so it is not
 * gated by the auth/data boundary; this seeds the transcript and starter prompts
 * until the chat endpoint (AI co-manager) is implemented. Typed with `satisfies`
 * so it cannot drift from the ChatMessage contract.
 */
import type { ChatMessage } from '@fcm/contracts';

/** A short seeded transcript so the chat layout can be reviewed with content. */
export const previewChatHistory = [
  {
    id: 'seed-1',
    role: 'assistant',
    content:
      "Hi! I'm your fantasy baseball co-manager. Try one of the suggested prompts below, or just tell me what you'd like help with to improve your team - start/sit calls, waiver targets, trade ideas, you name it.",
    createdAt: '2026-06-26T14:00:00.000Z',
  },
] satisfies ChatMessage[];

/**
 * Suggested starter prompts shown on the empty chat state. Clicking one fills the composer.
 * Written to pull the co-manager toward careful, web-grounded analysis - naming FantasyPros
 * rest-of-season projections/rankings and the latest injury/role news alongside league data -
 * rather than one-line answers off stale training knowledge.
 */
export const previewChatSuggestions = [
  'Compare my free agents to FantasyPros rest-of-season rankings and my roster gaps, then name the top adds worth researching.',
  "What's my weakest scoring category, and which available players have the rest-of-season projections to fix it?",
  'Give me start/sit calls for this week using recent form, matchups, and the latest injury and role news.',
  'Find a buy-low trade target whose value dropped on an injury or cold start but whose rest-of-season outlook is still strong.',
  'Flag any of my players trending down in role, health, or rest-of-season projection.',
] as const;
