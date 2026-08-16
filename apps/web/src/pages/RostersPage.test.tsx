import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { LeagueRostersResponse, LeagueSummary, TeamStatsResponse } from '@fcm/contracts';
import { RostersPage } from './RostersPage';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/rosters']}>
      <RostersPage />
    </MemoryRouter>,
  );
}

const league: LeagueSummary = {
  leagueId: '469.l.101214',
  name: 'The Show',
  season: '2026',
  teamName: 'Bronx Bombers',
};

const rosters: LeagueRostersResponse = {
  leagueId: league.leagueId,
  teams: [
    {
      teamId: '1',
      teamName: 'Bronx Bombers',
      managerName: 'You',
      slots: [
        {
          selectedPosition: 'OF',
          player: {
            playerId: '106',
            fullName: 'Aaron Judge',
            mlbTeamAbbr: 'NYY',
            eligiblePositions: ['OF'],
            positionType: 'B',
          },
        },
      ],
    },
  ],
};

const teamStats: TeamStatsResponse = {
  leagueId: league.leagueId,
  teamId: '1',
  range: 'today',
  battingColumns: [{ key: 'HR', label: 'HR', aggregatable: true }],
  pitchingColumns: [],
  players: [
    {
      player: {
        playerId: '106',
        fullName: 'Aaron Judge',
        mlbTeamAbbr: 'NYY',
        eligiblePositions: ['OF'],
        positionType: 'B',
      },
      stats: [{ key: 'HR', value: 1 }],
    },
  ],
};

vi.mock('../hooks/useFirstLeagueResource', () => ({
  useFirstLeagueResource: () => ({ status: 'ready', data: rosters, league }),
}));

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({
    session: { status: 'connected', selectedLeague: league, supportsLast14: true },
  }),
}));

vi.mock('../api/client', () => ({
  getLeagueRosters: vi.fn(),
  getMlbGames: vi.fn(),
  getTeamRangeStats: vi.fn(),
}));

import { getLeagueRosters, getMlbGames, getTeamRangeStats } from '../api/client';

function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
  vi.mocked(getMlbGames).mockResolvedValue({ date: easternToday(), games: [] });
  vi.mocked(getTeamRangeStats).mockResolvedValue(teamStats);
  vi.mocked(getLeagueRosters).mockResolvedValue(rosters);
});

describe('RostersPage day filter', () => {
  it('loads today stats without a date and pages back to yesterday', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Rosters' })).toBeInTheDocument();
    expect(screen.getByLabelText('Previous day')).toBeInTheDocument();

    await waitFor(() => {
      expect(getTeamRangeStats).toHaveBeenCalledWith(league.leagueId, '1', 'today', undefined);
    });
    expect(getMlbGames).toHaveBeenCalledWith(easternToday());
    expect(getLeagueRosters).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Previous day'));

    const yesterday = shiftDate(easternToday(), -1);
    await waitFor(() => {
      expect(getTeamRangeStats).toHaveBeenCalledWith(league.leagueId, '1', 'today', yesterday);
    });
    expect(getMlbGames).toHaveBeenCalledWith(yesterday);
    expect(getLeagueRosters).toHaveBeenCalledWith(league.leagueId, yesterday);
  });

  it('hides the day picker when a multi-day range is selected', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByLabelText('Previous day')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Last 7' }));

    expect(screen.queryByLabelText('Previous day')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(getTeamRangeStats).toHaveBeenCalledWith(league.leagueId, '1', 'last7', undefined);
    });
  });

  it('links the Game cell to that game on MLB Scores', async () => {
    vi.mocked(getMlbGames).mockResolvedValue({
      date: easternToday(),
      games: [
        {
          gamePk: 745804,
          state: 'live',
          detail: 'In Progress',
          homeAbbr: 'NYY',
          awayAbbr: 'BOS',
          homeScore: 3,
          awayScore: 2,
          inning: 5,
          inningState: 'Top',
        },
      ],
    });
    renderPage();

    const link = await screen.findByRole('link', { name: /BOS 2-3 NYY/ });
    expect(link).toHaveAttribute('href', '/scores?game=745804');
  });
});
