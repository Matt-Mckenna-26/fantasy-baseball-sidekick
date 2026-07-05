import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  LeagueMatchupsResponse,
  LeagueStandingsResponse,
  LeagueSummary,
  LeagueTeamStatsResponse,
  StandingsRow,
} from '@fcm/contracts';
import { getLeagueMatchups, getLeagueStandings, getLeagueTeamStats } from '../api/client';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { MatchupCarousel } from '../components/MatchupCarousel';
import {
  computeLiveStandings,
  computeStandingsMovers,
  formatMoverBlurb,
  pickStandingsMoverHighlights,
  type StandingsMover,
} from '../lib/liveStandings';
import { pickWeekStatLeaders, type StatLeaderTile, type StatLeaderTone } from '../lib/statLeaders';
import tableStyles from '../components/dataTable.module.css';
import styles from './StandingsPage.module.css';

/** Random category tiles to show per tone (hot best-in-cat + cold worst-in-cat). */
const LEADER_PER_TONE = 3;

type LiveStandingsData = {
  standings: LeagueStandingsResponse;
  matchups: LeagueMatchupsResponse;
};

/** Fetch season standings and the current-week scoreboard together (stable ref for the hook). */
function loadLiveStandings(leagueId: string): Promise<LiveStandingsData> {
  return Promise.all([getLeagueStandings(leagueId), getLeagueMatchups(leagueId)]).then(
    ([standings, matchups]) => ({ standings, matchups }),
  );
}

export function StandingsPage() {
  const state = useFirstLeagueResource(loadLiveStandings);

  if (state.status !== 'ready') {
    return <LeagueResourceNotice status={state.status} />;
  }
  return <StandingsView data={state.data} league={state.league} />;
}

/** Render an optional numeric standings value, falling back to a muted dash. */
function numCell(value: number | undefined) {
  return value ?? '-';
}

/**
 * Merge W-L-T into a single record string for the standings-if-the-week-ended-now
 * view. Ties are omitted only when the league never records them.
 */
function formatRecord(row: StandingsRow): string {
  if (row.wins == null && row.losses == null && row.ties == null) return '-';
  const wins = row.wins ?? 0;
  const losses = row.losses ?? 0;
  const ties = row.ties ?? 0;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

function StandingsView({ data, league }: { data: LiveStandingsData; league: LeagueSummary }) {
  const navigate = useNavigate();
  const liveMatchups = data.matchups.matchups.filter((m) => m.status === 'midevent');
  const baselineRows = data.standings.teams;
  const rows = computeLiveStandings(baselineRows, data.matchups.matchups);
  const movers = computeStandingsMovers(baselineRows, rows);
  const highlights = pickStandingsMoverHighlights(movers);
  const showMovers = liveMatchups.length > 0 && (highlights.hot ?? highlights.cold);

  // The category tiles are supplemental, so fetch this week's team totals
  // separately from the standings/scoreboard and let them fill in progressively.
  // A skeleton reserves their space while loading to avoid a layout shift.
  const week = data.matchups.week;
  const [weekStats, setWeekStats] = useState<LeagueTeamStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    getLeagueTeamStats(league.leagueId, week, { silent: true })
      .then((res) => {
        if (!cancelled) setWeekStats(res);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [league.leagueId, week]);

  const tiles = useMemo(
    () => (weekStats ? pickWeekStatLeaders(weekStats, LEADER_PER_TONE) : []),
    [weekStats],
  );

  return (
    <section>
      <div className={tableStyles.page__header}>
        <div>
          <h1>Live Standings</h1>
          <EntityLabel
            label={league.name}
            className="muted"
            {...(league.logoUrl ? { imageUrl: league.logoUrl } : {})}
          />
        </div>
      </div>

      {liveMatchups.length > 0 && (
        <MatchupCarousel
          week={data.matchups.week}
          matchups={liveMatchups}
          onSelectMatchup={(matchup) => {
            const teamId = matchup.teams[0]?.teamId;
            navigate(teamId ? `/matchups?team=${encodeURIComponent(teamId)}` : '/matchups');
          }}
        />
      )}

      {statsLoading ? (
        <StatLeadersSkeleton />
      ) : (
        tiles.length > 0 && <StatLeadersBoard week={week} tiles={tiles} />
      )}

      {showMovers && <StandingsMoversCard highlights={highlights} />}

      <div className={tableStyles.tableCard}>
        <div className={tableStyles.tableScroll}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th className={tableStyles.num}>Rank</th>
                <th>Team</th>
                <th className={tableStyles.num} title="Season record incl. the live week (W-L-T)">
                  Record
                </th>
                <th className={tableStyles.num}>Win%</th>
                <th className={tableStyles.num}>GB</th>
                <th className={tableStyles.num} title="Roster moves this season">
                  Moves
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <StandingsTableRow key={row.teamId} row={row} />
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="muted">No standings available for this league.</p>}
      </div>
    </section>
  );
}

const TONE_META: Record<StatLeaderTone, { icon: string; groupLabel: string; word: string }> = {
  hot: { icon: '🔥', groupLabel: 'Leading the league', word: 'Best' },
  cold: { icon: '❄️', groupLabel: 'Trailing the pack', word: 'Worst' },
};

/** Grouped "best/worst in category this week" tiles above the standings. */
function StatLeadersBoard({ week, tiles }: { week: number; tiles: StatLeaderTile[] }) {
  const groups: StatLeaderTone[] = ['hot', 'cold'];
  return (
    <div className={styles.leaders}>
      <div className={styles.leadersHeader}>Week {week} category watch</div>
      {groups.map((tone) => {
        const group = tiles.filter((t) => t.tone === tone);
        if (group.length === 0) return null;
        return (
          <div key={tone} className={styles.leaderGroup}>
            <div className={styles.leaderGroupLabel}>
              <span aria-hidden="true">{TONE_META[tone].icon}</span>
              {TONE_META[tone].groupLabel}
            </div>
            <div
              className={styles.leadersGrid}
              style={{ gridTemplateColumns: `repeat(${group.length}, minmax(0, 1fr))` }}
            >
              {group.map((tile) => (
                <LeaderTile key={`${tone}-${tile.statKey}`} tile={tile} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeaderTile({ tile }: { tile: StatLeaderTile }) {
  const meta = TONE_META[tile.tone];
  const toneClass = tile.tone === 'hot' ? styles.leaderCardHot : styles.leaderCardCold;
  return (
    <div className={`${styles.leaderCard} ${toneClass}`}>
      <div className={styles.leaderEyebrow}>
        <span className={styles.srOnly}>{meta.word} in category: </span>
        <span className={styles.leaderToneIcon} aria-hidden="true">
          {meta.icon}
        </span>
        <span
          className={styles.leaderStat}
          {...(tile.statDescription ? { title: tile.statDescription } : {})}
        >
          {tile.statLabel}
        </span>
      </div>
      <div className={styles.leaderValue}>{tile.value}</div>
      <div className={styles.leaderTeam} title={tile.teamName}>
        <span className={styles.leaderTeamName}>{tile.teamName}</span>
        <EntityAvatar
          label={tile.teamName}
          className={styles.leaderAvatar}
          {...(tile.logoUrl ? { imageUrl: tile.logoUrl } : {})}
        />
      </div>
    </div>
  );
}

/** Placeholder that mirrors the board's footprint so real tiles don't shift layout. */
function StatLeadersSkeleton() {
  const groups: StatLeaderTone[] = ['hot', 'cold'];
  return (
    <div className={styles.leaders} aria-hidden="true">
      <div className={`${styles.leadersHeader} ${styles.skeletonHeader}`} />
      {groups.map((tone) => (
        <div key={tone} className={styles.leaderGroup}>
          <div className={`${styles.leaderGroupLabel} ${styles.skeletonGroupLabel}`} />
          <div
            className={styles.leadersGrid}
            style={{ gridTemplateColumns: `repeat(${LEADER_PER_TONE}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: LEADER_PER_TONE }, (_, i) => (
              <div key={i} className={`${styles.leaderCard} ${styles.leaderCardSkeleton}`}>
                <div className={`${styles.skeletonLine} ${styles.skeletonStat}`} />
                <div className={`${styles.skeletonLine} ${styles.skeletonValue}`} />
                <div className={`${styles.skeletonLine} ${styles.skeletonTeam}`} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Card summarizing the biggest projected rank climbers and fallers this week. */
function StandingsMoversCard({
  highlights,
}: {
  highlights: { hot: StandingsMover | null; cold: StandingsMover | null };
}) {
  const { hot, cold } = highlights;
  if (!hot && !cold) return null;

  return (
    <div className={styles.movers}>
      <div className={styles.moversHeader}>Biggest movers</div>
      <div className={styles.moversBody}>
        {hot && <MoverLine mover={hot} tone="hot" />}
        {cold && <MoverLine mover={cold} tone="cold" />}
      </div>
    </div>
  );
}

function MoverLine({ mover, tone }: { mover: StandingsMover; tone: 'hot' | 'cold' }) {
  const toneClass = tone === 'hot' ? styles.moverHot : styles.moverCold;
  const icon = tone === 'hot' ? '🔥' : '❄️';
  const label = tone === 'hot' ? 'Rising' : 'Falling';

  return (
    <p className={`${styles.moverLine} ${toneClass}`} aria-label={`${label}: ${mover.teamName}`}>
      <span className={styles.moverIcon} aria-hidden="true">
        {icon}
      </span>
      <InlineTeam mover={mover} />
      <span>{formatMoverBlurb(mover, tone)}</span>
    </p>
  );
}

/** Team avatar + name embedded inline in mover copy. */
function InlineTeam({ mover }: { mover: StandingsMover }) {
  return (
    <span className={styles.inlineTeam}>
      <EntityAvatar
        label={mover.teamName}
        className={styles.inlineTeamAvatar}
        {...(mover.logoUrl ? { imageUrl: mover.logoUrl } : {})}
      />
      <span className={styles.inlineTeamName}>{mover.teamName}</span>
    </span>
  );
}

function StandingsTableRow({ row }: { row: StandingsRow }) {
  return (
    <tr>
      <td className={tableStyles.num}>
        {row.rank != null ? <span className={tableStyles.posBadge}>{row.rank}</span> : '-'}
      </td>
      <td title={row.managerName ?? row.teamName}>
        <span className={tableStyles.playerCellInner}>
          <EntityAvatar label={row.teamName} {...(row.logoUrl ? { imageUrl: row.logoUrl } : {})} />
          <span className={tableStyles.playerName}>{row.teamName}</span>
        </span>
      </td>
      <td className={tableStyles.num}>{formatRecord(row)}</td>
      <td className={tableStyles.num}>{row.winPercentage ?? '-'}</td>
      <td className={tableStyles.num}>{row.gamesBack ?? '-'}</td>
      <td className={tableStyles.num}>{numCell(row.moves)}</td>
    </tr>
  );
}
