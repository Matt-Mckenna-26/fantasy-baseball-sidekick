import {
  leagueFreeAgentsResponseSchema,
  leagueMatchupsResponseSchema,
  leagueRostersResponseSchema,
  leagueStandingsResponseSchema,
  leagueTeamStatsResponseSchema,
  leagueTransactionsResponseSchema,
  meLeaguesResponseSchema,
  mlbBoxScoreResponseSchema,
  mlbGamesResponseSchema,
  playerGameKey,
  playerStatsResponseSchema,
  teamStatsResponseSchema,
  teamWeekStatsResponseSchema,
  type LeagueFreeAgentsResponse,
  type LeagueMatchupsResponse,
  type LeagueRostersResponse,
  type LeagueStandingsResponse,
  type LeagueTeamStatsResponse,
  type LeagueTransactionsResponse,
  type MeLeaguesResponse,
  type MlbBoxBatter,
  type MlbBoxPitcher,
  type MlbBoxScoreResponse,
  type MlbBoxSide,
  type MlbGamesResponse,
  type PlayerGameLogResponse,
  type PlayerNewsResponse,
  type PlayerStatsResponse,
  type StatRange,
  type TeamStatBucket,
  type TeamStatsResponse,
  type TeamWeekStatsResponse,
} from '@fcm/contracts';
import type { FantasyProvider, FreeAgentsQuery } from './fantasyProvider.js';
import {
  TEAM_STAT_WINDOW_SIZE,
  aggregateWeeklyTeamStats,
  resolveWindowWeeks,
} from './teamStatsAggregate.js';

/**
 * Deterministic, DTO-valid fantasy data for use while live Yahoo Fantasy API
 * access is pending. It implements the same FantasyProvider contract as the live
 * provider, so routes, the web client, and the UI are identical in both modes.
 *
 * Auth is still enforced by the routes; this provider simply ignores the tokens.
 * Every payload is validated with the shared schema so the mock can never drift
 * from the real contract.
 *
 * The seed is a fictional 12-team league populated with real MLB players. Their
 * MLB-team affiliations and stat lines are a public snapshot from ~July 4, 2026
 * (Baseball-Reference / MLB.com / ESPN season leaders), so the demo reflects
 * "right now" rather than placeholder data. Affiliations are a best-effort
 * snapshot and may lag mid-season roster moves.
 */

const COVERAGE_DATE = '2026-07-04';

/** Terse roster entry: [selectedPosition, id, name, mlbTeam, eligible(csv), status?]. */
type RosterRow = [string, string, string, string, string, string?];

function toTeam(teamId: string, teamName: string, managerName: string, rows: RosterRow[]) {
  return {
    teamId,
    teamName,
    managerName,
    coverageDate: COVERAGE_DATE,
    slots: rows.map(([selectedPosition, playerId, fullName, mlbTeamAbbr, eligible, status]) => ({
      selectedPosition,
      player: {
        playerId,
        fullName,
        mlbTeamAbbr,
        eligiblePositions: eligible.split('/'),
        ...(status ? { status } : {}),
      },
    })),
  };
}

const TEAMS = [
  toTeam('1', 'Bronx Bombers', 'You', [
    ['C', '101', 'Austin Wells', 'NYY', 'C'],
    ['1B', '102', 'Freddie Freeman', 'LAD', '1B/Util'],
    ['2B', '103', 'Marcus Semien', 'TEX', '2B'],
    ['3B', '104', 'Jose Ramirez', 'CLE', '3B/Util'],
    ['SS', '105', 'Bobby Witt Jr.', 'KC', 'SS'],
    ['OF', '106', 'Aaron Judge', 'NYY', 'OF/Util', 'DTD'],
    ['OF', '107', 'Corbin Carroll', 'ARI', 'OF'],
    ['OF', '108', 'Jung Hoo Lee', 'SF', 'OF'],
    ['Util', '109', 'Yordan Alvarez', 'HOU', 'Util/OF'],
    ['SP', '110', 'Tarik Skubal', 'DET', 'SP/P'],
    ['SP', '111', 'Paul Skenes', 'PIT', 'SP/P'],
    ['RP', '112', 'Emmanuel Clase', 'CLE', 'RP/P'],
    ['BN', '113', 'Ben Rice', 'NYY', 'C/1B'],
  ]),
  toTeam('2', 'Windy City Heat', 'Alex', [
    ['C', '201', 'William Contreras', 'MIL', 'C'],
    ['1B', '202', 'Vladimir Guerrero Jr.', 'TOR', '1B'],
    ['2B', '203', 'Brice Turang', 'MIL', '2B'],
    ['3B', '204', 'Junior Caminero', 'TB', '3B/Util'],
    ['SS', '205', 'Gunnar Henderson', 'BAL', 'SS'],
    ['OF', '206', 'Pete Crow-Armstrong', 'CHC', 'OF'],
    ['OF', '207', 'Kyle Tucker', 'CHC', 'OF'],
    ['OF', '208', 'Byron Buxton', 'MIN', 'OF/Util'],
    ['Util', '209', 'Kyle Schwarber', 'PHI', 'Util/OF'],
    ['SP', '210', 'Cristopher Sanchez', 'PHI', 'SP/P'],
    ['SP', '211', 'Chase Burns', 'CIN', 'SP/P'],
    ['RP', '212', 'Josh Hader', 'HOU', 'RP/P'],
    ['BN', '213', 'Nico Hoerner', 'CHC', '2B/SS'],
  ]),
  toTeam('3', 'Sandlot Kings', 'Jordan', [
    ['C', '301', 'Cal Raleigh', 'SEA', 'C/Util'],
    ['1B', '302', 'Matt Olson', 'ATL', '1B'],
    ['2B', '303', 'Ketel Marte', 'ARI', '2B'],
    ['3B', '304', 'Manny Machado', 'SD', '3B'],
    ['SS', '305', 'Francisco Lindor', 'NYM', 'SS'],
    ['OF', '306', 'Julio Rodriguez', 'SEA', 'OF'],
    ['OF', '307', 'James Wood', 'WSH', 'OF'],
    ['OF', '308', 'Jarren Duran', 'BOS', 'OF'],
    ['Util', '309', 'Bryce Harper', 'PHI', '1B/Util'],
    ['SP', '310', 'Jacob Misiorowski', 'MIL', 'SP/P'],
    ['SP', '311', 'Zack Wheeler', 'PHI', 'SP/P'],
    ['RP', '312', 'Edwin Diaz', 'NYM', 'RP/P'],
    ['BN', '313', 'Michael Harris II', 'ATL', 'OF'],
  ]),
  toTeam('4', 'River City Rockets', 'Sam', [
    ['C', '401', 'Will Smith', 'LAD', 'C'],
    ['1B', '402', 'Pete Alonso', 'BAL', '1B'],
    ['2B', '403', 'Ozzie Albies', 'ATL', '2B'],
    ['3B', '404', 'Rafael Devers', 'SF', '3B/Util'],
    ['SS', '405', 'Elly De La Cruz', 'CIN', 'SS'],
    ['OF', '406', 'Juan Soto', 'NYM', 'OF'],
    ['OF', '407', 'Mike Trout', 'LAA', 'OF/Util'],
    ['OF', '408', 'Brandon Marsh', 'PHI', 'OF'],
    ['Util', '409', 'Yandy Diaz', 'TB', '1B/Util'],
    ['SP', '410', 'Dylan Cease', 'TOR', 'SP/P'],
    ['SP', '411', 'Yoshinobu Yamamoto', 'LAD', 'SP/P'],
    ['RP', '412', 'Mason Miller', 'ATH', 'RP/P'],
    ['BN', '413', 'Bryan Reynolds', 'PIT', 'OF'],
  ]),
  toTeam('5', 'Desert Diamondbacks', 'Taylor', [
    ['C', '501', 'J.T. Realmuto', 'PHI', 'C'],
    ['1B', '502', 'Christian Walker', 'HOU', '1B'],
    ['2B', '503', 'Jose Altuve', 'HOU', '2B/OF'],
    ['3B', '504', 'Austin Riley', 'ATL', '3B'],
    ['SS', '505', 'Corey Seager', 'TEX', 'SS'],
    ['OF', '506', 'Fernando Tatis Jr.', 'SD', 'OF'],
    ['OF', '507', 'Riley Greene', 'DET', 'OF'],
    ['OF', '508', 'Jackson Chourio', 'MIL', 'OF'],
    ['Util', '509', 'Jonathan Aranda', 'TB', '1B/Util'],
    ['SP', '510', 'Chris Sale', 'ATL', 'SP/P'],
    ['SP', '511', 'Logan Gilbert', 'SEA', 'SP/P'],
    ['RP', '512', 'Felix Bautista', 'BAL', 'RP/P'],
    ['BN', '513', 'Wyatt Langford', 'TEX', 'OF'],
  ]),
  toTeam('6', 'Motor City Mashers', 'Casey', [
    ['C', '601', 'Salvador Perez', 'KC', 'C/1B'],
    ['1B', '602', 'Triston Casas', 'BOS', '1B'],
    ['2B', '603', 'Andres Gimenez', 'TOR', '2B'],
    ['3B', '604', 'Alex Bregman', 'CHC', '3B'],
    ['SS', '605', 'Trea Turner', 'PHI', 'SS'],
    ['OF', '606', 'Steven Kwan', 'CLE', 'OF'],
    ['OF', '607', 'Randy Arozarena', 'SEA', 'OF'],
    ['OF', '608', 'Jo Adell', 'LAA', 'OF'],
    ['Util', '609', 'Spencer Torkelson', 'DET', '1B/Util'],
    ['SP', '610', 'Garrett Crochet', 'BOS', 'SP/P'],
    ['SP', '611', 'Joe Ryan', 'MIN', 'SP/P'],
    ['RP', '612', 'Devin Williams', 'NYY', 'RP/P'],
    ['BN', '613', 'Gleyber Torres', 'DET', '2B'],
  ]),
  toTeam('7', 'Bayou Bandits', 'Morgan', [
    ['C', '701', 'Sean Murphy', 'ATL', 'C'],
    ['1B', '702', 'Michael Busch', 'CHC', '1B'],
    ['2B', '703', 'Luis Garcia Jr.', 'WSH', '2B'],
    ['3B', '704', 'Josh Jung', 'TEX', '3B'],
    ['SS', '705', 'CJ Abrams', 'WSH', 'SS'],
    ['OF', '706', 'Wilyer Abreu', 'BOS', 'OF'],
    ['OF', '707', 'Ceddanne Rafaela', 'BOS', 'OF/SS'],
    ['OF', '708', 'Taylor Ward', 'BAL', 'OF'],
    ['Util', '709', 'Nick Kurtz', 'ATH', '1B/Util'],
    ['SP', '710', 'Nathan Eovaldi', 'TEX', 'SP/P'],
    ['SP', '711', 'MacKenzie Gore', 'WSH', 'SP/P'],
    ['RP', '712', 'Robert Suarez', 'SD', 'RP/P'],
    ['BN', '713', 'Xavier Edwards', 'MIA', 'SS/2B'],
  ]),
  toTeam('8', 'Emerald City Sailors', 'Jamie', [
    ['C', '801', 'Yainer Diaz', 'HOU', 'C'],
    ['1B', '802', 'Luis Arraez', 'SF', '1B/2B'],
    ['2B', '803', 'Jazz Chisholm Jr.', 'NYY', '2B/3B'],
    ['3B', '804', 'Matt Chapman', 'SF', '3B'],
    ['SS', '805', 'Zach Neto', 'LAA', 'SS'],
    ['OF', '806', 'Teoscar Hernandez', 'LAD', 'OF'],
    ['OF', '807', 'Seiya Suzuki', 'CHC', 'OF/Util'],
    ['OF', '808', 'Lawrence Butler', 'ATH', 'OF'],
    ['Util', '809', 'Ian Happ', 'CHC', 'OF/Util'],
    ['SP', '810', 'Max Fried', 'NYY', 'SP/P'],
    ['SP', '811', 'Bryan Woo', 'SEA', 'SP/P'],
    ['RP', '812', 'Andres Munoz', 'SEA', 'RP/P'],
    ['BN', '813', 'Andy Pages', 'LAD', 'OF'],
  ]),
  toTeam('9', 'Queen City Crushers', 'Riley', [
    ['C', '901', 'Shea Langeliers', 'ATH', 'C'],
    ['1B', '902', 'Vinnie Pasquantino', 'KC', '1B'],
    ['2B', '903', 'Xander Bogaerts', 'SD', '2B/SS'],
    ['3B', '904', 'Isaac Paredes', 'HOU', '3B'],
    ['SS', '905', 'Anthony Volpe', 'NYY', 'SS'],
    ['OF', '906', 'Jackson Merrill', 'SD', 'OF'],
    ['OF', '907', 'Colton Cowser', 'BAL', 'OF'],
    ['OF', '908', 'Jasson Dominguez', 'NYY', 'OF'],
    ['Util', '909', 'Miguel Vargas', 'CWS', '3B/OF'],
    ['SP', '910', 'Shota Imanaga', 'CHC', 'SP/P'],
    ['SP', '911', 'Reid Detmers', 'LAA', 'SP/P'],
    ['RP', '912', 'Trevor Megill', 'MIL', 'RP/P'],
    ['BN', '913', 'Colson Montgomery', 'CWS', 'SS'],
  ]),
  toTeam('10', 'Golden Gate Grizzlies', 'Jesse', [
    ['C', '1001', 'Alejandro Kirk', 'TOR', 'C'],
    ['1B', '1002', 'Ryan Mountcastle', 'BAL', '1B'],
    ['2B', '1003', 'Brandon Lowe', 'TB', '2B'],
    ['3B', '1004', 'Royce Lewis', 'MIN', '3B'],
    ['SS', '1005', 'Geraldo Perdomo', 'ARI', 'SS'],
    ['OF', '1006', 'Christian Yelich', 'MIL', 'OF/Util'],
    ['OF', '1007', 'George Springer', 'TOR', 'OF/Util'],
    ['OF', '1008', 'Victor Scott II', 'STL', 'OF'],
    ['Util', '1009', 'Hunter Goodman', 'COL', 'C/Util'],
    ['SP', '1010', 'Framber Valdez', 'HOU', 'SP/P'],
    ['SP', '1011', 'Max Meyer', 'MIA', 'SP/P'],
    ['RP', '1012', 'Pete Fairbanks', 'TB', 'RP/P'],
    ['BN', '1013', 'Masyn Winn', 'STL', 'SS'],
  ]),
  toTeam('11', 'Beantown Bruisers', 'Drew', [
    ['C', '1101', 'Adley Rutschman', 'BAL', 'C'],
    ['1B', '1102', 'Cody Bellinger', 'NYY', '1B/OF'],
    ['2B', '1103', 'Jackson Holliday', 'BAL', '2B'],
    ['3B', '1104', 'Max Muncy', 'LAD', '3B'],
    ['SS', '1105', 'Jeremy Pena', 'HOU', 'SS'],
    ['OF', '1106', 'Mookie Betts', 'LAD', 'SS/OF'],
    ['OF', '1107', 'Kyle Stowers', 'MIA', 'OF'],
    ['OF', '1108', 'Jordan Walker', 'STL', 'OF'],
    ['Util', '1109', 'Willson Contreras', 'STL', '1B/Util'],
    ['SP', '1110', 'Logan Webb', 'SF', 'SP/P'],
    ['SP', '1111', 'Cam Schlittler', 'NYY', 'SP/P'],
    ['RP', '1112', 'David Bednar', 'PIT', 'RP/P'],
    ['BN', '1113', 'Kevin McGonigle', 'DET', 'SS'],
  ]),
  toTeam('12', 'Steel City Sluggers', 'Quinn', [
    ['C', '1201', 'Logan O\u2019Hoppe', 'LAA', 'C'],
    ['1B', '1202', 'Spencer Steer', 'CIN', '1B/OF'],
    ['2B', '1203', 'Jorge Polanco', 'SEA', '2B/3B'],
    ['3B', '1204', 'Nolan Arenado', 'STL', '3B'],
    ['SS', '1205', 'Willy Adames', 'SF', 'SS'],
    ['OF', '1206', 'Brenton Doyle', 'COL', 'OF'],
    ['OF', '1207', 'Josh Lowe', 'TB', 'OF'],
    ['OF', '1208', 'Otto Lopez', 'MIA', '2B/SS/OF'],
    ['Util', '1209', 'Gabriel Moreno', 'ARI', 'C/Util'],
    ['SP', '1210', 'Jacob deGrom', 'TEX', 'SP/P'],
    ['SP', '1211', 'Nolan McLean', 'NYM', 'SP/P'],
    ['RP', '1212', 'Jhoan Duran', 'MIN', 'RP/P'],
    ['BN', '1213', 'Gavin Williams', 'CLE', 'SP/P'],
  ]),
];

/**
 * Real 2026 season batting lines (through ~July 4, 2026) for a slice of the
 * league's hitters, sourced from public season-leader tables. Order + values are
 * the actual snapshot, so the Stats page shows genuine numbers. The leading number
 * is the player's overall (whole-pool) fantasy rank.
 * Row: [rank, id, name, mlbTeam, positions(csv), AVG, R, HR, RBI, SB, OPS].
 */
type BattingRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  string,
];

const BATTING_ROWS: BattingRow[] = [
  [3, '109', 'Yordan Alvarez', 'HOU', 'Util/OF', '.319', 60, 27, 61, 1, '1.055'],
  [58, '1208', 'Otto Lopez', 'MIA', '2B/SS/OF', '.337', 56, 7, 37, 17, '.861'],
  [9, '209', 'Kyle Schwarber', 'PHI', 'Util/OF', '.250', 55, 30, 55, 2, '.935'],
  [12, '204', 'Junior Caminero', 'TB', '3B/Util', '.288', 55, 25, 55, 0, '.934'],
  [21, '113', 'Ben Rice', 'NYY', 'C/1B', '.269', 58, 24, 56, 2, '.928'],
  [14, '307', 'James Wood', 'WSH', 'OF', '.265', 76, 22, 55, 13, '.918'],
  [24, '208', 'Byron Buxton', 'MIN', 'OF/Util', '.271', 57, 25, 44, 7, '.907'],
  [40, '409', 'Yandy Diaz', 'TB', '1B/Util', '.325', 46, 12, 53, 1, '.904'],
  [16, '309', 'Bryce Harper', 'PHI', '1B/Util', '.275', 56, 20, 56, 5, '.908'],
  [7, '206', 'Pete Crow-Armstrong', 'CHC', 'OF', '.287', 56, 19, 49, 21, '.898'],
  [33, '302', 'Matt Olson', 'ATL', '1B', '.273', 57, 22, 54, 2, '.883'],
  [44, '408', 'Brandon Marsh', 'PHI', 'OF', '.315', 50, 15, 46, 8, '.870'],
  [29, '1009', 'Hunter Goodman', 'COL', 'C/Util', '.246', 56, 27, 50, 5, '.858'],
  [11, '709', 'Nick Kurtz', 'ATH', '1B/Util', '.282', 61, 20, 66, 7, '.949'],
  [61, '802', 'Luis Arraez', 'SF', '1B/2B', '.326', 44, 4, 32, 6, '.825'],
  [88, '108', 'Jung Hoo Lee', 'SF', 'OF', '.319', 44, 5, 32, 6, '.803'],
];

const BATTING_COLUMNS = [
  { key: 'AVG', label: 'AVG', description: 'Batting average', aggregatable: false },
  { key: 'R', label: 'R', description: 'Runs', aggregatable: true },
  { key: 'HR', label: 'HR', description: 'Home runs', aggregatable: true },
  { key: 'RBI', label: 'RBI', description: 'Runs batted in', aggregatable: true },
  { key: 'SB', label: 'SB', description: 'Stolen bases', aggregatable: true },
  { key: 'OBP', label: 'OBP', description: 'On-base percentage', aggregatable: false },
  { key: 'SLG', label: 'SLG', description: 'Slugging percentage', aggregatable: false },
  { key: 'OPS', label: 'OPS', description: 'On-base plus slugging', aggregatable: false },
  { key: 'H/AB', label: 'H/AB', description: 'Hits / at bats', aggregatable: true },
];

/**
 * Real-ish 2026 season pitching lines for a slice of the league's arms. The leading
 * number is the player's overall (whole-pool) fantasy rank.
 * Row: [rank, id, name, mlbTeam, positions(csv), W, K, SV, ERA, WHIP].
 */
type PitchingRow = [number, string, string, string, string, number, number, number, string, string];

const PITCHING_ROWS: PitchingRow[] = [
  [1, '111', 'Paul Skenes', 'PIT', 'SP/P', 8, 160, 0, '2.10', '0.95'],
  [2, '110', 'Tarik Skubal', 'DET', 'SP/P', 11, 155, 0, '2.30', '0.92'],
  [6, '311', 'Zack Wheeler', 'PHI', 'SP/P', 10, 148, 0, '2.55', '0.98'],
  [8, '610', 'Garrett Crochet', 'BOS', 'SP/P', 9, 152, 0, '2.62', '1.01'],
  [15, '112', 'Emmanuel Clase', 'CLE', 'RP/P', 3, 45, 24, '1.85', '0.90'],
  [19, '212', 'Josh Hader', 'HOU', 'RP/P', 2, 58, 22, '2.05', '0.84'],
  [27, '410', 'Dylan Cease', 'TOR', 'SP/P', 7, 140, 0, '3.35', '1.14'],
  [34, '810', 'Max Fried', 'NYY', 'SP/P', 10, 118, 0, '2.95', '1.06'],
];

const PITCHING_COLUMNS = [
  { key: 'W', label: 'W', description: 'Wins', aggregatable: true },
  { key: 'K', label: 'K', description: 'Strikeouts', aggregatable: true },
  { key: 'SV', label: 'SV', description: 'Saves', aggregatable: true },
  { key: 'IP', label: 'IP', description: 'Innings pitched', aggregatable: true },
  { key: 'ERA', label: 'ERA', description: 'Earned run average', aggregatable: false },
  {
    key: 'WHIP',
    label: 'WHIP',
    description: 'Walks + hits per inning pitched',
    aggregatable: false,
  },
];

/**
 * Unrostered players for mock mode - deliberately NOT in any seeded roster, so the
 * free-agent tool/filter returns a realistic waiver pool. Same row shapes as the
 * rostered pools above. Sized like a real waiver wire (deep hitter + pitcher lists) so
 * the Players tab "Free agents only" view mirrors the paged live provider rather than a
 * handful of rows.
 */
const FA_BATTING_ROWS: BattingRow[] = [
  [72, 'fa-b1', 'Nolan Schanuel', 'LAA', '1B/Util', '.281', 41, 9, 40, 3, '.772'],
  [96, 'fa-b2', 'Tyler Fitzgerald', 'SF', '2B/SS/OF', '.259', 38, 11, 34, 14, '.735'],
  [110, 'fa-b3', 'Jake Meyers', 'HOU', 'OF', '.274', 35, 5, 30, 12, '.719'],
  [128, 'fa-b4', 'Ryan Jeffers', 'MIN', 'C', '.242', 29, 12, 37, 1, '.741'],
  [140, 'fa-b5', 'Luisangel Acuna', 'NYM', '2B/SS', '.263', 33, 4, 24, 15, '.702'],
  [158, 'fa-b6', 'Spencer Steer', 'CIN', '1B/3B/OF', '.248', 44, 14, 48, 8, '.728'],
  [166, 'fa-b7', 'Michael Toglia', 'COL', '1B/Util', '.221', 40, 18, 45, 6, '.731'],
  [175, 'fa-b8', 'Jose Caballero', 'TB', '2B/SS/OF', '.231', 37, 4, 22, 28, '.664'],
  [182, 'fa-b9', 'Trevor Larnach', 'MIN', 'OF/Util', '.256', 34, 13, 41, 2, '.744'],
  [190, 'fa-b10', 'LaMonte Wade Jr.', 'SF', '1B/OF', '.238', 39, 8, 29, 4, '.712'],
  [201, 'fa-b11', 'Ramon Laureano', 'BAL', 'OF', '.264', 31, 12, 35, 5, '.766'],
  [214, 'fa-b12', 'Nick Gonzales', 'PIT', '2B', '.253', 30, 7, 28, 6, '.700'],
  [223, 'fa-b13', 'Jonah Bride', 'MIA', '1B/3B', '.259', 27, 9, 33, 1, '.735'],
  [238, 'fa-b14', 'Tyler Stephenson', 'CIN', 'C', '.245', 28, 10, 34, 0, '.717'],
  [252, 'fa-b15', 'Jacob Young', 'WSH', 'OF', '.271', 42, 2, 20, 24, '.678'],
];

const FA_PITCHING_ROWS: PitchingRow[] = [
  [84, 'fa-p1', 'Ryan Pepiot', 'TB', 'SP/P', 7, 112, 0, '3.55', '1.12'],
  [102, 'fa-p2', 'Mitch Keller', 'PIT', 'SP/P', 6, 104, 0, '3.78', '1.18'],
  [126, 'fa-p3', 'Ryan Helsley', 'STL', 'RP/P', 3, 48, 19, '2.95', '1.09'],
  [150, 'fa-p4', 'Jose Soriano', 'LAA', 'SP/P', 5, 98, 0, '3.90', '1.24'],
  [162, 'fa-p5', 'Reese Olson', 'DET', 'SP/P', 6, 101, 0, '3.62', '1.15'],
  [178, 'fa-p6', 'Andrew Abbott', 'CIN', 'SP/P', 7, 96, 0, '3.48', '1.17'],
  [194, 'fa-p7', 'Jose Berrios', 'TOR', 'SP/P', 8, 110, 0, '4.05', '1.22'],
  [206, 'fa-p8', 'Kris Bubic', 'KC', 'SP/P', 6, 108, 0, '3.40', '1.10'],
  [219, 'fa-p9', 'Jeff Hoffman', 'TOR', 'RP/P', 4, 55, 17, '3.15', '1.08'],
  [231, 'fa-p10', 'Robert Suarez', 'SD', 'RP/P', 2, 52, 21, '3.05', '1.13'],
  [244, 'fa-p11', 'Porter Hodge', 'CHC', 'RP/P', 3, 50, 6, '3.25', '1.19'],
];

/* ---- range-stats + live-ticker mocks (parity with the live provider) ---- */

/**
 * The range-stats table combines every scoring category (batting + pitching), and
 * each player fills only the ones that apply to them - mirroring the live provider,
 * which builds columns from all of the league's enabled scoring stats.
 */
const RANGE_COLUMNS = [...BATTING_COLUMNS, ...PITCHING_COLUMNS];

/** Season batting/pitching values keyed by playerId, for the range-stats mock. */
const BATTING_BY_ID = new Map(BATTING_ROWS.map((r) => [r[1], r]));
const PITCHING_BY_ID = new Map(PITCHING_ROWS.map((r) => [r[1], r]));

/** Counting stats scale with the window; rate stats (AVG/OPS/ERA/WHIP) stay fixed. */
const COUNTING_KEYS = new Set(['R', 'HR', 'RBI', 'SB', 'W', 'K', 'SV']);
const RANGE_FACTOR: Record<StatRange, number> = {
  season: 1,
  last30: 1 / 3,
  last21: 1 / 4,
  last14: 1 / 6,
  last7: 1 / 12,
  today: 1 / 80,
};

/** Build one player's values across RANGE_COLUMNS for the given window. */
function rangeStatsForPlayer(playerId: string, range: StatRange) {
  const b = BATTING_BY_ID.get(playerId);
  const p = PITCHING_BY_ID.get(playerId);
  const factor = RANGE_FACTOR[range];
  const raw: Record<string, string | number> = {};
  if (b) {
    const [, , , , , avg, r, hr, rbi, sb, ops] = b;
    Object.assign(raw, {
      AVG: avg,
      R: r,
      HR: hr,
      RBI: rbi,
      SB: sb,
      OPS: ops,
      ...battingRateComponents(avg, ops, hr, factor),
    });
  }
  if (p) {
    const [, , , , , w, k, sv, era, whip] = p;
    Object.assign(raw, {
      W: w,
      K: k,
      SV: sv,
      ERA: era,
      WHIP: whip,
      IP: pitchingIpFromWins(w, factor),
    });
  }
  return RANGE_COLUMNS.map((col) => {
    if (!(col.key in raw)) return { key: col.key, value: '-' as const };
    const value = raw[col.key]!;
    if (typeof value === 'number' && COUNTING_KEYS.has(col.key)) {
      return { key: col.key, value: Math.round(value * factor) };
    }
    return { key: col.key, value };
  });
}

/** A slice of mock MLB games so the "Today" ticker renders in mock mode. Uses the
 * same team abbreviations as the seeded rosters; the frontend normalizes both sides. */
const MOCK_MLB_GAMES: MlbGamesResponse['games'] = [
  {
    gamePk: 1,
    state: 'live',
    detail: 'In Progress',
    homeAbbr: 'NYY',
    awayAbbr: 'BOS',
    homeScore: 3,
    awayScore: 2,
    inning: 5,
    inningState: 'Top',
    battingOrder: {
      [playerGameKey('NYY', 'Aaron Judge')]: 3,
      [playerGameKey('NYY', 'Austin Wells')]: 8,
      [playerGameKey('NYY', 'Ben Rice')]: 9,
    },
    probablePitchers: [playerGameKey('NYY', 'Mock Starter')],
    situation: {
      balls: 2,
      strikes: 1,
      outs: 1,
      first: 'Austin Wells',
      third: 'Ben Rice',
      batter: 'Aaron Judge',
      pitcher: 'Mock Starter',
    },
  },
  {
    gamePk: 2,
    state: 'live',
    detail: 'In Progress',
    homeAbbr: 'PHI',
    awayAbbr: 'ATL',
    homeScore: 1,
    awayScore: 4,
    inning: 7,
    inningState: 'Bottom',
    battingOrder: {
      [playerGameKey('PHI', 'Kyle Schwarber')]: 3,
      [playerGameKey('ATL', 'Matt Olson')]: 4,
    },
    probablePitchers: [playerGameKey('PHI', 'Cristopher Sanchez')],
    situation: {
      balls: 0,
      strikes: 2,
      outs: 2,
      second: 'Trea Turner',
      batter: 'Kyle Schwarber',
      pitcher: 'Cristopher Sanchez',
    },
  },
  {
    gamePk: 3,
    state: 'live',
    detail: 'In Progress',
    homeAbbr: 'CHC',
    awayAbbr: 'MIL',
    homeScore: 2,
    awayScore: 2,
    inning: 3,
    inningState: 'Middle',
    battingOrder: {
      [playerGameKey('CHC', 'Pete Crow-Armstrong')]: 1,
      [playerGameKey('CHC', 'Kyle Tucker')]: 2,
      [playerGameKey('MIL', 'Brice Turang')]: 4,
    },
    probablePitchers: [playerGameKey('CHC', 'Mock Starter')],
  },
  {
    gamePk: 4,
    state: 'final',
    detail: 'Final',
    homeAbbr: 'LAD',
    awayAbbr: 'SF',
    homeScore: 6,
    awayScore: 5,
  },
  {
    gamePk: 5,
    state: 'final',
    detail: 'Final',
    homeAbbr: 'HOU',
    awayAbbr: 'SEA',
    homeScore: 4,
    awayScore: 1,
  },
  {
    gamePk: 6,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-04T23:05:00Z',
    homeAbbr: 'TB',
    awayAbbr: 'SD',
  },
  {
    gamePk: 7,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-04T23:10:00Z',
    homeAbbr: 'CLE',
    awayAbbr: 'TEX',
  },
  {
    gamePk: 8,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-04T23:15:00Z',
    homeAbbr: 'WSH',
    awayAbbr: 'NYM',
  },
  {
    gamePk: 9,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-04T23:40:00Z',
    homeAbbr: 'MIN',
    awayAbbr: 'BAL',
  },
  {
    gamePk: 10,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-05T00:05:00Z',
    homeAbbr: 'KC',
    awayAbbr: 'DET',
  },
  {
    gamePk: 11,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-05T00:07:00Z',
    homeAbbr: 'TOR',
    awayAbbr: 'LAA',
  },
  {
    gamePk: 12,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-05T00:10:00Z',
    homeAbbr: 'CIN',
    awayAbbr: 'OAK',
  },
  {
    gamePk: 13,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-05T00:15:00Z',
    homeAbbr: 'STL',
    awayAbbr: 'PIT',
  },
  {
    gamePk: 14,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-05T01:40:00Z',
    homeAbbr: 'COL',
    awayAbbr: 'MIA',
  },
  {
    gamePk: 15,
    state: 'scheduled',
    detail: 'Scheduled',
    startTime: '2026-07-05T00:10:00Z',
    homeAbbr: 'CWS',
    awayAbbr: 'ARI',
  },
];

/** Mock MLB games source injected into the /api/mlb router in mock mode. */
export function getMockMlbGames(date: string): Promise<MlbGamesResponse> {
  return Promise.resolve(mlbGamesResponseSchema.parse({ date, games: MOCK_MLB_GAMES }));
}

/** Named batters for a mock box score side, so ownership highlighting has something to match. */
const MOCK_BOX_BATTERS: Record<string, string[]> = {
  NYY: ['Aaron Judge', 'Austin Wells', 'Ben Rice', 'Anthony Volpe', 'Jazz Chisholm Jr.'],
  BOS: ['Rafael Devers', 'Jarren Duran', 'Trevor Story', 'Wilyer Abreu', 'Ceddanne Rafaela'],
};

function mockBatter(fullName: string, order: number): MlbBoxBatter {
  const h = (order * 2) % 4;
  return {
    fullName,
    position: order === 1 ? 'DH' : 'OF',
    battingOrder: order,
    ab: 4,
    r: h > 0 ? 1 : 0,
    h,
    rbi: h,
    hr: order === 1 && h > 1 ? 1 : 0,
    bb: order % 3 === 0 ? 1 : 0,
    so: order % 2,
    avg: `.2${50 + order}`,
  };
}

function mockPitcher(fullName: string, decision?: string): MlbBoxPitcher {
  return {
    fullName,
    ...(decision ? { decision } : {}),
    ip: decision === 'W' ? '6.0' : '1.0',
    h: decision === 'W' ? 5 : 0,
    r: decision === 'W' ? 2 : 0,
    er: decision === 'W' ? 2 : 0,
    bb: 1,
    so: decision === 'W' ? 6 : 2,
    hr: decision === 'W' ? 1 : 0,
    pitches: decision === 'W' ? 92 : 14,
    era: '3.42',
  };
}

function mockBoxSide(abbr: string, runs: number, decision?: string): MlbBoxSide {
  const names = MOCK_BOX_BATTERS[abbr] ?? [
    `${abbr} Leadoff`,
    `${abbr} Two Hitter`,
    `${abbr} Slugger`,
    `${abbr} Cleanup`,
    `${abbr} Utility`,
  ];
  const batters = names.map((n, i) => mockBatter(n, i + 1));
  return {
    teamAbbr: abbr,
    teamName: abbr,
    runs,
    hits: batters.reduce((sum, b) => sum + b.h, 0),
    errors: 0,
    batters,
    pitchers: [mockPitcher(`${abbr} Starter`, decision)],
  };
}

/**
 * Mock box score injected into the /api/mlb router in mock mode. Looks up the seeded game
 * by gamePk to reuse its team abbreviations (so ownership highlighting works for NYY
 * players in game 1), and falls back to a generic two-team line for unknown ids.
 */
export function getMockBoxScore(gamePk: number): Promise<MlbBoxScoreResponse> {
  const game = MOCK_MLB_GAMES.find((g) => g.gamePk === gamePk);
  const homeAbbr = game?.homeAbbr ?? 'NYY';
  const awayAbbr = game?.awayAbbr ?? 'BOS';
  const homeRuns = game?.homeScore ?? 3;
  const awayRuns = game?.awayScore ?? 2;
  return Promise.resolve(
    mlbBoxScoreResponseSchema.parse({
      gamePk,
      home: mockBoxSide(homeAbbr, homeRuns, homeRuns >= awayRuns ? 'W' : undefined),
      away: mockBoxSide(awayAbbr, awayRuns, awayRuns > homeRuns ? 'W' : 'SV'),
    }),
  );
}

/**
 * Mock player-news source injected into the /api/mlb router in mock mode, so the
 * player-focus modal renders offline without hitting the public ESPN/MLB APIs.
 */
export function getMockPlayerNews(name: string): Promise<PlayerNewsResponse> {
  return Promise.resolve({
    player: name,
    matched: true,
    items: [
      {
        id: 'mlb:mock:0',
        source: 'mlb',
        type: 'Status Change',
        headline: `${name} activated from the 10-day injured list.`,
        published: '2026-07-05',
      },
      {
        id: 'espn:mock:1',
        source: 'espn',
        type: 'HeadlineNews',
        headline: `${name} stays hot with a multi-hit night.`,
        description: 'A mock article summary for local development.',
        published: '2026-07-04T18:30:00Z',
      },
    ],
  });
}

/**
 * Mock game-log source injected into the /api/mlb router in mock mode, so the
 * player-focus card can render recent lines offline.
 */
export function getMockPlayerGameLog(name: string): Promise<PlayerGameLogResponse> {
  const pitcher = /\b(skubal|cole|crochet|wheeler|sale|pitcher)\b/i.test(name);
  return Promise.resolve({
    player: name,
    matched: true,
    batting: pitcher
      ? []
      : [
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
          {
            date: '2026-07-03',
            opponent: 'BOS',
            home: true,
            ab: 5,
            r: 1,
            h: 1,
            doubles: 0,
            triples: 0,
            hr: 1,
            rbi: 2,
            bb: 0,
            so: 2,
            sb: 0,
            avg: '.200',
          },
          {
            date: '2026-07-01',
            opponent: 'TOR',
            home: false,
            ab: 4,
            r: 0,
            h: 0,
            doubles: 0,
            triples: 0,
            hr: 0,
            rbi: 0,
            bb: 1,
            so: 1,
            sb: 0,
            avg: '.000',
          },
        ],
    pitching: pitcher
      ? [
          {
            date: '2026-07-03',
            opponent: 'HOU',
            home: false,
            ip: '7.0',
            h: 4,
            r: 1,
            er: 1,
            bb: 1,
            so: 9,
            hr: 0,
            decision: 'W',
            pitches: 98,
          },
          {
            date: '2026-06-28',
            opponent: 'SEA',
            home: true,
            ip: '6.1',
            h: 6,
            r: 3,
            er: 3,
            bb: 2,
            so: 7,
            hr: 1,
            decision: 'L',
            pitches: 104,
          },
        ]
      : [],
  });
}

/** Which fantasy team rosters each player id, for the league-wide stats table. */
const OWNER_BY_PLAYER_ID = new Map<string, string>(
  TEAMS.flatMap((t) => t.slots.map((s) => [s.player.playerId, t.teamName] as const)),
);

/** Yahoo-style average string with a leading dot, e.g. 0.275 -> ".275". */
function leadingDot(value: number, digits: number): string {
  return value.toFixed(digits).replace(/^0/, '');
}

function parseRateString(value: string): number {
  return Number(value.startsWith('.') ? `0${value}` : value);
}

/** H/AB + OBP/SLG split from AVG/OPS for roster rate-total pooling in mock mode. */
function battingRateComponents(avg: string, ops: string, hr: number, factor: number) {
  const ab = Math.max(1, Math.round(420 * factor));
  const avgN = parseRateString(avg);
  const opsN = parseRateString(ops);
  const hits = Math.round(avgN * ab);
  const slgN = Math.min(opsN, avgN + (hr / ab) * 2);
  const obpN = Math.max(0, opsN - slgN);
  return {
    'H/AB': `${hits}/${ab}`,
    OBP: leadingDot(obpN, 3),
    SLG: leadingDot(slgN, 3),
  };
}

function pitchingIpFromWins(w: number, factor: number): string {
  const ip = Math.max(1, Math.round((w * 6 + 24) * factor));
  return `${ip}.0`;
}

/** The 10 head-to-head scoring categories (batting + pitching) used for per-category winners. */
const MOCK_SCORING_KEYS = ['AVG', 'R', 'HR', 'RBI', 'SB', 'W', 'K', 'SV', 'ERA', 'WHIP'];

/** The seeded fantasy-week window for mock mode (season through ~July 4). */
const MOCK_START_WEEK = 1;
const MOCK_CURRENT_WEEK = 14;
const MOCK_WEEKS = Array.from(
  { length: MOCK_CURRENT_WEEK - MOCK_START_WEEK + 1 },
  (_, i) => MOCK_START_WEEK + i,
);

/**
 * Deterministic team totals for one team (by standings index) and coverage bucket,
 * so the Team Stats grid is populated and varied in mock mode. Counting stats are a
 * per-week base scaled to the bucket (season = every elapsed week; a single week
 * gets a deterministic jitter so weeks differ); rate stats (Yahoo computes these
 * server-side) stay fixed regardless of bucket.
 */
function teamBucketTotals(
  index: number,
  bucket: number | 'season',
): Record<string, string | number> {
  const perWeek = {
    R: 30 - index,
    HR: 9 - Math.floor(index / 2),
    RBI: 29 - index,
    SB: 5 - Math.floor(index / 3),
    W: 5,
    K: 70 - index * 2,
    SV: 3,
  };
  const weeksElapsed = MOCK_WEEKS.length;
  // Season sums every elapsed week; a single week uses a deterministic jitter.
  const factor = bucket === 'season' ? weeksElapsed : 0.7 + ((bucket + index) % 5) * 0.12;
  const scale = (base: number) => Math.max(0, Math.round(base * factor));
  return {
    AVG: leadingDot(0.278 - index * 0.004, 3),
    R: scale(perWeek.R),
    HR: scale(perWeek.HR),
    RBI: scale(perWeek.RBI),
    SB: scale(perWeek.SB),
    OPS: leadingDot(0.795 - index * 0.009, 3),
    W: scale(perWeek.W),
    K: scale(perWeek.K),
    SV: scale(perWeek.SV),
    ERA: (3.38 + index * 0.13).toFixed(2),
    WHIP: (1.13 + index * 0.02).toFixed(2),
  };
}

/** Deterministic standings row for one team (by index): rank, W/L, %, GB, moves. */
function standingsRowFor(index: number) {
  const wins = 140 - index * 6;
  const losses = 58 + index * 6;
  const ties = index % 3;
  const games = wins + losses + ties;
  const percentage = leadingDot((wins + ties * 0.5) / games, 3);
  const gamesBack = index === 0 ? '-' : (index * 4.5).toFixed(1).replace(/\.0$/, '');
  return {
    rank: index + 1,
    wins,
    losses,
    ties,
    winPercentage: percentage,
    gamesBack,
    moves: 34 - index,
  };
}

/**
 * A deterministic recent-transactions log for mock mode. Uses seeded team names and a
 * mix of rostered/free-agent players so the Standings activity log and the AI tool have
 * realistic add/drop/waiver/trade rows. Timestamps step back from the coverage date so
 * they render newest-first. Validated by the schema, like every other mock payload.
 */
const MOCK_TX_BASE_TS = Math.floor(Date.parse(`${COVERAGE_DATE}T15:00:00Z`) / 1000);
const HOUR = 3600;

const MOCK_TRANSACTIONS: LeagueTransactionsResponse['transactions'] = [
  {
    transactionId: '5012',
    type: 'add/drop',
    status: 'successful',
    timestamp: MOCK_TX_BASE_TS - 2 * HOUR,
    players: [
      {
        playerId: 'fa-b1',
        fullName: 'Nolan Schanuel',
        mlbTeamAbbr: 'LAA',
        displayPosition: '1B',
        positionType: 'B',
        movement: 'add',
        destinationTeamName: 'Windy City Heat',
      },
      {
        playerId: '213',
        fullName: 'Nico Hoerner',
        mlbTeamAbbr: 'CHC',
        displayPosition: '2B,SS',
        positionType: 'B',
        movement: 'drop',
        sourceTeamName: 'Windy City Heat',
      },
    ],
  },
  {
    transactionId: '5011',
    type: 'trade',
    status: 'successful',
    timestamp: MOCK_TX_BASE_TS - 20 * HOUR,
    players: [
      {
        playerId: '113',
        fullName: 'Ben Rice',
        mlbTeamAbbr: 'NYY',
        displayPosition: 'C,1B',
        positionType: 'B',
        movement: 'trade',
        sourceTeamName: 'Bronx Bombers',
        destinationTeamName: 'Sandlot Kings',
      },
      {
        playerId: '313',
        fullName: 'Michael Harris II',
        mlbTeamAbbr: 'ATL',
        displayPosition: 'OF',
        positionType: 'B',
        movement: 'trade',
        sourceTeamName: 'Sandlot Kings',
        destinationTeamName: 'Bronx Bombers',
      },
    ],
  },
  {
    transactionId: '5010',
    type: 'add',
    status: 'successful',
    timestamp: MOCK_TX_BASE_TS - 30 * HOUR,
    players: [
      {
        playerId: 'fa-p1',
        fullName: 'Ryan Pepiot',
        mlbTeamAbbr: 'TB',
        displayPosition: 'SP',
        positionType: 'P',
        movement: 'add',
        destinationTeamName: 'Steel City Sluggers',
      },
    ],
  },
  {
    transactionId: '5009',
    type: 'drop',
    status: 'successful',
    timestamp: MOCK_TX_BASE_TS - 44 * HOUR,
    players: [
      {
        playerId: '613',
        fullName: 'Gleyber Torres',
        mlbTeamAbbr: 'DET',
        displayPosition: '2B',
        positionType: 'B',
        movement: 'drop',
        sourceTeamName: 'Motor City Mashers',
      },
    ],
  },
  {
    transactionId: '5008',
    type: 'add/drop',
    status: 'successful',
    timestamp: MOCK_TX_BASE_TS - 60 * HOUR,
    players: [
      {
        playerId: 'fa-b3',
        fullName: 'Jake Meyers',
        mlbTeamAbbr: 'HOU',
        displayPosition: 'OF',
        positionType: 'B',
        movement: 'add',
        destinationTeamName: 'Emerald City Sailors',
      },
      {
        playerId: '813',
        fullName: 'Andy Pages',
        mlbTeamAbbr: 'LAD',
        displayPosition: 'OF',
        positionType: 'B',
        movement: 'drop',
        sourceTeamName: 'Emerald City Sailors',
      },
    ],
  },
  {
    transactionId: '5007',
    type: 'add',
    status: 'successful',
    timestamp: MOCK_TX_BASE_TS - 78 * HOUR,
    players: [
      {
        playerId: 'fa-b2',
        fullName: 'Tyler Fitzgerald',
        mlbTeamAbbr: 'SF',
        displayPosition: '2B,SS,OF',
        positionType: 'B',
        movement: 'add',
        destinationTeamName: 'River City Rockets',
      },
    ],
  },
];

export class MockFantasyProvider implements FantasyProvider {
  getMyLeagues(): Promise<MeLeaguesResponse> {
    return Promise.resolve(
      meLeaguesResponseSchema.parse({
        userGuid: 'MOCKGUID000000000000000000',
        leagues: [
          {
            leagueId: '24281',
            name: 'Diamond Legends 2026',
            season: '2026',
            teamName: 'Bronx Bombers',
          },
        ],
      }),
    );
  }

  getLeagueRosters(_tokens: unknown, leagueId: string): Promise<LeagueRostersResponse> {
    return Promise.resolve(
      leagueRostersResponseSchema.parse({
        leagueId,
        teams: TEAMS,
      }),
    );
  }

  getPlayerStats(
    _tokens: unknown,
    leagueId: string,
    range: StatRange,
  ): Promise<PlayerStatsResponse> {
    // Counting stats scale with the window (rate stats stay fixed) so the range
    // toggle visibly changes the table in mock mode, matching the live behavior.
    const scale = (key: string, value: string | number) =>
      typeof value === 'number' && COUNTING_KEYS.has(key)
        ? Math.round(value * RANGE_FACTOR[range])
        : value;
    return Promise.resolve(
      playerStatsResponseSchema.parse({
        leagueId,
        batting: {
          columns: BATTING_COLUMNS,
          players: BATTING_ROWS.map(
            ([
              overallRank,
              playerId,
              fullName,
              mlbTeamAbbr,
              eligible,
              avg,
              r,
              hr,
              rbi,
              sb,
              ops,
            ]) => {
              const rateParts = battingRateComponents(avg, ops, hr, RANGE_FACTOR[range]);
              return {
              player: {
                playerId,
                fullName,
                mlbTeamAbbr,
                eligiblePositions: eligible.split('/'),
              },
              stats: [
                { key: 'AVG', value: avg },
                { key: 'R', value: scale('R', r) },
                { key: 'HR', value: scale('HR', hr) },
                { key: 'RBI', value: scale('RBI', rbi) },
                { key: 'SB', value: scale('SB', sb) },
                { key: 'OBP', value: rateParts.OBP },
                { key: 'SLG', value: rateParts.SLG },
                { key: 'OPS', value: ops },
                { key: 'H/AB', value: rateParts['H/AB'] },
              ],
              overallRank,
              ...(OWNER_BY_PLAYER_ID.has(playerId)
                ? { owner: OWNER_BY_PLAYER_ID.get(playerId) }
                : {}),
            };
            },
          ),
        },
        pitching: {
          columns: PITCHING_COLUMNS,
          players: PITCHING_ROWS.map(
            ([overallRank, playerId, fullName, mlbTeamAbbr, eligible, w, k, sv, era, whip]) => ({
              player: {
                playerId,
                fullName,
                mlbTeamAbbr,
                eligiblePositions: eligible.split('/'),
              },
              stats: [
                { key: 'W', value: scale('W', w) },
                { key: 'K', value: scale('K', k) },
                { key: 'SV', value: scale('SV', sv) },
                { key: 'IP', value: pitchingIpFromWins(w, RANGE_FACTOR[range]) },
                { key: 'ERA', value: era },
                { key: 'WHIP', value: whip },
              ],
              overallRank,
              ...(OWNER_BY_PLAYER_ID.has(playerId)
                ? { owner: OWNER_BY_PLAYER_ID.get(playerId) }
                : {}),
            }),
          ),
        },
      }),
    );
  }

  getTeamRangeStats(
    _tokens: unknown,
    leagueId: string,
    teamId: string,
    range: StatRange,
  ): Promise<TeamStatsResponse> {
    const team = TEAMS.find((t) => t.teamId === teamId);
    const players = (team?.slots ?? []).map((slot) => ({
      player: slot.player,
      stats: rangeStatsForPlayer(slot.player.playerId, range),
    }));
    return Promise.resolve(
      teamStatsResponseSchema.parse({
        leagueId,
        teamId,
        range,
        battingColumns: BATTING_COLUMNS,
        pitchingColumns: PITCHING_COLUMNS,
        players,
      }),
    );
  }

  getTeamWeekStats(
    _tokens: unknown,
    leagueId: string,
    teamId: string,
    week: number,
  ): Promise<TeamWeekStatsResponse> {
    const team = TEAMS.find((t) => t.teamId === teamId);
    // A single fantasy week looks roughly like a "last 7" slice of the season line.
    const players = (team?.slots ?? []).map((slot) => ({
      player: slot.player,
      stats: rangeStatsForPlayer(slot.player.playerId, 'last7'),
    }));
    return Promise.resolve(
      teamWeekStatsResponseSchema.parse({
        leagueId,
        teamId,
        week,
        battingColumns: BATTING_COLUMNS,
        pitchingColumns: PITCHING_COLUMNS,
        players,
      }),
    );
  }

  getLeagueTeamStats(
    _tokens: unknown,
    leagueId: string,
    bucket: TeamStatBucket,
  ): Promise<LeagueTeamStatsResponse> {
    const statLine = (index: number, wk: number | 'season') => {
      const totals = teamBucketTotals(index, wk);
      return RANGE_COLUMNS.map((col) => ({ key: col.key, value: totals[col.key] ?? '-' }));
    };

    // Multi-week window: roll up the trailing N seeded weeks (same aggregation the
    // live provider uses, so the mock exercises the real code path).
    const windowSize =
      typeof bucket === 'string' && bucket !== 'season' ? TEAM_STAT_WINDOW_SIZE[bucket] : 0;
    const aggregatedWeeks = windowSize ? resolveWindowWeeks(MOCK_WEEKS, windowSize) : [];
    if (windowSize && aggregatedWeeks.length > 0) {
      const teams = TEAMS.map((team, index) => ({
        teamId: team.teamId,
        teamName: team.teamName,
        stats: aggregateWeeklyTeamStats(
          aggregatedWeeks.map((wk) => statLine(index, wk)),
          RANGE_COLUMNS,
        ),
      }));
      return Promise.resolve(
        leagueTeamStatsResponseSchema.parse({
          leagueId,
          bucket,
          weeks: MOCK_WEEKS,
          aggregatedWeeks,
          battingColumns: BATTING_COLUMNS,
          pitchingColumns: PITCHING_COLUMNS,
          teams,
        }),
      );
    }

    // Single coverage: a specific week, or season (the fallback for anything else).
    const resolvedBucket: number | 'season' =
      typeof bucket === 'number' && MOCK_WEEKS.includes(bucket) ? bucket : 'season';
    const teams = TEAMS.map((team, index) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      stats: statLine(index, resolvedBucket),
    }));
    return Promise.resolve(
      leagueTeamStatsResponseSchema.parse({
        leagueId,
        bucket: resolvedBucket,
        weeks: MOCK_WEEKS,
        battingColumns: BATTING_COLUMNS,
        pitchingColumns: PITCHING_COLUMNS,
        teams,
      }),
    );
  }

  getLeagueStandings(_tokens: unknown, leagueId: string): Promise<LeagueStandingsResponse> {
    const teams = TEAMS.map((team, index) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      ...(team.managerName ? { managerName: team.managerName } : {}),
      ...standingsRowFor(index),
    }));
    return Promise.resolve(leagueStandingsResponseSchema.parse({ leagueId, teams }));
  }

  getLeagueMatchups(_tokens: unknown, leagueId: string): Promise<LeagueMatchupsResponse> {
    // Pair adjacent teams into head-to-head matchups for the current week. The
    // categories-won counts are deterministic and skewed against the season order
    // (later teams lead this week) so the live re-rank visibly differs.
    const matchups = [];
    for (let i = 0; i + 1 < TEAMS.length; i += 2) {
      const home = TEAMS[i];
      const away = TEAMS[i + 1];
      if (!home || !away) continue;
      // 10 scoring categories per week split into home wins / away wins / ties.
      const homeWon = 4 + (i % 3);
      const awayWon = 5 - (i % 3);
      const tied = 10 - homeWon - awayWon;
      // Assign each scoring category to a winner (or tie) consistent with the counts,
      // so the per-category grid highlights match the categoriesWon totals.
      const statWinners = MOCK_SCORING_KEYS.map((statKey, j) => {
        if (j < homeWon) return { statKey, winnerTeamId: home.teamId };
        if (j < homeWon + awayWon) return { statKey, winnerTeamId: away.teamId };
        return { statKey, isTied: true };
      });
      matchups.push({
        week: MOCK_CURRENT_WEEK,
        status: 'midevent' as const,
        teams: [
          {
            teamId: home.teamId,
            teamName: home.teamName,
            categoriesWon: homeWon,
            categoriesLost: awayWon,
            categoriesTied: tied,
          },
          {
            teamId: away.teamId,
            teamName: away.teamName,
            categoriesWon: awayWon,
            categoriesLost: homeWon,
            categoriesTied: tied,
          },
        ],
        statWinners,
      });
    }
    return Promise.resolve(
      leagueMatchupsResponseSchema.parse({ leagueId, week: MOCK_CURRENT_WEEK, matchups }),
    );
  }

  getFreeAgents(
    _tokens: unknown,
    leagueId: string,
    query: FreeAgentsQuery,
  ): Promise<LeagueFreeAgentsResponse> {
    // `limit` caps players PER table (batting/pitching), matching the live provider; the
    // default shows the full seeded pool for each.
    const { range, position, limit = Math.max(FA_BATTING_ROWS.length, FA_PITCHING_ROWS.length) } =
      query;
    const factor = RANGE_FACTOR[range];
    const scale = (key: string, value: string | number) =>
      typeof value === 'number' && COUNTING_KEYS.has(key) ? Math.round(value * factor) : value;
    const matchesPosition = (eligible: string) =>
      !position || eligible.split('/').includes(position);

    const battingPlayers = FA_BATTING_ROWS.filter(([, , , , eligible]) =>
      matchesPosition(eligible),
    ).map(([overallRank, playerId, fullName, mlbTeamAbbr, eligible, avg, r, hr, rbi, sb, ops]) => {
      const rateParts = battingRateComponents(avg, ops, hr, factor);
      return {
        player: { playerId, fullName, mlbTeamAbbr, eligiblePositions: eligible.split('/') },
        stats: [
          { key: 'AVG', value: avg },
          { key: 'R', value: scale('R', r) },
          { key: 'HR', value: scale('HR', hr) },
          { key: 'RBI', value: scale('RBI', rbi) },
          { key: 'SB', value: scale('SB', sb) },
          { key: 'OBP', value: rateParts.OBP },
          { key: 'SLG', value: rateParts.SLG },
          { key: 'OPS', value: ops },
          { key: 'H/AB', value: rateParts['H/AB'] },
        ],
        overallRank,
      };
    });

    const pitchingPlayers = FA_PITCHING_ROWS.filter(([, , , , eligible]) =>
      matchesPosition(eligible),
    ).map(([overallRank, playerId, fullName, mlbTeamAbbr, eligible, w, k, sv, era, whip]) => ({
      player: { playerId, fullName, mlbTeamAbbr, eligiblePositions: eligible.split('/') },
      stats: [
        { key: 'W', value: scale('W', w) },
        { key: 'K', value: scale('K', k) },
        { key: 'SV', value: scale('SV', sv) },
        { key: 'IP', value: pitchingIpFromWins(w, factor) },
        { key: 'ERA', value: era },
        { key: 'WHIP', value: whip },
      ],
      overallRank,
    }));

    return Promise.resolve(
      leagueFreeAgentsResponseSchema.parse({
        leagueId,
        range,
        batting: { columns: BATTING_COLUMNS, players: battingPlayers.slice(0, limit) },
        pitching: { columns: PITCHING_COLUMNS, players: pitchingPlayers.slice(0, limit) },
      }),
    );
  }

  getLeagueTransactions(
    _tokens: unknown,
    leagueId: string,
    count: number,
  ): Promise<LeagueTransactionsResponse> {
    return Promise.resolve(
      leagueTransactionsResponseSchema.parse({
        leagueId,
        transactions: MOCK_TRANSACTIONS.slice(0, count),
      }),
    );
  }
}
