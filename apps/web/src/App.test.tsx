import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

vi.mock('./api/client', () => ({
  getAuthStatus: vi.fn(),
  getMyLeagues: vi.fn(),
  logout: vi.fn(),
  YAHOO_LOGIN_URL: '/auth/yahoo',
}));

import { getAuthStatus, getMyLeagues, logout } from './api/client';

function renderApp(initialRoute = '/') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Home in the nav for guests and hides the TheShowGPT nav link', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false });
    renderApp();
    expect(screen.getByText('Home')).toBeInTheDocument();
    // Guests get the branded sign-in hero, but not the gated TheShowGPT nav link.
    expect(screen.queryByRole('link', { name: /theshowgpt/i })).not.toBeInTheDocument();
    expect(screen.getByText('Rosters')).toBeInTheDocument();
    expect(screen.getByText('Live Standings')).toBeInTheDocument();
    expect(screen.getByText('Players')).toBeInTheDocument();
    expect(screen.getByText('League')).toBeInTheDocument();
  });

  it('funnels disconnected guests from Home into the TheShowGPT sign-in hero', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false });
    renderApp('/');
    const cta = await screen.findByRole('link', { name: 'Sign in with Yahoo' }, { timeout: 5000 });
    expect(cta).toHaveAttribute('href', '/auth/yahoo');
    // Guests never hit a bare "Connect Yahoo" page, and no league fetch is triggered.
    expect(screen.queryByText('Connect Yahoo')).not.toBeInTheDocument();
    expect(getMyLeagues).not.toHaveBeenCalled();
  });

  it('hides Home and shows the user menu when authenticated', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: true });
    vi.mocked(getMyLeagues).mockResolvedValue({
      userGuid: 'G',
      leagues: [
        {
          leagueId: '469.l.101214',
          name: 'The Show',
          season: '2026',
          teamName: 'Bronx Bombers',
          allowed: true,
        },
        { leagueId: '469.l.212934', name: 'Freddy Beach', season: '2026', allowed: false },
      ],
    });
    renderApp('/chat');

    // "The Show (2026)" is unique to the user menu; the team name also appears in the chat
    // greeting once the (now pre-loaded) /chat chunk renders, so await the unique label.
    expect(await screen.findByText('The Show (2026)')).toBeInTheDocument();
    expect(screen.getByLabelText("Bronx Bombers' Fantasy Baseball Co-Manager")).toBeInTheDocument();
    expect(screen.getAllByText('Bronx Bombers').length).toBeGreaterThan(0);
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });

  it('redirects authed users away from Home to Chat', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: true });
    vi.mocked(getMyLeagues).mockResolvedValue({
      userGuid: 'G',
      leagues: [{ leagueId: '469.l.101214', name: 'The Show', season: '2026', allowed: true }],
    });
    renderApp('/');

    // The /chat chunk now bundles assistant-ui, so allow extra time for the lazy import.
    expect(
      await screen.findByPlaceholderText('Ask a question about your team…', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Connect your Yahoo account')).not.toBeInTheDocument();
  });

  it('shows guests a Yahoo sign-in hero instead of the chat composer', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false });
    renderApp('/chat');

    const cta = await screen.findByRole('link', { name: 'Sign in with Yahoo' });
    expect(cta).toHaveAttribute('href', '/auth/yahoo');
    // The signed-out hero previews the product by name; only the composer stays gated.
    expect(screen.getByText('TheShowGPT')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Ask a question about your team…'),
    ).not.toBeInTheDocument();
  });

  it('lets authed users switch leagues and sign out from the user menu', async () => {
    const user = userEvent.setup();
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: true });
    vi.mocked(getMyLeagues).mockResolvedValue({
      userGuid: 'G',
      leagues: [
        {
          leagueId: '469.l.101214',
          name: 'The Show',
          season: '2026',
          teamName: 'Bronx Bombers',
          allowed: true,
        },
        { leagueId: '469.l.212934', name: 'Freddy Beach', season: '2026', allowed: false },
      ],
    });
    vi.mocked(logout).mockResolvedValue(undefined);
    renderApp('/chat');

    await user.click(await screen.findByRole('button', { name: 'Account menu for Bronx Bombers' }));

    const select = screen.getByRole('combobox');
    expect(select).toBeEnabled();
    const blockedOption = screen.getByRole('option', { name: /Freddy Beach/ });
    expect(blockedOption).toBeDisabled();
    expect(blockedOption).toHaveAttribute('title', 'This league is not in the closed beta group');

    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });
});
