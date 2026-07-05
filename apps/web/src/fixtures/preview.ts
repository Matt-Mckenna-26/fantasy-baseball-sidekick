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
      "Hi! I'm your fantasy baseball co-manager. Ask me about start/sit calls, waiver targets, or trade ideas for your league.",
    createdAt: '2026-06-26T14:00:00.000Z',
  },
] satisfies ChatMessage[];

/** Suggested starter prompts shown on the empty chat state. */
export const previewChatSuggestions = [
  'Who should I start at 2B this week?',
  'Any waiver-wire pitchers worth streaming?',
  'Is Aaron Judge (DTD) safe to keep active?',
] as const;
