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

/** Suggested starter prompts shown on the empty chat state. */
export const previewChatSuggestions = [
  'What areas should I focus on to climb the standings?',
  'Which of my players are struggling and I need to keep an eye on?',
  'Who are my best trade partners and why?',
  'What free agents would give me some value?',
  'Are there any buy low opportunities that would help me?',
  'Am I trending up or down? Rate the necessity of me making a move to ensure I make the playoffs.',
  'What teams are trending up or down?',
] as const;
