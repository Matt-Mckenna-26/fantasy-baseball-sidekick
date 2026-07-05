import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  LeagueMatchupsResponse,
  LeagueSummary,
  LeagueTeamStatsResponse,
  Matchup,
  Player,
  StatColumn,
  StatValue,
  TeamWeekStatsResponse,
} from '@fcm/contracts';
import { inferPlayerPositionType } from '@fcm/contracts';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { themeQuartz, type ColDef, type GetRowIdParams, type GridApi } from 'ag-grid-community';
import { getLeagueMatchups, getLeagueTeamStats, getTeamWeekStats } from '../api/client';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { MatchupCarousel } from '../components/MatchupCarousel';
import { PercentileHeatCell, type StatCellContext } from '../components/PercentileHeatCell';
import { StatsGridHelp } from '../components/StatsGridHelp';
import { buildStatPercentiles } from '../lib/percentile';
import { toNumericValue } from '../lib/teamTrend';
import styles from '../components/dataTable.module.css';
import gridStyles from './StatsPage.module.css';
import pageStyles from './MatchupsPage.module.css';

type MatchupsData = {
  matchups: LeagueMatchupsResponse;
  teamStats: LeagueTeamStatsResponse | null;
};

/** Load the current-week scoreboard plus every team's category totals for that week. */
function loadMatchupsData(leagueId: string): Promise<MatchupsData> {
  return getLeagueMatchups(leagueId).then(async (matchups) => {
    if (matchups.matchups.length === 0 || matchups.week < 1) {
      return { matchups, teamStats: null };
    }
    const teamStats = await getLeagueTeamStats(leagueId, matchups.week, { silent: true });
    return { matchups, teamStats };
  });
}

/** Dark ag-grid theme tuned to the app's design tokens (shared look with Stats pages). */
const gridTheme = themeQuartz.withParams({
  backgroundColor: '#1e293b',
  foregroundColor: '#e2e8f0',
  headerTextColor: '#94a3b8',
  headerBackgroundColor: '#1e293b',
  borderColor: '#334155',
  chromeBackgroundColor: '#1e293b',
  oddRowBackgroundColor: 'rgba(148, 163, 184, 0.04)',
  rowHoverColor: 'rgba(148, 163, 184, 0.08)',
  accentColor: '#7c3aed',
  fontFamily: 'inherit',
});

export function MatchupsPage() {
  const state = useFirstLeagueResource(loadMatchupsData);

  if (state.status !== 'ready') {
    return <LeagueResourceNotice status={state.status} />;
  }
  return <MatchupsView data={state.data} league={state.league} />;
}

/** True when the player is a pitcher (explicit type, else inferred from eligibility). */
function isPitcherPlayer(player: Player): boolean {
  if (player.positionType === 'P') return true;
  if (player.positionType === 'B') return false;
  return inferPlayerPositionType({ eligiblePositions: player.eligiblePositions }) === 'P';
}

/**
 * Pick the team whose matchup should be focused first: an explicit `?team=` deep
 * link wins, then the signed-in user's team (matched by name), then the first
 * matchup. Returns a teamId that identifies the matchup to select.
 */
function resolveInitialTeamId(
  matchups: Matchup[],
  paramTeam: string | null,
  userTeamName: string | undefined,
): string | undefined {
  if (paramTeam && matchups.some((m) => m.teams.some((t) => t.teamId === paramTeam))) {
    return paramTeam;
  }
  if (userTeamName) {
    for (const m of matchups) {
      const mine = m.teams.find((t) => t.teamName === userTeamName);
      if (mine) return mine.teamId;
    }
  }
  return matchups[0]?.teams[0]?.teamId;
}

type Tab = 'batting' | 'pitching';

/** Flat per-player grid row: fixed meta fields plus one value per stat column. */
type PlayerRow = Record<string, string | number | null>;

/** Join truthy class tokens (CSS-module lookups may be undefined). */
function cx(parts: Array<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ');
}

function MatchupsView({ data, league }: { data: MatchupsData; league: LeagueSummary }) {
  const matchups = data.matchups.matchups;
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTeam = searchParams.get('team');

  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(() =>
    resolveInitialTeamId(matchups, paramTeam, league.teamName),
  );

  // Keep selection in sync when the deep-link param changes (e.g. arriving from Standings).
  useEffect(() => {
    if (paramTeam && matchups.some((m) => m.teams.some((t) => t.teamId === paramTeam))) {
      setSelectedTeamId(paramTeam);
    }
  }, [paramTeam, matchups]);

  const selectedMatchup = useMemo(
    () =>
      matchups.find((m) => m.teams.some((t) => t.teamId === selectedTeamId)) ?? matchups[0],
    [matchups, selectedTeamId],
  );

  const [tab, setTab] = useState<Tab>('batting');
  const [weekStatsByTeam, setWeekStatsByTeam] = useState<Map<string, TeamWeekStatsResponse>>(
    new Map(),
  );
  const [playersLoading, setPlayersLoading] = useState(false);

  // Fetch (and cache by teamId) the fantasy-week player stats for the selected matchup.
  useEffect(() => {
    if (!selectedMatchup) return;
    const ids = selectedMatchup.teams.map((t) => t.teamId);
    const missing = ids.filter((id) => !weekStatsByTeam.has(id));
    if (missing.length === 0) return;
    let stale = false;
    setPlayersLoading(true);
    Promise.all(
      missing.map((id) => getTeamWeekStats(league.leagueId, id, selectedMatchup.week, { silent: true })),
    )
      .then((results) => {
        if (stale) return;
        setWeekStatsByTeam((prev) => {
          const next = new Map(prev);
          for (const r of results) next.set(r.teamId, r);
          return next;
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!stale) setPlayersLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [league.leagueId, selectedMatchup, weekStatsByTeam]);

  const handleSelect = (matchup: Matchup) => {
    const teamId = matchup.teams[0]?.teamId;
    if (!teamId) return;
    setSelectedTeamId(teamId);
    setSearchParams({ team: teamId }, { replace: true });
  };

  if (matchups.length === 0) {
    return (
      <section>
        <PageHeader league={league} />
        <p className={pageStyles.emptyNotice}>
          This league has no head-to-head matchups for the current week.
        </p>
      </section>
    );
  }

  return (
    <section>
      <PageHeader league={league} />

      <MatchupCarousel
        week={data.matchups.week}
        matchups={matchups}
        {...(selectedTeamId ? { selectedTeamId } : {})}
        onSelectMatchup={handleSelect}
      />

      {selectedMatchup && (
        <>
          <CategoryScoreGrid matchup={selectedMatchup} teamStats={data.teamStats} />
          <PlayerStatsGrid
            matchup={selectedMatchup}
            weekStatsByTeam={weekStatsByTeam}
            tab={tab}
            onTabChange={setTab}
            loading={playersLoading}
          />
        </>
      )}
    </section>
  );
}

function PageHeader({ league }: { league: LeagueSummary }) {
  return (
    <div className={styles.page__header}>
      <div>
        <h1>Matchups</h1>
        <EntityLabel
          label={league.name}
          className="muted"
          {...(league.logoUrl ? { imageUrl: league.logoUrl } : {})}
        />
      </div>
    </div>
  );
}

/** Headline scoreboard for the selected matchup: both teams, avatars, category win totals. */
function MatchupScoreBanner({ matchup }: { matchup: Matchup }) {
  const [home, away] = matchup.teams;
  const homeLeads = home && away ? home.categoriesWon > away.categoriesWon : false;
  const awayLeads = home && away ? away.categoriesWon > home.categoriesWon : false;

  return (
    <div className={pageStyles.scoreBanner} aria-label="Matchup score">
      {home ? (
        <MatchupBannerSide team={home} align="start" leading={homeLeads} />
      ) : (
        <span />
      )}
      <div className={pageStyles.scoreBannerCenter}>
        <span
          className={cx([
            pageStyles.scoreBannerTotal,
            homeLeads ? pageStyles.scoreBannerTotalLeading : undefined,
          ])}
        >
          {home?.categoriesWon ?? 0}
        </span>
        <span className={pageStyles.scoreBannerVs}>–</span>
        <span
          className={cx([
            pageStyles.scoreBannerTotal,
            awayLeads ? pageStyles.scoreBannerTotalLeading : undefined,
          ])}
        >
          {away?.categoriesWon ?? 0}
        </span>
      </div>
      {away ? (
        <MatchupBannerSide team={away} align="end" leading={awayLeads} />
      ) : (
        <span />
      )}
    </div>
  );
}

function MatchupBannerSide({
  team,
  align,
  leading,
}: {
  team: Matchup['teams'][number];
  align: 'start' | 'end';
  leading: boolean;
}) {
  return (
    <div
      className={cx([
        pageStyles.scoreBannerSide,
        align === 'end' ? pageStyles.scoreBannerSideEnd : undefined,
        leading ? pageStyles.scoreBannerSideLeading : undefined,
      ])}
    >
      <EntityAvatar label={team.teamName} {...(team.logoUrl ? { imageUrl: team.logoUrl } : {})} />
      <span className={pageStyles.scoreBannerTeamName} title={team.teamName}>
        {team.teamName}
      </span>
    </div>
  );
}

/**
 * Two-row grid (a row per team) of each scoring category's value for the week, with
 * the winning team's cell highlighted per Yahoo's authoritative stat winners.
 */
function CategoryScoreGrid({
  matchup,
  teamStats,
}: {
  matchup: Matchup;
  teamStats: LeagueTeamStatsResponse | null;
}) {
  const columns: StatColumn[] = teamStats
    ? [...teamStats.battingColumns, ...teamStats.pitchingColumns]
    : [];
  const battingCount = teamStats?.battingColumns.length ?? 0;

  // teamId -> (statKey -> value) for the two teams in this matchup.
  const valuesByTeam = useMemo(() => {
    const map = new Map<string, Map<string, StatValue['value']>>();
    for (const team of teamStats?.teams ?? []) {
      map.set(team.teamId, new Map(team.stats.map((s) => [s.key, s.value])));
    }
    return map;
  }, [teamStats]);

  // statKey -> winner info from Yahoo's per-category results.
  const winnerByStat = useMemo(() => {
    const map = new Map<string, { winnerTeamId?: string; isTied?: boolean }>();
    for (const w of matchup.statWinners ?? []) {
      map.set(w.statKey, {
        ...(w.winnerTeamId ? { winnerTeamId: w.winnerTeamId } : {}),
        ...(w.isTied ? { isTied: true } : {}),
      });
    }
    return map;
  }, [matchup.statWinners]);

  if (!teamStats || columns.length === 0) {
    return (
      <div className={pageStyles.scoreCard}>
        <p className={pageStyles.emptyNotice}>Category totals are unavailable for this week.</p>
      </div>
    );
  }

  const isDivider = (i: number): boolean => i === battingCount && battingCount > 0;

  const cellClassFor = (statKey: string, teamId: string, divider: boolean): string => {
    const winner = winnerByStat.get(statKey);
    const parts = [pageStyles.statCell];
    if (winner?.isTied) parts.push(pageStyles.tiedCell);
    else if (winner?.winnerTeamId === teamId) parts.push(pageStyles.winnerCell);
    if (divider) parts.push(pageStyles.groupDivider);
    return cx(parts);
  };

  return (
    <div className={pageStyles.scoreCard}>
      <MatchupScoreBanner matchup={matchup} />
      <h2 className={pageStyles.sectionTitle}>Category scoreboard</h2>
      <div className={pageStyles.scoreScroll}>
        <table className={pageStyles.scoreTable}>
          <thead>
            <tr>
              <th className={pageStyles.teamCol}>Team</th>
              {columns.map((col, i) => (
                <th
                  key={col.key}
                  className={isDivider(i) ? cx([pageStyles.groupDivider]) : undefined}
                  {...(col.description ? { title: col.description } : {})}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matchup.teams.map((team) => {
              const values = valuesByTeam.get(team.teamId);
              return (
                <tr key={team.teamId}>
                  <td className={pageStyles.teamCol}>
                    <span className={pageStyles.teamCell}>
                      <EntityAvatar
                        label={team.teamName}
                        {...(team.logoUrl ? { imageUrl: team.logoUrl } : {})}
                      />
                      <span className={pageStyles.teamCellName} title={team.teamName}>
                        {team.teamName}
                      </span>
                    </span>
                  </td>
                  {columns.map((col, i) => (
                    <td key={col.key} className={cellClassFor(col.key, team.teamId, isDivider(i))}>
                      {values?.get(col.key) ?? '-'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Combined pitchers/hitters grid of both teams' players with this week's stats. */
function PlayerStatsGrid({
  matchup,
  weekStatsByTeam,
  tab,
  onTabChange,
  loading,
}: {
  matchup: Matchup;
  weekStatsByTeam: Map<string, TeamWeekStatsResponse>;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  loading: boolean;
}) {
  const responses = matchup.teams
    .map((t) => weekStatsByTeam.get(t.teamId))
    .filter((r): r is TeamWeekStatsResponse => Boolean(r));

  const columns = useMemo<StatColumn[]>(() => {
    const first = responses[0];
    if (!first) return [];
    const raw = tab === 'batting' ? first.battingColumns : first.pitchingColumns;
    // H/AB is a display-only ratio, not a category we rank in the grid.
    return raw.filter((c) => c.label.trim().toUpperCase() !== 'H/AB');
  }, [responses, tab]);

  const teamNameById = useMemo(
    () => new Map(matchup.teams.map((t) => [t.teamId, t.teamName])),
    [matchup.teams],
  );

  const rows = useMemo<PlayerRow[]>(() => {
    const out: PlayerRow[] = [];
    for (const resp of responses) {
      for (const line of resp.players) {
        const pitcher = isPitcherPlayer(line.player);
        if ((tab === 'pitching') !== pitcher) continue;
        const byKey = new Map(line.stats.map((s) => [s.key, s.value]));
        const row: PlayerRow = {
          rowId: `${resp.teamId}:${line.player.playerId}`,
          teamName: teamNameById.get(resp.teamId) ?? resp.teamId,
          playerId: line.player.playerId,
          fullName: line.player.fullName,
          headshotUrl: line.player.headshotUrl ?? null,
        };
        // Split numeric (sort/filter/percentile) from display ("-" placeholder kept).
        for (const col of columns) {
          const raw = byKey.get(col.key);
          row[col.key] = toNumericValue(raw);
          row[`${col.key}__d`] = raw === undefined ? '-' : String(raw);
        }
        out.push(row);
      }
    }
    return out;
  }, [responses, columns, tab, teamNameById]);

  // Percentiles rank each value against only the players in this matchup (both
  // teams' current tab), so the heat colors are scoped to the matchup, not the league.
  const percentiles = useMemo(
    () => buildStatPercentiles(rows, columns, tab === 'pitching'),
    [rows, columns, tab],
  );

  const apiRef = useRef<GridApi<PlayerRow> | null>(null);
  const context = useMemo<StatCellContext>(
    () => ({ percentiles, statsLoading: loading, scopeSuffix: 'among this matchup' }),
    [percentiles, loading],
  );

  // A new percentile lookup (tab/data change) must repaint every colored cell.
  useEffect(() => {
    apiRef.current?.refreshCells({ force: true });
  }, [percentiles]);

  const columnDefs = useMemo<ColDef<PlayerRow>[]>(() => {
    const base: ColDef<PlayerRow>[] = [
      {
        headerName: 'Team',
        field: 'teamName',
        minWidth: 150,
        flex: 1,
        cellRenderer: TeamCell,
        tooltipField: 'teamName',
        filter: 'agTextColumnFilter',
      },
      {
        headerName: 'Player',
        field: 'fullName',
        minWidth: 180,
        flex: 2,
        cellRenderer: PlayerCell,
        tooltipField: 'fullName',
        filter: 'agTextColumnFilter',
      },
    ];
    const statCols: ColDef<PlayerRow>[] = columns.map((col) => ({
      headerName: col.label,
      field: col.key,
      type: 'numericColumn',
      width: 92,
      ...(col.description ? { headerTooltip: col.description } : {}),
      cellRenderer: PercentileHeatCell,
      cellStyle: { padding: 0 },
      filter: 'agNumberColumnFilter',
    }));
    return [...base, ...statCols];
  }, [columns]);

  const defaultColDef = useMemo<ColDef>(
    () => ({ sortable: true, filter: true, resizable: true }),
    [],
  );

  const emptyTemplate = loading
    ? `<span class="ag-overlay-no-rows-center" style="color: var(--muted)">Loading week stats…</span>`
    : `<span class="ag-overlay-no-rows-center" style="color: var(--muted)">No ${tab === 'pitching' ? 'pitchers' : 'hitters'} to show.</span>`;

  return (
    <div className={styles.tableCard}>
      <div className={`${styles.tabToolbar} ${pageStyles.playersTabToolbar}`}>
        <StatsGridHelp scope="matchup" />
        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'batting'}
            className={`${styles.tab}${tab === 'batting' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => onTabChange('batting')}
          >
            Hitters
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'pitching'}
            className={`${styles.tab}${tab === 'pitching' ? ` ${styles.tabActive}` : ''}`}
            onClick={() => onTabChange('pitching')}
          >
            Pitchers
          </button>
        </div>
      </div>
      <div className={`${gridStyles.gridWrap} ${pageStyles.playersSection}`}>
        <AgGridReact<PlayerRow>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          context={context}
          getRowId={(p: GetRowIdParams<PlayerRow>) => String(p.data.rowId)}
          onGridReady={(e) => {
            apiRef.current = e.api;
          }}
          animateRows
          suppressCellFocus
          tooltipShowDelay={300}
          overlayNoRowsTemplate={emptyTemplate}
        />
      </div>
    </div>
  );
}

/** Fantasy team cell: name only (players already grouped by team via the column). */
function TeamCell(params: CustomCellRendererProps) {
  const data = params.data as PlayerRow;
  return <span className={gridStyles.ownerName}>{String(data.teamName ?? '')}</span>;
}

/** Player cell: headshot avatar + full name. */
function PlayerCell(params: CustomCellRendererProps) {
  const data = params.data as PlayerRow;
  const fullName = String(data.fullName ?? '');
  const headshotUrl = data.headshotUrl as string | null;
  return (
    <span className={styles.playerCellInner}>
      <PlayerAvatar fullName={fullName} {...(headshotUrl ? { headshotUrl } : {})} />
      <span className={styles.playerName}>{fullName}</span>
    </span>
  );
}
