import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  LeagueRostersResponse,
  LeagueSummary,
  MlbBoxScoreResponse,
  MlbGamesResponse,
} from '@fcm/contracts';
import { MlbScoresPage } from './MlbScoresPage';

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
      slots: [
        {
          selectedPosition: 'OF',
          player: { playerId: '106', fullName: 'Aaron Judge', mlbTeamAbbr: 'NYY', eligiblePositions: ['OF'] },
        },
      ],
    },
  ],
};

// useFirstLeagueResource is exercised elsewhere; here we short-circuit to the ready state.
vi.mock('../hooks/useFirstLeagueResource', () => ({
  useFirstLeagueResource: () => ({ status: 'ready', data: rosters, league }),
}));

vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ session: { status: 'connected', selectedLeague: league } }),
}));

vi.mock('../api/client', () => ({
  getLeagueRosters: vi.fn(),
  getMlbGames: vi.fn(),
  getMlbBoxScore: vi.fn(),
}));

import { getMlbGames, getMlbBoxScore } from '../api/client';

const games: MlbGamesResponse = {
  date: '2026-07-04',
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
};

const box: MlbBoxScoreResponse = {
  gamePk: 745804,
  home: {
    teamAbbr: 'NYY',
    teamName: 'New York Yankees',
    runs: 3,
    hits: 8,
    errors: 0,
    batters: [
      { fullName: 'Aaron Judge', position: 'RF', battingOrder: 3, ab: 4, r: 1, h: 2, rbi: 2, hr: 1, bb: 0, so: 1, avg: '.311' },
      { fullName: 'Unowned Yankee', position: 'SS', battingOrder: 4, ab: 4, r: 0, h: 1, rbi: 0, hr: 0, bb: 0, so: 2, avg: '.240' },
    ],
    pitchers: [
      { fullName: 'Ace Pitcher', decision: 'W', ip: '6.0', h: 5, r: 2, er: 2, bb: 1, so: 7, hr: 1, era: '3.10' },
    ],
  },
  away: {
    teamAbbr: 'BOS',
    teamName: 'Boston Red Sox',
    runs: 2,
    hits: 6,
    errors: 1,
    batters: [
      { fullName: 'Boston Bat', position: 'DH', battingOrder: 1, ab: 4, r: 1, h: 1, rbi: 1, hr: 0, bb: 0, so: 0, avg: '.280' },
    ],
    pitchers: [],
  },
};

describe('MlbScoresPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMlbGames).mockResolvedValue(games);
    vi.mocked(getMlbBoxScore).mockResolvedValue(box);
  });

  it('lists games and expands a box score with owned players highlighted', async () => {
    const user = userEvent.setup();
    render(<MlbScoresPage />);

    // Game card renders both sides.
    const card = await screen.findByRole('button', { name: /NYY/ });
    expect(within(card).getByText('NYY')).toBeInTheDocument();
    expect(within(card).getByText('BOS')).toBeInTheDocument();

    await user.click(card);

    // Box score loads with the hitters and pitchers grids.
    expect(await screen.findByText('Aaron Judge')).toBeInTheDocument();
    expect(screen.getByText('Ace Pitcher')).toBeInTheDocument();
    expect(getMlbBoxScore).toHaveBeenCalledWith(745804);

    // The rostered player shows the owning fantasy team; an unowned player does not.
    const judgeRow = screen.getByText('Aaron Judge').closest('tr');
    expect(judgeRow).not.toBeNull();
    expect(within(judgeRow!).getByText('Bronx Bombers')).toBeInTheDocument();

    const unownedRow = screen.getByText('Unowned Yankee').closest('tr');
    expect(within(unownedRow!).queryByText('Bronx Bombers')).toBeNull();
  });

  it('shows an empty-state message when there are no games', async () => {
    vi.mocked(getMlbGames).mockResolvedValue({ date: '2026-07-04', games: [] });
    render(<MlbScoresPage />);
    expect(await screen.findByText(/No MLB games scheduled/)).toBeInTheDocument();
  });
});
