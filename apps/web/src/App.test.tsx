import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

vi.mock('./api/client', () => ({
  getAuthStatus: vi.fn(),
  getMyLeagues: vi.fn(),
  logout: vi.fn(),
  YAHOO_LOGIN_URL: '/auth/yahoo',
}));

import { getAuthStatus, getMyLeagues } from './api/client';

function renderApp() {
  return render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  );
}

describe('App shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the nav', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false });
    renderApp();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Rosters')).toBeInTheDocument();
    expect(screen.getByText('Stats')).toBeInTheDocument();
  });

  it('shows Connect Yahoo when disconnected', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: false });
    renderApp();
    const connect = await screen.findByText('Connect Yahoo');
    expect(connect).toHaveAttribute('href', '/auth/yahoo');
    expect(getMyLeagues).not.toHaveBeenCalled();
  });

  it('renders leagues when connected', async () => {
    vi.mocked(getAuthStatus).mockResolvedValue({ authenticated: true });
    vi.mocked(getMyLeagues).mockResolvedValue({
      userGuid: 'G',
      leagues: [
        { leagueId: '1', name: 'FKL Baseball', season: '2026' },
        { leagueId: '2', name: 'Freddy Beach', season: '2026' },
      ],
    });
    renderApp();
    expect(await screen.findByText('FKL Baseball')).toBeInTheDocument();
    expect(screen.getByText('Freddy Beach')).toBeInTheDocument();
    expect(screen.getByText('Your MLB Leagues')).toBeInTheDocument();
  });
});
