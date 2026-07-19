import { describe, it, expect } from 'vitest';
import { mapScheduleToProbableStarters } from './mlbClient.js';

const raw = {
  dates: [
    {
      date: '2026-07-06',
      games: [
        {
          gameDate: '2026-07-06T23:05:00Z',
          teams: {
            home: {
              team: { abbreviation: 'NYY' },
              probablePitcher: { id: 1, fullName: 'Gerrit Cole' },
            },
            away: {
              team: { abbreviation: 'BOS' },
              probablePitcher: { id: 2, fullName: 'Brayan Bello' },
            },
          },
        },
        {
          // Only the home side has an announced starter yet.
          teams: {
            home: { team: { abbreviation: 'LAD' }, probablePitcher: { fullName: 'Tyler Glasnow' } },
            away: { team: { abbreviation: 'SF' } },
          },
        },
      ],
    },
    {
      // A date with no announced starters is dropped entirely.
      date: '2026-07-07',
      games: [{ teams: { home: { team: { abbreviation: 'CHC' } }, away: { team: { abbreviation: 'STL' } } } }],
    },
  ],
};

describe('mapScheduleToProbableStarters', () => {
  it('maps both sides of a game to starts, dropping sides without an announced pitcher', () => {
    const result = mapScheduleToProbableStarters(raw, '2026-07-06', '2026-07-07');
    expect(result).toEqual({
      start: '2026-07-06',
      end: '2026-07-07',
      days: [
        {
          date: '2026-07-06',
          starts: [
            {
              team: 'NYY',
              opponent: 'BOS',
              home: true,
              pitcher: 'Gerrit Cole',
              pitcherId: 1,
              gameTime: '2026-07-06T23:05:00Z',
            },
            {
              team: 'BOS',
              opponent: 'NYY',
              home: false,
              pitcher: 'Brayan Bello',
              pitcherId: 2,
              gameTime: '2026-07-06T23:05:00Z',
            },
            { team: 'LAD', opponent: 'SF', home: true, pitcher: 'Tyler Glasnow' },
          ],
        },
      ],
    });
  });

  it('filters to a single team when a team hint is given', () => {
    const result = mapScheduleToProbableStarters(raw, '2026-07-06', '2026-07-07', 'bos');
    expect(result.days).toEqual([
      {
        date: '2026-07-06',
        starts: [{ team: 'BOS', opponent: 'NYY', home: false, pitcher: 'Brayan Bello', pitcherId: 2, gameTime: '2026-07-06T23:05:00Z' }],
      },
    ]);
  });

  it('returns no days when nothing matches the team filter', () => {
    expect(mapScheduleToProbableStarters(raw, '2026-07-06', '2026-07-07', 'HOU').days).toEqual([]);
  });
});
