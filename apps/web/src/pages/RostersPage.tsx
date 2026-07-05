import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  LeagueRostersResponse,
  LeagueSummary,
  MlbGameState,
  RosterSlot,
  StatColumn,
  StatRange,
  StatValue,
  TeamStatsResponse,
} from '@fcm/contracts';
import { isPitcherRosterSlot, normalizeTeamAbbr, playerGameKey } from '@fcm/contracts';
import { getLeagueRosters, getMlbGames, getTeamRangeStats } from '../api/client';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { computeRosterTotals } from '../lib/rosterTotals';
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

function rosterRowClass(selectedPosition: string): string | undefined {
  if (selectedPosition === 'BN') return styles.benchRow;
  if (selectedPosition === 'IL' || selectedPosition.startsWith('IL')) return styles.injuredRow;
  return undefined;
}

function RostersView({ data, league }: { data: LeagueRostersResponse; league: LeagueSummary }) {
  const [selectedTeamId, setSelectedTeamId] = useState(data.teams[0]?.teamId ?? '');
  const [range, setRange] = useState<StatRange>('today');
  const [stats, setStats] = useState<TeamStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [games, setGames] = useState<MlbGameState[]>([]);

  const team = data.teams.find((t) => t.teamId === selectedTeamId) ?? data.teams[0];
  const teamId = team?.teamId ?? '';

  // Fetch the selected team's scoring stats for the chosen window. Re-runs on team or
  // range change; a stale flag prevents an earlier response from overwriting a newer one.
  useEffect(() => {
    if (!teamId) return;
    let stale = false;
    setStatsLoading(true);
    setStats(null);
    getTeamRangeStats(league.leagueId, teamId, range)
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
  }, [league.leagueId, teamId, range]);

  // Poll today's MLB games for lineup badges and the Today-view ticker.
  useEffect(() => {
    let stale = false;
    const load = () => {
      getMlbGames(easternToday())
        .then((res) => {
          if (!stale) setGames(res.games);
        })
        .catch(() => {
          if (!stale) setGames([]);
        });
    };
    load();
    const id = window.setInterval(load, TICKER_POLL_MS);
    return () => {
      stale = true;
      window.clearInterval(id);
    };
  }, []);

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
              onChange={(event) => setSelectedTeamId(event.target.value)}
            >
              {data.teams.map((t) => (
                <option key={t.teamId} value={t.teamId}>
                  {t.teamName}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <div className={styles.rangeToggle} role="group" aria-label="Stat range">
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            className={r.value === range ? styles.rangeButtonActive : styles.rangeButton}
            aria-pressed={r.value === range}
            onClick={() => setRange(r.value)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {team.managerName && (
        <p className="muted">
          <span className={styles.entityLabel}>
            <EntityAvatar
              label={team.managerName}
              {...(team.logoUrl ? { imageUrl: team.logoUrl } : {})}
            />
            <span>Manager: {team.managerName}</span>
          </span>
        </p>
      )}

      <div className={styles.tableStack}>
        <RosterTable
          title="Batters"
          slots={batterSlots}
          columns={batterColumns}
          statsByPlayer={statsByPlayer}
          statsLoading={statsLoading}
          showTicker={showTicker}
          gameByAbbr={gameByAbbr}
        />
        <RosterTable
          title="Pitchers"
          slots={pitcherSlots}
          columns={pitcherColumns}
          statsByPlayer={statsByPlayer}
          statsLoading={statsLoading}
          showTicker={showTicker}
          gameByAbbr={gameByAbbr}
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
  isPitcherTable = false,
}: RosterTableProps) {
  const statShare = Math.max(columns.length, 1) * 6;
  const playerShare = 22;
  const gameShare = showTicker ? 24 : 0;
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
            <col style={{ width: `${(6 / totalShare) * 100}%` }} />
            <col style={{ width: `${(playerShare / totalShare) * 100}%` }} />
            <col style={{ width: `${(7 / totalShare) * 100}%` }} />
            {showTicker && <col style={{ width: `${(gameShare / totalShare) * 100}%` }} />}
            {columns.map((col) => (
              <col key={col.key} style={{ width: `${(6 / totalShare) * 100}%` }} />
            ))}
            <col style={{ width: `${(10 / totalShare) * 100}%` }} />
          </colgroup>
          <thead>
            <tr>
              <th>Pos</th>
              <th>Player</th>
              <th>MLB</th>
              {showTicker && <th>Game</th>}
              {columns.map((col) => (
                <th key={col.key} className={styles.num} title={col.description}>
                  {col.label}
                </th>
              ))}
              <th>Status</th>
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
                  <td>
                    <span className={styles.posBadge}>{slot.selectedPosition}</span>
                  </td>
                  <td className={styles.playerCell} title={slot.player.fullName}>
                    <span className={styles.playerCellInner}>
                      <PlayerAvatar
                        fullName={slot.player.fullName}
                        headshotUrl={slot.player.headshotUrl}
                      />
                      <span className={styles.playerName}>{slot.player.fullName}</span>
                    </span>
                  </td>
                  <td className="muted">{abbr ?? '-'}</td>
                  {showTicker && (
                    <td className={styles.gameCell}>
                      <span className={styles.gameCellInner}>
                        <GameDayBadge
                          game={game}
                          teamAbbr={abbr}
                          fullName={slot.player.fullName}
                          isPitcher={isPitcherTable}
                        />
                        <span className={styles.gameTickerText}>
                          <Ticker game={game} teamAbbr={abbr} />
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
                  <td>
                    {slot.player.status ? (
                      <span className={styles.statusBadge}>{slot.player.status}</span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {slots.length > 0 && (
            <tfoot>
              <tr className={styles.totalsRow}>
                <td colSpan={2} className={styles.totalsLabel}>
                  Total
                </td>
                <td />
                {showTicker && <td />}
                {columns.map((col) => (
                  <td key={col.key} className={styles.num}>
                    {statsLoading ? '…' : totals.get(col.key)}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        {slots.length === 0 && (
          <p className="muted">No {title.toLowerCase()} on this roster.</p>
        )}
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
        <span className={styles.gameDayBadge} title="Starting pitcher" aria-label="Starting pitcher">
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
function Ticker({ game, teamAbbr }: { game?: MlbGameState; teamAbbr?: string }) {
  if (!game || !teamAbbr) {
    return <span className="muted">-</span>;
  }
  const score =
    game.homeScore !== undefined && game.awayScore !== undefined
      ? `${game.awayAbbr} ${game.awayScore}-${game.homeScore} ${game.homeAbbr}`
      : `${game.awayAbbr} @ ${game.homeAbbr}`;

  if (game.state === 'live') {
    const half = [game.inningState, game.inning].filter(Boolean).join(' ');
    return (
      <span className={styles.tickerLive}>
        {half ? `${half} · ` : ''}
        {score}
      </span>
    );
  }
  if (game.state === 'final') {
    return <span className={styles.tickerMuted}>Final · {score}</span>;
  }
  const time = game.startTime
    ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'Scheduled';
  return (
    <span className={styles.tickerMuted}>
      {time} · {score}
    </span>
  );
}
