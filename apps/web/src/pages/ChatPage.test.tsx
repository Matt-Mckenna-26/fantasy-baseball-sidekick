import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatResponse } from '@fcm/contracts';
import { ChatPage } from './ChatPage';

vi.mock('../api/client', () => ({ sendChatMessage: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../context/SessionContext', () => ({
  useSession: () => ({
    session: {
      status: 'connected',
      selectedLeague: { leagueId: '469.l.101214', name: 'The Show', season: '2026' },
    },
  }),
}));

import { sendChatMessage } from '../api/client';

const reply: ChatResponse = {
  message: {
    id: 'r1',
    role: 'assistant',
    content: 'Your bats lead the league in HR.',
    createdAt: '2026-07-05T00:00:00.000Z',
  },
  toolsUsed: ['get_league_team_stats'],
};

describe('ChatPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('sends the transcript (with league) and renders the reply', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Message TheShowGPT'), 'what should I target?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Your bats lead the league in HR.')).toBeInTheDocument();
    expect(sendChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: '469.l.101214',
        messages: expect.arrayContaining([{ role: 'user', content: 'what should I target?' }]),
      }),
      expect.objectContaining({ onToolEvent: expect.any(Function) }),
    );
  });

  it('renders a collapsed activity summary from streamed tool events', async () => {
    vi.mocked(sendChatMessage).mockImplementation(async (_req, handlers) => {
      handlers?.onToolEvent?.({ type: 'tool', name: 'get_league_standings', phase: 'start' });
      handlers?.onToolEvent?.({ type: 'tool', name: 'get_league_standings', phase: 'end', ok: true });
      return reply;
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Message TheShowGPT'), 'how are the standings?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Used 1 tool')).toBeInTheDocument();
    expect(screen.getByText('Checking the standings')).toBeInTheDocument();
  });

  it('persists the transcript to localStorage and restores it on remount', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    const { unmount } = render(<ChatPage />);

    await user.type(screen.getByLabelText('Message TheShowGPT'), 'what should I target?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Your bats lead the league in HR.');

    unmount();
    render(<ChatPage />);

    expect(await screen.findByText('what should I target?')).toBeInTheDocument();
    expect(screen.getByText('Your bats lead the league in HR.')).toBeInTheDocument();
  });

  it('trims the oldest entries from a persisted transcript over the cap', async () => {
    const overCap = Array.from({ length: 60 }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      content: `message ${i}`,
      createdAt: '2026-07-05T00:00:00.000Z',
    }));
    localStorage.setItem('theshowgpt.chat.v1', JSON.stringify(overCap));

    render(<ChatPage />);

    expect(await screen.findByText('message 59')).toBeInTheDocument();
    expect(screen.getByText('message 10')).toBeInTheDocument();
    expect(screen.queryByText('message 9')).not.toBeInTheDocument();
    expect(screen.queryByText('message 0')).not.toBeInTheDocument();
  });

  it('shows a friendly error bubble when the request fails', async () => {
    vi.mocked(sendChatMessage).mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Message TheShowGPT'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/I hit a snag reaching your league data/)).toBeInTheDocument();
  });
});
