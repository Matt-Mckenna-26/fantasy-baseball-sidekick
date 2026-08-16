import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  LeagueRostersResponse,
  LeagueSummary,
  MlbBoxScoreResponse,
  MlbGamesResponse,
} from '@fcm/contracts';
import { MlbScoresPage } from './MlbScoresPage';

/** Render the page inside a router so useSearchParams/Link work; `route` sets the URL. */
function renderPage(route = '/scores') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <MlbScoresPage />
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
      situation: {
        balls: 2,
        strikes: 1,
        outs: 1,
        first: 'Anthony Volpe',
        third: 'Jazz Chisholm',
        batter: 'Aaron Judge',
        pitcher: 'Ace Pitcher',
      },
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
      { fullName: 'Ace Pitcher', decision: 'W', ip: '6.0', h: 5, r: 2, er: 2, bb: 1, so: 7, hr: 1, pitches: 95, era: '3.10' },
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
    renderPage();

    // Game card renders both sides.
    const card = await screen.findByRole('button', { name: /NYY/ });
    expect(within(card).getByText('NYY')).toBeInTheDocument();
    expect(within(card).getByText('BOS')).toBeInTheDocument();

    await user.click(card);

    // Box score loads with the hitters and pitchers grids. "Unowned Yankee" appears only
    // in the box (not the live situation panel), so it's a clean signal the box rendered.
    expect(await screen.findByText('Unowned Yankee')).toBeInTheDocument();
    expect(getMlbBoxScore).toHaveBeenCalledWith(745804);

    // The pitching grid includes the total pitches (P) column value. Names also appear in
    // the live situation panel, so locate the actual table row.
    const pitcherRow = screen
      .getAllByText('Ace Pitcher')
      .map((el) => el.closest('tr'))
      .find((row): row is HTMLTableRowElement => row != null);
    expect(pitcherRow).toBeTruthy();
    expect(within(pitcherRow!).getByText('95')).toBeInTheDocument();

    // The rostered player shows the owning fantasy team; an unowned player does not.
    const judgeRow = screen
      .getAllByText('Aaron Judge')
      .map((el) => el.closest('tr'))
      .find((row): row is HTMLTableRowElement => row != null);
    expect(judgeRow).toBeTruthy();
    expect(within(judgeRow!).getByText('Bronx Bombers')).toBeInTheDocument();

    const unownedRow = screen.getByText('Unowned Yankee').closest('tr');
    expect(within(unownedRow!).queryByText('Bronx Bombers')).toBeNull();
  });

  it('renders the live diamond with count, outs, and the current matchup', async () => {
    renderPage();
    // Ball-strike count.
    expect(await screen.findByText('2-1')).toBeInTheDocument();
    // Outs label.
    expect(screen.getByText('1 out')).toBeInTheDocument();
    // Current pitcher and batter names.
    expect(screen.getByText('Ace Pitcher')).toBeInTheDocument();
    expect(screen.getByText('Aaron Judge')).toBeInTheDocument();
    // Occupied bases name their runner on hover (title) and for assistive tech.
    expect(screen.getByTitle('Anthony Volpe')).toBeInTheDocument();
    expect(screen.getByTitle('Jazz Chisholm')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Anthony Volpe on first, Jazz Chisholm on third/ }),
    ).toBeInTheDocument();
  });

  it('auto-expands the box score for a ?game= deep link', async () => {
    renderPage('/scores?game=745804');
    // The box score loads without a manual click.
    expect(await screen.findByText('Unowned Yankee')).toBeInTheDocument();
    expect(getMlbBoxScore).toHaveBeenCalledWith(745804);
  });

  it('loads the slate for a ?date= deep link', async () => {
    renderPage('/scores?game=745804&date=2026-07-04');
    await waitFor(() => {
      expect(getMlbGames).toHaveBeenCalledWith('2026-07-04');
    });
  });

  it('shows an empty-state message when there are no games', async () => {
    vi.mocked(getMlbGames).mockResolvedValue({ date: '2026-07-04', games: [] });
    renderPage();
    expect(await screen.findByText(/No MLB games scheduled/)).toBeInTheDocument();
  });

  it('polls again after 5s while a game is live', async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      // Flush the initial (non-timer) load.
      await vi.advanceTimersByTimeAsync(0);
      expect(getMlbGames).toHaveBeenCalledTimes(1);
      // No refetch before the 5s live interval elapses.
      await vi.advanceTimersByTimeAsync(4_000);
      expect(getMlbGames).toHaveBeenCalledTimes(1);
      // The live cadence triggers a second fetch at 5s.
      await vi.advanceTimersByTimeAsync(1_500);
      expect(getMlbGames).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
