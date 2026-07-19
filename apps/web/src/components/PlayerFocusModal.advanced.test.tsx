import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlayerStatsResponse } from '@fcm/contracts';
import { AdvancedPanel } from './PlayerFocusModal';
import { getAdvancedLeagueStats } from '../api/client';

vi.mock('../api/client', () => ({ getAdvancedLeagueStats: vi.fn() }));

const mockGetAdvanced = vi.mocked(getAdvancedLeagueStats);

const COLUMNS = [
  { key: 'AVG', label: 'AVG', higherIsBetter: true },
  { key: 'xBA', label: 'xBA', higherIsBetter: true },
];

/** Two-hitter advanced pool so percentile ranks (1st of 2 / 2nd of 2) have something to sort. */
function advancedPool(): PlayerStatsResponse {
  return {
    leagueId: 'L1',
    batting: {
      columns: COLUMNS,
      players: [
        {
          player: { playerId: 'p1', fullName: 'Aaron Judge', eligiblePositions: ['OF'] },
          stats: [
            { key: 'AVG', value: '.331' },
            { key: 'xBA', value: '.314' },
          ],
          owner: 'Bombers',
        },
        {
          player: { playerId: 'p2', fullName: 'Some Scrub', eligiblePositions: ['OF'] },
          stats: [
            { key: 'AVG', value: '.240' },
            { key: 'xBA', value: '.250' },
          ],
        },
      ],
    },
    pitching: { columns: [], players: [] },
  };
}

beforeEach(() => {
  mockGetAdvanced.mockReset();
});

describe('AdvancedPanel', () => {
  it('renders percentile-colored advanced tiles for the player from the league pool', async () => {
    mockGetAdvanced.mockResolvedValue(advancedPool());

    render(<AdvancedPanel leagueId="L1" playerId="p1" isPitching={false} />);

    // Values from the player's own advanced line render, and the best value ranks 1st of 2.
    expect(await screen.findByText('.331')).toBeInTheDocument();
    expect(screen.getByText('.314')).toBeInTheDocument();
    expect(screen.getAllByText('1st').length).toBeGreaterThan(0);
    // Buy-low / sell-high wording is gone from the card entirely.
    expect(screen.queryByText(/sell-high/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/buy-low/i)).not.toBeInTheDocument();
    expect(mockGetAdvanced).toHaveBeenCalledWith('L1');
  });

  it('shows a soft note when the player is not in the advanced pool', async () => {
    mockGetAdvanced.mockResolvedValue(advancedPool());

    render(<AdvancedPanel leagueId="L1" playerId="missing" isPitching={false} />);

    expect(await screen.findByText('No advanced stats available.')).toBeInTheDocument();
  });
});
