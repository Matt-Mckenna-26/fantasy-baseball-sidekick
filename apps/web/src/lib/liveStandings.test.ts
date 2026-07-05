import { describe, it, expect } from 'vitest';
import type { Matchup, StandingsRow } from '@fcm/contracts';
import {
  computeLiveStandings,
  computeStandingsMovers,
  formatMoverBlurb,
  pickStandingsMoverHighlights,
} from './liveStandings';

function row(teamId: string, rank: number, wins: number, losses: number, ties = 0): StandingsRow {
  return { teamId, teamName: `Team ${teamId}`, rank, wins, losses, ties };
}

/**
 * Build a two-team live matchup. `aWon`/`bWon` are each side's category wins;
 * losses mirror the opponent's wins and `tied` categories count for both teams.
 */
function matchup(aId: string, aWon: number, bId: string, bWon: number, tied = 0): Matchup {
  return {
    week: 14,
    status: 'midevent',
    teams: [
      {
        teamId: aId,
        teamName: `Team ${aId}`,
        categoriesWon: aWon,
        categoriesLost: bWon,
        categoriesTied: tied,
      },
      {
        teamId: bId,
        teamName: `Team ${bId}`,
        categoriesWon: bWon,
        categoriesLost: aWon,
        categoriesTied: tied,
      },
    ],
  };
}

describe('computeLiveStandings', () => {
  it('returns the input unchanged when there are no live matchups', () => {
    const standings = [row('1', 1, 10, 5), row('2', 2, 8, 7)];
    expect(computeLiveStandings(standings, [])).toBe(standings);
  });

  it('ignores non-midevent matchups', () => {
    const standings = [row('1', 1, 10, 5), row('2', 2, 8, 7)];
    const done: Matchup = { ...matchup('1', 2, '2', 8), status: 'postevent' };
    const notStarted: Matchup = { ...matchup('1', 0, '2', 0), status: 'preevent' };
    expect(computeLiveStandings(standings, [done, notStarted])).toBe(standings);
  });

  it('adds each side\u2019s category wins, losses, and ties to its season record', () => {
    // A 70-58-12 team winning the week 6-2-2 should read 76-60-14.
    const standings = [row('1', 1, 70, 58, 12), row('2', 2, 60, 60, 20)];
    const [t1, t2] = sortById(computeLiveStandings(standings, [matchup('1', 6, '2', 2, 2)]));
    expect(t1).toMatchObject({ teamId: '1', wins: 76, losses: 60, ties: 14 });
    expect(t2).toMatchObject({ teamId: '2', wins: 62, losses: 66, ties: 22 });
  });

  it('adds tied categories to both teams', () => {
    const standings = [row('1', 1, 10, 5), row('2', 2, 10, 5)];
    const result = sortById(computeLiveStandings(standings, [matchup('1', 4, '2', 4, 2)]));
    expect(result[0]).toMatchObject({ teamId: '1', wins: 14, losses: 9, ties: 2 });
    expect(result[1]).toMatchObject({ teamId: '2', wins: 14, losses: 9, ties: 2 });
  });

  it('re-ranks by win % so a strong category week can overtake the leader', () => {
    // Team 1 leads on win %, but a lopsided 8-2 week flips them.
    const standings = [row('1', 1, 100, 40), row('2', 2, 95, 45)];
    const result = computeLiveStandings(standings, [matchup('2', 8, '1', 2)]);
    expect(result[0]).toMatchObject({ teamId: '2', rank: 1 });
    expect(result[1]).toMatchObject({ teamId: '1', rank: 2 });
  });

  it('recomputes win % and games back from the new leader', () => {
    const standings = [row('1', 1, 10, 5), row('2', 2, 8, 7)];
    const result = computeLiveStandings(standings, [matchup('1', 7, '2', 3)]);
    expect(result[0]).toMatchObject({ teamId: '1', gamesBack: '-', winPercentage: '.680' });
    expect(result[1]).toMatchObject({ teamId: '2', gamesBack: '6' });
  });
});

function sortById(rows: StandingsRow[]): StandingsRow[] {
  return [...rows].sort((a, b) => a.teamId.localeCompare(b.teamId));
}

describe('computeStandingsMovers', () => {
  it('returns empty when live projection does not change ranks', () => {
    const standings = [row('1', 1, 10, 5), row('2', 2, 8, 7)];
    const projected = computeLiveStandings(standings, [matchup('1', 7, '2', 5)]);
    expect(computeStandingsMovers(standings, projected)).toEqual([]);
  });

  it('detects rank climbers and fallers from a projected flip', () => {
    const standings = [row('1', 1, 10, 5), row('2', 2, 9, 4)];
    const projected = computeLiveStandings(standings, [matchup('2', 8, '1', 2)]);
    const movers = computeStandingsMovers(standings, projected);
    expect(movers).toHaveLength(2);
    expect(movers.find((m) => m.teamId === '2')).toMatchObject({
      rankDelta: 1,
      projectedRank: 1,
    });
    expect(movers.find((m) => m.teamId === '1')).toMatchObject({
      rankDelta: -1,
      projectedRank: 2,
    });
  });

  it('picks the biggest hot and cold highlights', () => {
    const standings = [
      row('1', 1, 10, 5),
      row('2', 2, 9, 6),
      row('3', 3, 8, 7),
      row('4', 4, 7, 8),
    ];
    const projected = [
      { ...standings[0]!, rank: 3 },
      { ...standings[1]!, rank: 1 },
      { ...standings[2]!, rank: 2 },
      { ...standings[3]!, rank: 4 },
    ];
    const movers = computeStandingsMovers(standings, projected);
    const { hot, cold } = pickStandingsMoverHighlights(movers);
    expect(hot).toMatchObject({ teamId: '2', rankDelta: 1 });
    expect(cold).toMatchObject({ teamId: '1', rankDelta: -2 });
  });
});

describe('formatMoverBlurb', () => {
  it('uses takeover copy for a new leader', () => {
    const mover = {
      teamId: '2',
      teamName: 'Team 2',
      baselineRank: 2,
      projectedRank: 1,
      rankDelta: 1,
    };
    expect(formatMoverBlurb(mover, 'hot')).toBe(' takes over 1st place');
  });

  it('uses first-place drop copy when the leader falls', () => {
    const mover = {
      teamId: '1',
      teamName: 'Team 1',
      baselineRank: 1,
      projectedRank: 3,
      rankDelta: -2,
    };
    expect(formatMoverBlurb(mover, 'cold')).toBe(' drops from 1st to #3');
  });
});
