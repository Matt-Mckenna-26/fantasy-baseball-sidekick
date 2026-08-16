import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlayerGameLogResponse } from '@fcm/contracts';
import { GameLogPanel } from './PlayerFocusModal';
import { getPlayerGameLog } from '../api/client';

vi.mock('../api/client', () => ({ getPlayerGameLog: vi.fn() }));

const mockGetLog = vi.mocked(getPlayerGameLog);

const battingLog: PlayerGameLogResponse = {
  player: 'Aaron Judge',
  matched: true,
  batting: [
    {
      date: '2026-07-04',
      opponent: 'BOS',
      home: true,
      ab: 4,
      r: 2,
      h: 3,
      doubles: 1,
      triples: 0,
      hr: 1,
      rbi: 3,
      bb: 1,
      so: 0,
      sb: 1,
      avg: '.750',
    },
  ],
  pitching: [],
};

beforeEach(() => {
  mockGetLog.mockReset();
});

describe('GameLogPanel', () => {
  it('renders recent batting lines for a hitter', async () => {
    mockGetLog.mockResolvedValue(battingLog);

    render(<GameLogPanel fullName="Aaron Judge" mlbTeamAbbr="NYY" isPitching={false} />);

    expect(await screen.findByText('Recent games')).toBeInTheDocument();
    expect(screen.getByText('vs BOS')).toBeInTheDocument();
    expect(screen.getByText('.750')).toBeInTheDocument();
    expect(mockGetLog).toHaveBeenCalledWith('Aaron Judge', 'NYY');
  });

  it('shows a soft note when the player was not matched', async () => {
    mockGetLog.mockResolvedValue({ player: 'Nobody', matched: false, batting: [], pitching: [] });

    render(<GameLogPanel fullName="Nobody" isPitching={false} />);

    expect(await screen.findByText('No game log available.')).toBeInTheDocument();
  });
});
