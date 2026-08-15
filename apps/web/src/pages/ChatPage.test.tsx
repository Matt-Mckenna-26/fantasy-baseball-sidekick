import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatResponse } from '@fcm/contracts';
import { ChatPage } from './ChatPage';

vi.mock('../api/client', () => ({ sendChatMessage: vi.fn(), YAHOO_LOGIN_URL: '/auth/yahoo' }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../context/SessionContext', () => ({
  useSession: () => ({
    session: {
      status: 'connected',
      leagues: [{ leagueId: '469.l.101214', name: 'The Show', season: '2026', allowed: true }],
      selectedLeague: { leagueId: '469.l.101214', name: 'The Show', season: '2026', allowed: true },
    },
  }),
}));

import { sendChatMessage } from '../api/client';
import { previewChatSuggestions } from '../fixtures/preview';

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
    vi.mocked(sendChatMessage).mockReset();
    localStorage.clear();
  });

  it('greets an empty thread with the league name and hides it after the first send', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<ChatPage />);

    expect(screen.getByRole('heading', { name: 'How can we help The Show today?' })).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Ask a question about your team'),
      'what should I target?',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Your bats lead the league in HR.')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'How can we help The Show today?' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('sends the transcript (with league) and renders the reply', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(
      screen.getByLabelText('Ask a question about your team'),
      'what should I target?',
    );
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

  it('fills the composer from a suggestion chip instead of sending immediately', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<ChatPage />);

    const suggestion = previewChatSuggestions[0];
    await user.click(screen.getByRole('button', { name: suggestion }));

    expect(screen.getByLabelText('Ask a question about your team')).toHaveValue(suggestion);
    expect(sendChatMessage).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() =>
      expect(sendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([{ role: 'user', content: suggestion }]),
        }),
        expect.anything(),
      ),
    );
  });

  it('renders each finished tool as its own bubble (no collapsed summary)', async () => {
    vi.mocked(sendChatMessage).mockImplementation(async (_req, handlers) => {
      handlers?.onToolEvent?.({ type: 'tool', name: 'get_league_standings', phase: 'start' });
      handlers?.onToolEvent?.({
        type: 'tool',
        name: 'get_league_standings',
        phase: 'end',
        ok: true,
      });
      return reply;
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(
      screen.getByLabelText('Ask a question about your team'),
      'how are the standings?',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('Checking the standings')).toBeInTheDocument();
    expect(screen.queryByText(/Used \d+ tool/)).not.toBeInTheDocument();
  });

  it('expands a tool bubble to reveal its streamed request and result', async () => {
    vi.mocked(sendChatMessage).mockImplementation(async (_req, handlers) => {
      handlers?.onToolEvent?.({
        type: 'tool',
        name: 'get_player_value',
        phase: 'start',
        args: '{"names":["Roki Sasaki"],"range":"season"}',
      });
      handlers?.onToolEvent?.({
        type: 'tool',
        name: 'get_player_value',
        phase: 'end',
        ok: true,
        result: '{"players":[{"name":"Roki Sasaki","sgptPlus":126}]}',
      });
      return reply;
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Ask a question about your team'), 'trade targets?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    // The tool has its own bubble; open it to reveal the request + result.
    await user.click(await screen.findByText('Scoring player value (Value+)'));

    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('Result')).toBeInTheDocument();
    // The captured args + output are beautified and syntax-highlighted into token spans.
    expect(screen.getByText('"season"')).toBeInTheDocument();
    expect(screen.getByText('126')).toBeInTheDocument();
  });

  it('persists the transcript to localStorage and restores it on remount', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    const { unmount } = render(<ChatPage />);

    await user.type(
      screen.getByLabelText('Ask a question about your team'),
      'what should I target?',
    );
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

    await user.type(screen.getByLabelText('Ask a question about your team'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/I hit a snag reaching your league data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('retries a failed turn', async () => {
    vi.mocked(sendChatMessage)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(reply);
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Ask a question about your team'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Your bats lead the league in HR.')).toBeInTheDocument();
    expect(sendChatMessage).toHaveBeenCalledTimes(2);
  });

  it('stops an in-flight reply without showing the error bubble', async () => {
    vi.mocked(sendChatMessage).mockImplementation(
      (_req, handlers) =>
        new Promise((_resolve, reject) => {
          handlers?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Ask a question about your team'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Stop generating' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stop generating' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/I hit a snag reaching your league data/)).not.toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('offers a copy control on assistant replies', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Ask a question about your team'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Copy reply' })).toBeInTheDocument();
  });

  it('clears the current chat and wipes it from storage after confirming', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(
      screen.getByLabelText('Ask a question about your team'),
      'what should I target?',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Your bats lead the league in HR.');

    await user.click(screen.getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Clear chat' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText('Your bats lead the league in HR.')).not.toBeInTheDocument(),
    );
    // Back to the empty-state greeting; nothing lingers in the transcript store.
    expect(screen.getByRole('heading', { name: 'How can we help The Show today?' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('theshowgpt.chat.v1') ?? '[]')).toEqual([]);
    confirmSpy.mockRestore();
  });

  it('archives the current chat, starts fresh, and restores it on demand', async () => {
    vi.mocked(sendChatMessage).mockResolvedValue(reply);
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(
      screen.getByLabelText('Ask a question about your team'),
      'what should I target?',
    );
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Your bats lead the league in HR.');

    await user.click(screen.getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive & start new' }));

    // Thread is empty again, but the archive is parked under its own key.
    await waitFor(() =>
      expect(screen.queryByText('what should I target?')).not.toBeInTheDocument(),
    );
    const archived = JSON.parse(localStorage.getItem('theshowgpt.chat.archive.v1') ?? '[]');
    expect(archived).toHaveLength(1);
    expect(archived[0].title).toBe('what should I target?');

    // Reopen it from the menu.
    await user.click(screen.getByRole('button', { name: 'Chat options' }));
    await user.click(
      screen.getByRole('button', { name: 'Open archived chat: what should I target?' }),
    );

    expect(await screen.findByText('what should I target?')).toBeInTheDocument();
    expect(screen.getByText('Your bats lead the league in HR.')).toBeInTheDocument();
  });

  it('drops the heavy tool request/result blobs from archives', async () => {
    vi.mocked(sendChatMessage).mockImplementation(async (_req, handlers) => {
      handlers?.onToolEvent?.({
        type: 'tool',
        name: 'get_player_value',
        phase: 'start',
        args: '{"names":["Roki Sasaki"],"range":"season"}',
      });
      handlers?.onToolEvent?.({
        type: 'tool',
        name: 'get_player_value',
        phase: 'end',
        ok: true,
        result: '{"players":[{"name":"Roki Sasaki","sgptPlus":126}]}',
      });
      return reply;
    });
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.type(screen.getByLabelText('Ask a question about your team'), 'trade targets?');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Your bats lead the league in HR.');

    await user.click(screen.getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive & start new' }));

    const raw = localStorage.getItem('theshowgpt.chat.archive.v1') ?? '[]';
    // The tool name survives for context; the big args/result JSON must not.
    expect(raw).toContain('get_player_value');
    expect(raw).not.toContain('Roki Sasaki');
    expect(raw).not.toContain('sgptPlus');
  });

  it('deletes an archived chat after confirming', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    localStorage.setItem(
      'theshowgpt.chat.archive.v1',
      JSON.stringify([
        {
          id: 'a1',
          title: 'old thread',
          archivedAt: '2026-07-05T00:00:00.000Z',
          messages: [
            {
              id: 'm1',
              role: 'user',
              content: 'old thread',
              createdAt: '2026-07-05T00:00:00.000Z',
            },
          ],
        },
      ]),
    );
    const user = userEvent.setup();
    render(<ChatPage />);

    await user.click(screen.getByRole('button', { name: 'Chat options' }));
    await user.click(screen.getByRole('button', { name: 'Delete archived chat: old thread' }));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('theshowgpt.chat.archive.v1') ?? '[]')).toEqual([]),
    );
    confirmSpy.mockRestore();
  });
});
