import {
  mlbGamesResponseSchema,
  normalizeTeamAbbr,
  playerGameKey,
  type MlbGameState,
  type MlbGamesResponse,
} from '@fcm/contracts';

/**
 * Read-only client for the public MLB Stats API (statsapi.mlb.com). Used solely to
 * annotate rosters with live game state on the "Today" view - Yahoo does not expose
 * this. Requests are anonymous GETs for public data: no auth, no user data, no tokens
 * are sent (see the security rule; this is the app's only non-Yahoo outbound host).
 */
const SCHEDULE_URL = 'https://statsapi.mlb.com/api/v1/schedule';

/* ----------------------------- raw API shapes ----------------------------- */

interface RawPerson {
  id?: number;
  fullName?: string;
}
interface RawTeamSide {
  score?: number;
  team?: { abbreviation?: string; name?: string };
  probablePitcher?: RawPerson;
}
interface RawLineups {
  homePlayers?: RawPerson[];
  awayPlayers?: RawPerson[];
}
interface RawGame {
  gamePk?: number;
  gameDate?: string;
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: { home?: RawTeamSide; away?: RawTeamSide };
  linescore?: { currentInning?: number; inningState?: string };
  lineups?: RawLineups;
}
interface RawSchedule {
  dates?: { games?: RawGame[] }[];
}

/**
 * Canonicalize a team abbreviation so MLB Stats API and Yahoo conventions match.
 * Re-exported from contracts so callers that already import from here keep working.
 */
export { normalizeTeamAbbr } from '@fcm/contracts';

/** Map posted lineups to team|name -> batting-order slot (1-9). */
function mapBattingOrder(
  lineups: RawLineups | undefined,
  homeAbbr: string,
  awayAbbr: string,
): MlbGameState['battingOrder'] {
  if (!lineups) return undefined;
  const order: NonNullable<MlbGameState['battingOrder']> = {};
  const sides: [string, RawPerson[]][] = [
    [homeAbbr, lineups.homePlayers ?? []],
    [awayAbbr, lineups.awayPlayers ?? []],
  ];
  for (const [abbr, players] of sides) {
    players.forEach((p, index) => {
      if (typeof p.fullName === 'string') {
        order[playerGameKey(abbr, p.fullName)] = index + 1;
      }
    });
  }
  return Object.keys(order).length > 0 ? order : undefined;
}

/** Collect probable starting pitchers as team|name keys for both sides. */
function mapProbablePitchers(
  homeAbbr: string,
  awayAbbr: string,
  home: RawTeamSide | undefined,
  away: RawTeamSide | undefined,
): MlbGameState['probablePitchers'] {
  const keys: string[] = [];
  if (typeof away?.probablePitcher?.fullName === 'string') {
    keys.push(playerGameKey(awayAbbr, away.probablePitcher.fullName));
  }
  if (typeof home?.probablePitcher?.fullName === 'string') {
    keys.push(playerGameKey(homeAbbr, home.probablePitcher.fullName));
  }
  return keys.length > 0 ? keys : undefined;
}

/** Map MLB's coarse `abstractGameState` to our lifecycle enum. */
function toState(abstractGameState: string | undefined): MlbGameState['state'] {
  switch (abstractGameState) {
    case 'Live':
      return 'live';
    case 'Final':
      return 'final';
    default:
      return 'scheduled';
  }
}

/** Pure mapper: MLB schedule payload -> our DTO. Exported for unit testing. */
export function mapScheduleToGames(raw: RawSchedule, date: string): MlbGamesResponse {
  const rawGames = raw.dates?.flatMap((d) => d.games ?? []) ?? [];
  const games: MlbGameState[] = rawGames.flatMap((g) => {
    const homeAbbr = g.teams?.home?.team?.abbreviation;
    const awayAbbr = g.teams?.away?.team?.abbreviation;
    if (typeof g.gamePk !== 'number' || !homeAbbr || !awayAbbr) {
      return [];
    }
    const state = toState(g.status?.abstractGameState);
    return [
      {
        gamePk: g.gamePk,
        state,
        detail: g.status?.detailedState ?? state,
        ...(g.gameDate ? { startTime: g.gameDate } : {}),
        homeAbbr: normalizeTeamAbbr(homeAbbr),
        awayAbbr: normalizeTeamAbbr(awayAbbr),
        ...(typeof g.teams?.home?.score === 'number' ? { homeScore: g.teams.home.score } : {}),
        ...(typeof g.teams?.away?.score === 'number' ? { awayScore: g.teams.away.score } : {}),
        // Inning info is only meaningful while the game is live.
        ...(state === 'live' && typeof g.linescore?.currentInning === 'number'
          ? { inning: g.linescore.currentInning }
          : {}),
        ...(state === 'live' && g.linescore?.inningState
          ? { inningState: g.linescore.inningState }
          : {}),
        ...(() => {
          const battingOrder = mapBattingOrder(g.lineups, homeAbbr, awayAbbr);
          return battingOrder ? { battingOrder } : {};
        })(),
        ...(() => {
          const probablePitchers = mapProbablePitchers(
            homeAbbr,
            awayAbbr,
            g.teams?.home,
            g.teams?.away,
          );
          return probablePitchers ? { probablePitchers } : {};
        })(),
      },
    ];
  });
  return mlbGamesResponseSchema.parse({ date, games });
}

/** Fetch every MLB game for a date (YYYY-MM-DD) with its current live state. */
export async function getGamesForDate(date: string): Promise<MlbGamesResponse> {
  const url = `${SCHEDULE_URL}?sportId=1&date=${date}&hydrate=team,linescore,probablePitcher,lineups`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`MLB schedule request failed: ${res.status}`);
  }
  const raw = (await res.json()) as RawSchedule;
  return mapScheduleToGames(raw, date);
}
