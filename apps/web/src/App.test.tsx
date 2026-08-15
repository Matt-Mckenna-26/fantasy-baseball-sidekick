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

  it('renders Home in the nav for guests and hides TheShowGPT', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false });
    renderApp();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('TheShowGPT')).not.toBeInTheDocument();
    expect(screen.getByText('Rosters')).toBeInTheDocument();
    expect(screen.getByText('Live Standings')).toBeInTheDocument();
    expect(screen.getByText('Players')).toBeInTheDocument();
    expect(screen.getByText('League')).toBeInTheDocument();
  });

  it('shows Connect Yahoo when disconnected', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false });
    renderApp();
    const connect = await screen.findByText('Connect Yahoo');
    expect(connect).toHaveAttribute('href', '/auth/yahoo');
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

    expect(await screen.findByText('Bronx Bombers')).toBeInTheDocument();
    expect(screen.getByLabelText("Bronx Bombers' Fantasy Baseball Co-Manager")).toBeInTheDocument();
    expect(screen.getByText('The Show (2026)')).toBeInTheDocument();
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
