import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MentionedPlayer, PlayerStatLine } from '@fcm/contracts';
import { MentionedPlayers } from './MentionedPlayers';
import type { LeagueStatPool, StatPoolTable } from '../hooks/useLeagueStatPool';

const judge: PlayerStatLine = {
  player: { playerId: 'p1', fullName: 'Aaron Judge', eligiblePositions: ['OF'] },
  stats: [{ key: 'HR', value: 30 }],
};

function battingTable(): StatPoolTable {
  return {
    columns: [{ key: 'HR', label: 'HR' }],
    lineById: new Map([['p1', judge]]),
    percentiles: new Map([['HR', () => 0.9]]),
    ranks: new Map([['HR', () => ({ rank: 1, total: 12 })]]),
  };
}

function emptyTable(): StatPoolTable {
  return { columns: [], lineById: new Map(), percentiles: new Map(), ranks: new Map() };
}

const pool: LeagueStatPool = {
  status: 'ready',
  batting: battingTable(),
  pitching: emptyTable(),
};

describe('MentionedPlayers', () => {
  it('renders a rank card for a resolved player and a chip for an unresolved one', () => {
    const players: MentionedPlayer[] = [
      { playerId: 'p1', fullName: 'Aaron Judge', positionType: 'B' },
      { playerId: 'p2', fullName: 'Ghost Player', positionType: 'B' },
    ];
    render(<MentionedPlayers players={players} pool={pool} onAnalyze={() => {}} />);

    // Resolved player gets a card with its ordinal rank badge; unresolved falls back to a chip.
    expect(screen.getByText('Aaron Judge')).toBeInTheDocument();
    expect(screen.getByText('1st')).toBeInTheDocument();
    expect(screen.getByText('Ghost Player')).toBeInTheDocument();
  });

  it('passes every mentioned playerId to onAnalyze', async () => {
    const onAnalyze = vi.fn();
    const players: MentionedPlayer[] = [
      { playerId: 'p1', fullName: 'Aaron Judge', positionType: 'B' },
      { playerId: 'p2', fullName: 'Ghost Player', positionType: 'B' },
    ];
    const user = userEvent.setup();
    render(<MentionedPlayers players={players} pool={pool} onAnalyze={onAnalyze} />);

    await user.click(screen.getByRole('button', { name: 'Analyze players mentioned' }));
    expect(onAnalyze).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('shows at most four tiles initially and expands on demand', async () => {
    const lines = ['One', 'Two', 'Three', 'Four', 'Five'].map((name, i) => ({
      player: { playerId: `p${i + 1}`, fullName: name, eligiblePositions: ['OF'] },
      stats: [{ key: 'HR', value: i + 1 }],
    }));
    const bigPool: LeagueStatPool = {
      status: 'ready',
      batting: {
        columns: [{ key: 'HR', label: 'HR' }],
        lineById: new Map(lines.map((line) => [line.player.playerId, line])),
        percentiles: new Map([['HR', () => 0.5]]),
        ranks: new Map([['HR', (v: number) => ({ rank: v, total: 5 })]]),
      },
      pitching: emptyTable(),
    };
    const players: MentionedPlayer[] = lines.map((line) => ({
      playerId: line.player.playerId,
      fullName: line.player.fullName,
      positionType: 'B',
    }));
    const user = userEvent.setup();
    render(<MentionedPlayers players={players} pool={bigPool} onAnalyze={() => {}} />);

    expect(screen.getByText('One')).toBeInTheDocument();
    expect(screen.getByText('Four')).toBeInTheDocument();
    expect(screen.queryByText('Five')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show 1 more' }));
    expect(screen.getByText('Five')).toBeInTheDocument();
  });

  it('hides tiles when collapsed but keeps the analyze button', async () => {
    const players: MentionedPlayer[] = [
      { playerId: 'p1', fullName: 'Aaron Judge', positionType: 'B' },
    ];
    const user = userEvent.setup();
    render(<MentionedPlayers players={players} pool={pool} onAnalyze={() => {}} />);

    expect(screen.getByText('Aaron Judge')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide cards' }));

    expect(screen.queryByText('Aaron Judge')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze players mentioned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show player cards (1)' })).toBeInTheDocument();
  });
});
