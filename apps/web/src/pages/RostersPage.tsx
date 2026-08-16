import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  LeagueRostersResponse,
  LeagueSummary,
  MlbGameState,
  RosterSlot,
  StatColumn,
  StatRange,
  StatValue,
  TeamRoster,
  TeamStatsResponse,
} from '@fcm/contracts';
import { isPitcherRosterSlot, normalizeTeamAbbr, playerGameKey } from '@fcm/contracts';
import { getLeagueRosters, getMlbGames, getTeamRangeStats } from '../api/client';
import { useSession } from '../context/SessionContext';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { PlayerMetaFooter } from '../components/PlayerMetaFooter';
import { PlayerNameButton } from '../components/PlayerNameButton';
import { computeRosterTotals } from '../lib/rosterTotals';
import { formatMlbGameLine } from '../lib/mlbGameLine';
import styles from '../components/dataTable.module.css';

export function RostersPage() {
  const state = useFirstLeagueResource(getLeagueRosters);

  if (state.status !== 'ready') {
    return <LeagueResourceNotice status={state.status} />;
  }
  return <RostersView data={state.data} league={state.league} />;
}

const RANGES: { value: StatRange; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7' },
  { value: 'last14', label: 'Last 14' },
  { value: 'last30', label: 'Last 30' },
  { value: 'season', label: 'Season' },
];

/** How often to refresh live game state while viewing the Today ticker. */
const TICKER_POLL_MS = 30_000;

function normalizeAbbr(abbr: string): string {
  return normalizeTeamAbbr(abbr);
}

/** Today's calendar date in US Eastern time (matches the API's MLB "game day"). */
function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rosterRowClass(selectedPosition: string): string | undefined {
  if (selectedPosition === 'BN') return styles.benchRow;
  if (selectedPosition === 'IL' || selectedPosition.startsWith('IL')) return styles.injuredRow;
  return undefined;
}

function RostersView({ data, league }: { data: LeagueRostersResponse; league: LeagueSummary }) {
  const { session } = useSession();
  // Last 14 is an MLB-source-only window; only offer it when the server advertises it.
  const supportsLast14 = session.status === 'connected' && session.supportsLast14;
  const visibleRanges = useMemo(
    () => RANGES.filter((r) => r.value !== 'last14' || supportsLast14),
    [supportsLast14],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTeam = searchParams.get('team');
  const teamExists = (id: string | null): id is string =>
    id != null && data.teams.some((t) => t.teamId === id);

  const [selectedTeamId, setSelectedTeamId] = useState(() =>
    teamExists(paramTeam) ? paramTeam : (data.teams[0]?.teamId ?? ''),
  );
  const [range, setRange] = useState<StatRange>('today');
  const [date, setDate] = useState(easternToday);
  const today = easternToday();
  const isToday = date === today;
  const [datedTeams, setDatedTeams] = useState<TeamRoster[] | null>(null);

  // Sync the dropdown when a deep-link `?team=` arrives (e.g. from Live Standings).
  useEffect(() => {
    if (teamExists(paramTeam)) setSelectedTeamId(paramTeam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramTeam]);

  const selectTeam = (teamId: string) => {
    setSelectedTeamId(teamId);
    setSearchParams({ team: teamId }, { replace: true });
  };
  const selectRange = (next: StatRange) => {
    setRange(next);
    if (next !== 'today') setDate(easternToday());
  };

  const [stats, setStats] = useState<TeamStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [games, setGames] = useState<MlbGameState[]>([]);

  const teams = datedTeams ?? data.teams;
  const team = teams.find((t) => t.teamId === selectedTeamId) ?? teams[0];
  const teamId = team?.teamId ?? '';

  // Historical lineup for the selected game day. Today's snapshot already loaded
  // with the page; paging backwards refetches every team's roster for that date.
  useEffect(() => {
    if (range !== 'today' || isToday) {
      setDatedTeams(null);
      return;
    }
    let stale = false;
    getLeagueRosters(league.leagueId, date)
      .then((res) => {
        if (!stale) setDatedTeams(res.teams);
      })
      .catch(() => {
        if (!stale) setDatedTeams(null);
      });
    return () => {
      stale = true;
    };
  }, [league.leagueId, range, date, isToday]);

  // Fetch the selected team's scoring stats for the chosen window. Re-runs on team,
  // range, or (Today) date change; a stale flag prevents an earlier response from
  // overwriting a newer one.
  useEffect(() => {
    if (!teamId) return;
    let stale = false;
    setStatsLoading(true);
    setStats(null);
    const asOf = range === 'today' && !isToday ? date : undefined;
    getTeamRangeStats(league.leagueId, teamId, range, asOf)
      .then((res) => {
        if (!stale) setStats(res);
      })
      .catch(() => {
        if (!stale) setStats(null);
      })
      .finally(() => {
        if (!stale) setStatsLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [league.leagueId, teamId, range, date, isToday]);

  // Poll MLB games for lineup badges and the Today-view ticker. Historical days
  // are a single fetch; live today keeps the 30s poll.
  useEffect(() => {
    let stale = false;
    const load = () => {
      getMlbGames(date)
        .then((res) => {
          if (!stale) setGames(res.games);
        })
        .catch(() => {
          if (!stale) setGames([]);
        });
    };
    load();
    const shouldPoll = range === 'today' && isToday;
    const id = shouldPoll ? window.setInterval(load, TICKER_POLL_MS) : undefined;
    return () => {
      stale = true;
      if (id !== undefined) window.clearInterval(id);
    };
  }, [date, range, isToday]);

  const batterColumns = stats?.battingColumns ?? [];
  const pitcherColumns = stats?.pitchingColumns ?? [];

  const pitcherSlots = useMemo(
    () => (team?.slots ?? []).filter((slot) => isPitcherRosterSlot(slot)),
    [team?.slots],
  );
  const batterSlots = useMemo(
    () => (team?.slots ?? []).filter((slot) => !isPitcherRosterSlot(slot)),
    [team?.slots],
  );

  // playerId -> (statKey -> value) for quick per-cell lookup.
  const statsByPlayer = useMemo(() => {
    const map = new Map<string, Map<string, StatValue['value']>>();
    for (const row of stats?.players ?? []) {
      map.set(row.player.playerId, new Map(row.stats.map((s) => [s.key, s.value])));
    }
    return map;
  }, [stats]);

  // Normalized team abbr -> the game that team is playing in today.
  const gameByAbbr = useMemo(() => {
    const map = new Map<string, MlbGameState>();
    for (const g of games) {
      map.set(normalizeAbbr(g.homeAbbr), g);
      map.set(normalizeAbbr(g.awayAbbr), g);
    }
    return map;
  }, [games]);

  if (!team) {
    return (
      <section>
        <h1>Rosters</h1>
        <p className="muted">No teams found for this league yet.</p>
      </section>
    );
  }

  const showTicker = range === 'today';

  return (
    <section>
      <div className={styles.page__header}>
        <div>
          <h1>Rosters</h1>
          <EntityLabel
            label={league.name}
            className="muted"
            {...(league.logoUrl ? { imageUrl: league.logoUrl } : {})}
          />
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Team</span>
          <div className={styles.selectRow}>
            <EntityAvatar
              label={team.teamName}
              {...(team.logoUrl ? { imageUrl: team.logoUrl } : {})}
            />
            <select
              className={styles.select}
              value={team.teamId}
              onChange={(event) => selectTeam(event.target.value)}
            >
              {teams.map((t) => (
                <option key={t.teamId} value={t.teamId}>
                  {t.teamName}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <div className={styles.rosterToolbar}>
        {team.managerName && (
          <div className={styles.managerHeading}>
            <EntityAvatar
              label={team.managerName}
              {...(team.logoUrl ? { imageUrl: team.logoUrl } : {})}
            />
            <span className={styles.managerHeadingText}>
              <span className={styles.managerHeadingLabel}>Manager</span>
              <span className={styles.managerHeadingName}>{team.managerName}</span>
            </span>
          </div>
        )}

        <div className={styles.rosterFilters}>
          {showTicker && (
            <div className={styles.dateBar} role="group" aria-label="Roster date">
              <button
                type="button"
                className={styles.dateNav}
                onClick={() => setDate((d) => shiftDate(d, -1))}
                aria-label="Previous day"
              >
                ‹
              </button>
              <input
                type="date"
                className={styles.dateInput}
                value={date}
                max={today}
                onChange={(e) => e.target.value && setDate(e.target.value > today ? today : e.target.value)}
              />
              <button
                type="button"
                className={styles.dateNav}
                onClick={() => setDate((d) => {
                  const next = shiftDate(d, 1);
                  return next > today ? today : next;
                })}
                disabled={isToday}
                aria-label="Next day"
              >
                ›
              </button>
              <button
                type="button"
                className={styles.todayButton}
                onClick={() => setDate(today)}
                disabled={isToday}
              >
                Today
              </button>
            </div>
          )}
          <div className={styles.rangeToggle} role="group" aria-label="Stat range">
            {visibleRanges.map((r) => (
              <button
                key={r.value}
                type="button"
                className={r.value === range ? styles.rangeButtonActive : styles.rangeButton}
                aria-pressed={r.value === range}
                onClick={() => selectRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.tableStack}>
        <RosterTable
          title="Batters"
          slots={batterSlots}
          columns={batterColumns}
          statsByPlayer={statsByPlayer}
          statsLoading={statsLoading}
          showTicker={showTicker}
          gameByAbbr={gameByAbbr}
          date={date}
        />
        <RosterTable
          title="Pitchers"
          slots={pitcherSlots}
          columns={pitcherColumns}
          statsByPlayer={statsByPlayer}
          statsLoading={statsLoading}
          showTicker={showTicker}
          gameByAbbr={gameByAbbr}
          date={date}
          isPitcherTable
        />
      </div>
    </section>
  );
}

type RosterTableProps = {
  title: string;
  slots: RosterSlot[];
  columns: StatColumn[];
  statsByPlayer: Map<string, Map<string, StatValue['value']>>;
  statsLoading: boolean;
  showTicker: boolean;
  gameByAbbr: Map<string, MlbGameState>;
  date: string;
  isPitcherTable?: boolean;
};

function RosterTable({
  title,
  slots,
  columns,
  statsByPlayer,
  statsLoading,
  showTicker,
  gameByAbbr,
  date,
  isPitcherTable = false,
}: RosterTableProps) {
  const isNarrow = useIsNarrow();
  // Hide the live Game ticker on phones so scoring cols stay readable via H-scroll.
  const tickerVisible = showTicker && !isNarrow;
  // Phones fold Pos / MLB / Status into the Player cell footer and drop those
  // columns, handing their width to the scoring columns so more stats fit on screen.
  const metaCols = !isNarrow;
  const statShare = Math.max(columns.length, 1) * 6;
  const playerShare = 22;
  const gameShare = tickerVisible ? 24 : 0;
  const fixedShare = 6 + 7 + gameShare + 10; // pos, mlb, status (+ game if shown)
  const totalShare = playerShare + statShare + fixedShare;

  const totals = useMemo(
    () => computeRosterTotals(slots, columns, statsByPlayer),
    [slots, columns, statsByPlayer],
  );

  return (
    <div className={styles.tableCard}>
      <h2 className={styles.tableCardTitle}>{title}</h2>
      <div className={styles.tableRosterWrap}>
        <table className={`${styles.table} ${styles.tableRoster}`}>
          <colgroup>
            {metaCols && <col style={{ width: `${(6 / totalShare) * 100}%` }} />}
            <col style={{ width: `${(playerShare / totalShare) * 100}%` }} />
            {metaCols && <col style={{ width: `${(7 / totalShare) * 100}%` }} />}
            {tickerVisible && <col style={{ width: `${(gameShare / totalShare) * 100}%` }} />}
            {columns.map((col) => (
              <col key={col.key} style={{ width: `${(6 / totalShare) * 100}%` }} />
            ))}
            {metaCols && <col style={{ width: `${(10 / totalShare) * 100}%` }} />}
          </colgroup>
          <thead>
            <tr>
              {metaCols && <th className={styles.stickyPos}>Pos</th>}
              <th className={metaCols ? styles.stickyPlayer : styles.stickyPlayerLead}>Player</th>
              {metaCols && <th>MLB</th>}
              {tickerVisible && <th>Game</th>}
              {columns.map((col) => (
                <th key={col.key} className={styles.num} title={col.description}>
                  {col.label}
                </th>
              ))}
              {metaCols && <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => {
              const playerStats = statsByPlayer.get(slot.player.playerId);
              const abbr = slot.player.mlbTeamAbbr;
              const game = abbr ? gameByAbbr.get(normalizeAbbr(abbr)) : undefined;
              const rowClass = rosterRowClass(slot.selectedPosition);
              return (
                <tr key={slot.player.playerId} className={rowClass}>
                  {metaCols && (
                    <td className={styles.stickyPos}>
                      <span className={styles.posBadge}>{slot.selectedPosition}</span>
                    </td>
                  )}
                  <td
                    className={`${styles.playerCell} ${metaCols ? styles.stickyPlayer : styles.stickyPlayerLead}`}
                    title={slot.player.fullName}
                  >
                    <span className={styles.playerCellInner}>
                      <PlayerAvatar
                        fullName={slot.player.fullName}
                        headshotUrl={slot.player.headshotUrl}
                      />
                      <span className={styles.playerIdentity}>
                        <span className={styles.playerName}>
                          <PlayerNameButton
                            target={{
                              playerId: slot.player.playerId,
                              fullName: slot.player.fullName,
                              ...(slot.player.mlbTeamAbbr
                                ? { mlbTeamAbbr: slot.player.mlbTeamAbbr }
                                : {}),
                              ...(slot.player.positionType
                                ? { positionType: slot.player.positionType }
                                : {}),
                              ...(slot.player.headshotUrl
                                ? { headshotUrl: slot.player.headshotUrl }
                                : {}),
                            }}
                          />
                        </span>
                        {!metaCols && (
                          <PlayerMetaFooter
                            items={[
                              <span className={styles.posBadge}>{slot.selectedPosition}</span>,
                              abbr,
                              slot.player.status ? (
                                <span className={styles.statusBadge}>{slot.player.status}</span>
                              ) : null,
                            ]}
                          />
                        )}
                      </span>
                    </span>
                  </td>
                  {metaCols && <td className="muted">{abbr ?? '-'}</td>}
                  {tickerVisible && (
                    <td className={styles.gameCell}>
                      <span className={styles.gameCellInner}>
                        <GameDayBadge
                          game={game}
                          teamAbbr={abbr}
                          fullName={slot.player.fullName}
                          isPitcher={isPitcherTable}
                        />
                        <span className={styles.gameTickerText}>
                          <Ticker game={game} teamAbbr={abbr} date={date} />
                        </span>
                      </span>
                    </td>
                  )}
                  {columns.map((col) => {
                    const value = playerStats?.get(col.key);
                    return (
                      <td key={col.key} className={styles.num}>
                        {value ?? (statsLoading ? '…' : '-')}
                      </td>
                    );
                  })}
                  {metaCols && (
                    <td>
                      {slot.player.status ? (
                        <span className={styles.statusBadge}>{slot.player.status}</span>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {slots.length > 0 && (
            <tfoot>
              <tr className={styles.totalsRow}>
                <td
                  colSpan={metaCols ? 2 : 1}
                  className={`${styles.totalsLabel} ${metaCols ? styles.stickyPos : styles.stickyPlayerLead}`}
                >
                  Total
                </td>
                {metaCols && <td />}
                {tickerVisible && <td />}
                {columns.map((col) => (
                  <td key={col.key} className={styles.num}>
                    {statsLoading ? '…' : totals.get(col.key)}
                  </td>
                ))}
                {metaCols && <td />}
              </tr>
            </tfoot>
          )}
        </table>
        {slots.length === 0 && <p className="muted">No {title.toLowerCase()} on this roster.</p>}
      </div>
    </div>
  );
}

/** Green badge (left of Game column): checkmark for starters, batting-order slot for hitters. */
function GameDayBadge({
  game,
  teamAbbr,
  fullName,
  isPitcher,
}: {
  game?: MlbGameState;
  teamAbbr?: string;
  fullName: string;
  isPitcher: boolean;
}) {
  let badge: ReactNode = null;

  if (game && teamAbbr) {
    const key = playerGameKey(teamAbbr, fullName);

    if (isPitcher && game.probablePitchers?.includes(key)) {
      badge = (
        <span
          className={styles.gameDayBadge}
          title="Starting pitcher"
          aria-label="Starting pitcher"
        >
          ✓
        </span>
      );
    } else if (!isPitcher) {
      const slot = game.battingOrder?.[key];
      if (slot) {
        badge = (
          <span
            className={styles.gameDayBadge}
            title={`Batting ${slot}`}
            aria-label={`Batting ${slot}`}
          >
            {slot}
          </span>
        );
      }
    }
  }

  // Fixed-width slot on every row so ticker text stays left-aligned.
  return <span className={styles.gameDayBadgeSlot}>{badge}</span>;
}

/** One player's live game cell: score + inning when live, else start time / Final. */
function Ticker({
  game,
  teamAbbr,
  date,
}: {
  game?: MlbGameState;
  teamAbbr?: string;
  date: string;
}) {
  const line = teamAbbr ? formatMlbGameLine(game) : null;
  if (!line || !game) {
    return <span className="muted">-</span>;
  }
  const params = new URLSearchParams({ game: String(game.gamePk) });
  if (date !== easternToday()) params.set('date', date);
  return (
    <Link
      to={`/scores?${params.toString()}`}
      className={`${styles.tickerLink} ${line.live ? styles.tickerLive : styles.tickerMuted}`}
      title="Open in MLB Scores"
    >
      {line.text}
    </Link>
  );
}
