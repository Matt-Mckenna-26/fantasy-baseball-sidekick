import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  LeagueRostersResponse,
  LeagueSummary,
  MlbBoxBatter,
  MlbBoxPitcher,
  MlbBoxScoreResponse,
  MlbBoxSide,
  MlbGameSituation,
  MlbGameState,
  Player,
} from '@fcm/contracts';
import { playerGameKey } from '@fcm/contracts';
import { getLeagueRosters, getMlbBoxScore, getMlbGames } from '../api/client';
import { useSession } from '../context/SessionContext';
import { useFirstLeagueResource } from '../hooks/useFirstLeagueResource';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { EntityAvatar, EntityLabel } from '../components/EntityAvatar';
import { PlayerNameButton } from '../components/PlayerNameButton';
import table from '../components/dataTable.module.css';
import styles from './MlbScoresPage.module.css';

export function MlbScoresPage() {
  // Rosters gate the page and power the ownership highlight; the scores/box scores
  // themselves come from the public MLB endpoints below.
  const state = useFirstLeagueResource(getLeagueRosters);

  if (state.status !== 'ready') {
    return <LeagueResourceNotice status={state.status} />;
  }
  return <MlbScoresView rosters={state.data} league={state.league} />;
}

/**
 * Poll fast while a game is live so the diamond can follow a plate appearance (pitches are
 * ~15-20s apart), and slowly otherwise. A matching 5s server cache coalesces viewers.
 */
const LIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 30_000;

/** Today's calendar date in US Eastern time (matches the API's MLB "game day"). */
function easternToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Use a deep-linked YYYY-MM-DD when valid; otherwise today's Eastern game day. */
function dateFromSearch(value: string | null): string {
  return value && DATE_RE.test(value) ? value : easternToday();
}

/** Ownership info for a single MLB player, resolved from the league's rosters. */
interface OwnedInfo {
  player: Player;
  teamName: string;
  logoUrl?: string;
  isMine: boolean;
}

type BoxState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: MlbBoxScoreResponse };

function MlbScoresView({
  rosters,
  league,
}: {
  rosters: LeagueRostersResponse;
  league: LeagueSummary;
}) {
  const { session } = useSession();
  const myTeamName = session.status === 'connected' ? (session.selectedLeague?.teamName ?? null) : null;

  const [searchParams] = useSearchParams();
  const focusGamePk = Number(searchParams.get('game')) || null;
  const dateParam = searchParams.get('date');

  const [date, setDate] = useState(() => dateFromSearch(dateParam));
  const [games, setGames] = useState<MlbGameState[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [boxByGame, setBoxByGame] = useState<Record<number, BoxState>>({});

  // Honor a `?date=` deep link (from Rosters paging a past day) without fighting the
  // date picker: only apply when the query itself changes.
  useEffect(() => {
    if (dateParam && DATE_RE.test(dateParam)) setDate(dateParam);
  }, [dateParam]);

  // DOM nodes per game card so a `?game=` deep link can scroll its card into view.
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const setCardRef = useCallback((gamePk: number, node: HTMLDivElement | null) => {
    if (node) cardRefs.current.set(gamePk, node);
    else cardRefs.current.delete(gamePk);
  }, []);

  // Keep the latest games/expanded in refs so the polling effect can read them without
  // re-subscribing (and restarting its timer) on every state change.
  const gamesRef = useRef(games);
  gamesRef.current = games;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  // playerGameKey(mlbTeam, name) -> owning fantasy team, built once per roster snapshot.
  const ownershipIndex = useMemo(() => {
    const map = new Map<string, OwnedInfo>();
    for (const team of rosters.teams) {
      const isMine = myTeamName != null && team.teamName === myTeamName;
      for (const slot of team.slots) {
        const abbr = slot.player.mlbTeamAbbr;
        if (!abbr) continue;
        map.set(playerGameKey(abbr, slot.player.fullName), {
          player: slot.player,
          teamName: team.teamName,
          ...(team.logoUrl ? { logoUrl: team.logoUrl } : {}),
          isMine,
        });
      }
    }
    return map;
  }, [rosters.teams, myTeamName]);

  const fetchBox = useCallback((gamePk: number, silent: boolean) => {
    if (!silent) {
      setBoxByGame((prev) => ({ ...prev, [gamePk]: { status: 'loading' } }));
    }
    getMlbBoxScore(gamePk)
      .then((data) => setBoxByGame((prev) => ({ ...prev, [gamePk]: { status: 'ready', data } })))
      .catch(() =>
        setBoxByGame((prev) => {
          // On a silent refresh failure, keep whatever we already showed.
          if (silent && prev[gamePk]?.status === 'ready') return prev;
          return { ...prev, [gamePk]: { status: 'error' } };
        }),
      );
  }, []);

  // Load the selected date's games and self-schedule the next poll: 5s while any game is
  // live (so the diamond/count keeps up with an at-bat), 30s otherwise. Polling pauses
  // while the tab is hidden and resumes immediately when it becomes visible again.
  useEffect(() => {
    let stale = false;
    let timer: number | undefined;

    const scheduleNext = (live: boolean) => {
      if (stale) return;
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') loadGames();
        else scheduleNext(live);
      }, live ? LIVE_POLL_MS : IDLE_POLL_MS);
    };

    const loadGames = () => {
      getMlbGames(date)
        .then((res) => {
          if (stale) return;
          setGames(res.games);
          const liveByPk = new Set(
            res.games.filter((g) => g.state === 'live').map((g) => g.gamePk),
          );
          for (const gamePk of expandedRef.current) {
            if (liveByPk.has(gamePk)) fetchBox(gamePk, true);
          }
          scheduleNext(liveByPk.size > 0);
        })
        .catch(() => {
          if (stale) return;
          setGames([]);
          scheduleNext(false);
        });
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      loadGames();
    };

    loadGames();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stale = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [date, fetchBox]);

  // Reset expansion when the date changes so we don't show a prior day's box scores.
  useEffect(() => {
    setExpanded(new Set());
    setBoxByGame({});
  }, [date]);

  const toggleGame = useCallback(
    (gamePk: number) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(gamePk)) {
          next.delete(gamePk);
        } else {
          next.add(gamePk);
          if (!boxByGame[gamePk]) fetchBox(gamePk, false);
        }
        return next;
      });
    },
    [boxByGame, fetchBox],
  );

  const ownerFor = useCallback(
    (teamAbbr: string, fullName: string): OwnedInfo | undefined =>
      ownershipIndex.get(playerGameKey(teamAbbr, fullName)),
    [ownershipIndex],
  );

  // A `?game=` deep link (from Matchups or Rosters) expands that game's card, loads its
  // box score, and scrolls it into view once. Guarded so collapsing the card doesn't
  // re-expand it.
  const focusedRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusGamePk || focusedRef.current === focusGamePk) return;
    if (!games.some((g) => g.gamePk === focusGamePk)) return;
    focusedRef.current = focusGamePk;
    setExpanded((prev) => {
      if (prev.has(focusGamePk)) return prev;
      const next = new Set(prev);
      next.add(focusGamePk);
      return next;
    });
    if (!boxByGame[focusGamePk]) fetchBox(focusGamePk, false);
    requestAnimationFrame(() => {
      cardRefs.current
        .get(focusGamePk)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [focusGamePk, games, boxByGame, fetchBox]);

  return (
    <section>
      <div className={table.page__header}>
        <div>
          <h1>MLB Scores</h1>
          <EntityLabel
            label={league.name}
            className="muted"
            {...(league.logoUrl ? { imageUrl: league.logoUrl } : {})}
          />
        </div>
        <div className={styles.dateBar}>
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
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <button
            type="button"
            className={styles.dateNav}
            onClick={() => setDate((d) => shiftDate(d, 1))}
            aria-label="Next day"
          >
            ›
          </button>
          <button type="button" className={styles.todayButton} onClick={() => setDate(easternToday())}>
            Today
          </button>
        </div>
      </div>

      {games.length === 0 ? (
        <p className="muted">No MLB games scheduled for this date.</p>
      ) : (
        <div className={styles.gameList}>
          {games.map((game) => (
            <GameCard
              key={game.gamePk}
              game={game}
              expanded={expanded.has(game.gamePk)}
              box={boxByGame[game.gamePk]}
              onToggle={() => toggleGame(game.gamePk)}
              ownerFor={ownerFor}
              cardRef={(node) => setCardRef(game.gamePk, node)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function statusText(game: MlbGameState): string {
  if (game.state === 'live') {
    return [game.inningState, game.inning].filter(Boolean).join(' ') || 'In Progress';
  }
  if (game.state === 'final') return 'Final';
  return game.startTime
    ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : 'Scheduled';
}

function GameCard({
  game,
  expanded,
  box,
  onToggle,
  ownerFor,
  cardRef,
}: {
  game: MlbGameState;
  expanded: boolean;
  box: BoxState | undefined;
  onToggle: () => void;
  ownerFor: (teamAbbr: string, fullName: string) => OwnedInfo | undefined;
  cardRef: (node: HTMLDivElement | null) => void;
}) {
  const hasScore = game.homeScore !== undefined && game.awayScore !== undefined;
  const awayWon = hasScore && (game.awayScore ?? 0) > (game.homeScore ?? 0);
  const homeWon = hasScore && (game.homeScore ?? 0) > (game.awayScore ?? 0);

  return (
    <div ref={cardRef} className={`${styles.gameCard} ${expanded ? styles.gameCardActive : ''}`}>
      <button
        type="button"
        className={styles.gameCardMain}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={styles.gameTeams}>
          <ScoreRow abbr={game.awayAbbr} score={game.awayScore} winner={awayWon} />
          <ScoreRow abbr={game.homeAbbr} score={game.homeScore} winner={homeWon} />
        </span>
        <span className={styles.gameMeta}>
          <span className={game.state === 'live' ? styles.statusLive : 'muted'}>
            {statusText(game)}
          </span>
          <span className={styles.expandHint} aria-hidden="true">
            {expanded ? 'Hide box score ▲' : 'Box score ▼'}
          </span>
        </span>
      </button>

      {game.state === 'live' && game.situation && (
        <LiveSituation situation={game.situation} />
      )}

      {expanded && (
        <div className={styles.boxWrap}>
          {(!box || box.status === 'loading') && <p className="muted">Loading box score…</p>}
          {box?.status === 'error' && (
            <p className="muted">Box score unavailable for this game.</p>
          )}
          {box?.status === 'ready' && (
            <div className={styles.boxPanels}>
              <TeamBox side={box.data.away} ownerFor={ownerFor} />
              <TeamBox side={box.data.home} ownerFor={ownerFor} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Live at-bat panel: mini diamond, ball-strike count, outs, and current pitcher/batter. */
function LiveSituation({ situation }: { situation: MlbGameSituation }) {
  const outsLabel = `${situation.outs} ${situation.outs === 1 ? 'out' : 'outs'}`;
  return (
    <div className={styles.liveSituation}>
      <BaseballDiamond situation={situation} />
      <div className={styles.situationInfo}>
        <div className={styles.countRow}>
          <span className={styles.count} aria-label={`Count ${situation.balls} and ${situation.strikes}`}>
            {situation.balls}-{situation.strikes}
          </span>
          <span className={styles.outs} aria-label={outsLabel}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`${styles.outPip} ${i < situation.outs ? styles.outPipOn : ''}`}
                aria-hidden="true"
              />
            ))}
            <span className={styles.outsLabel}>{outsLabel}</span>
          </span>
        </div>
        {situation.pitcher && (
          <div className={styles.matchupLine}>
            <span className={styles.matchupRole}>P</span> {situation.pitcher}
          </div>
        )}
        {situation.batter && (
          <div className={styles.matchupLine}>
            <span className={styles.matchupRole}>AB</span> {situation.batter}
          </div>
        )}
      </div>
    </div>
  );
}

/** A tiny baseball diamond; occupied bases are filled and name their runner on hover. */
function BaseballDiamond({ situation }: { situation: MlbGameSituation }) {
  const label = [
    situation.first ? `${situation.first} on first` : null,
    situation.second ? `${situation.second} on second` : null,
    situation.third ? `${situation.third} on third` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div className={styles.diamond} role="img" aria-label={label || 'bases empty'}>
      <Base runner={situation.second} baseLabel="second" className={styles.baseSecond} />
      <Base runner={situation.third} baseLabel="third" className={styles.baseThird} />
      <Base runner={situation.first} baseLabel="first" className={styles.baseFirst} />
    </div>
  );
}

/** One base on the diamond: filled when occupied, with the runner's name as a hover title. */
function Base({
  runner,
  baseLabel,
  className,
}: {
  runner: string | undefined;
  baseLabel: string;
  className: string | undefined;
}) {
  const baseClass = `${styles.base} ${className}`;
  if (!runner) return <span className={baseClass} />;
  return (
    <span
      className={`${baseClass} ${styles.baseOn}`}
      title={runner}
      aria-label={`${runner} on ${baseLabel}`}
    />
  );
}

function ScoreRow({
  abbr,
  score,
  winner,
}: {
  abbr: string;
  score: number | undefined;
  winner: boolean;
}) {
  return (
    <span className={styles.scoreRow}>
      <span className={styles.teamAbbr}>{abbr}</span>
      <span className={`${styles.teamScore} ${winner ? styles.teamScoreWin : ''}`}>
        {score ?? '-'}
      </span>
    </span>
  );
}

function TeamBox({
  side,
  ownerFor,
}: {
  side: MlbBoxSide;
  ownerFor: (teamAbbr: string, fullName: string) => OwnedInfo | undefined;
}) {
  return (
    <div className={styles.boxPanel}>
      <div className={styles.boxPanelHeader}>
        <span className={styles.boxTeamName}>{side.teamName || side.teamAbbr}</span>
        <span className={styles.lineScore}>
          {side.runs} R · {side.hits} H · {side.errors} E
        </span>
      </div>

      <BattingGrid side={side} ownerFor={ownerFor} />
      <PitchingGrid side={side} ownerFor={ownerFor} />
    </div>
  );
}

/** Owning-team badge shown after a player's name when they're rostered in the league. */
function OwnerBadge({ owner }: { owner: OwnedInfo }) {
  return (
    <span
      className={`${styles.ownerBadge} ${owner.isMine ? styles.ownerBadgeMine : ''}`}
      title={`Rostered by ${owner.teamName}`}
    >
      <EntityAvatar
        label={owner.teamName}
        className={styles.ownerAvatar}
        {...(owner.logoUrl ? { imageUrl: owner.logoUrl } : {})}
      />
      <span className={styles.ownerName}>{owner.teamName}</span>
    </span>
  );
}

/** Player name: a focus-modal button when owned (we have the Yahoo id), plain text otherwise. */
function PlayerName({ owner, fullName }: { owner: OwnedInfo | undefined; fullName: string }) {
  if (!owner) return <span>{fullName}</span>;
  const { player } = owner;
  return (
    <PlayerNameButton
      stopPropagation
      target={{
        playerId: player.playerId,
        fullName: player.fullName,
        ...(player.mlbTeamAbbr ? { mlbTeamAbbr: player.mlbTeamAbbr } : {}),
        ...(player.positionType ? { positionType: player.positionType } : {}),
        ...(player.headshotUrl ? { headshotUrl: player.headshotUrl } : {}),
      }}
    >
      {fullName}
    </PlayerNameButton>
  );
}

function BattingGrid({
  side,
  ownerFor,
}: {
  side: MlbBoxSide;
  ownerFor: (teamAbbr: string, fullName: string) => OwnedInfo | undefined;
}) {
  if (side.batters.length === 0) {
    return <p className="muted">No batting stats yet.</p>;
  }
  return (
    <div className={styles.gridWrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th className={styles.stickyPlayer}>Hitters</th>
            <th className={table.num}>AB</th>
            <th className={table.num}>R</th>
            <th className={table.num}>H</th>
            <th className={table.num}>RBI</th>
            <th className={table.num}>HR</th>
            <th className={table.num}>BB</th>
            <th className={table.num}>SO</th>
            <th className={table.num}>AVG</th>
          </tr>
        </thead>
        <tbody>
          {side.batters.map((b, i) => (
            <BatterRow key={`${b.fullName}-${i}`} batter={b} owner={ownerFor(side.teamAbbr, b.fullName)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatterRow({ batter, owner }: { batter: MlbBoxBatter; owner: OwnedInfo | undefined }) {
  return (
    <tr className={owner ? styles.ownedRow : undefined}>
      <td className={styles.stickyPlayer}>
        <span className={styles.playerCell}>
          <PlayerName owner={owner} fullName={batter.fullName} />
          {batter.position ? <span className="muted"> {batter.position}</span> : null}
          {owner ? <OwnerBadge owner={owner} /> : null}
        </span>
      </td>
      <td className={table.num}>{batter.ab}</td>
      <td className={table.num}>{batter.r}</td>
      <td className={table.num}>{batter.h}</td>
      <td className={table.num}>{batter.rbi}</td>
      <td className={table.num}>{batter.hr}</td>
      <td className={table.num}>{batter.bb}</td>
      <td className={table.num}>{batter.so}</td>
      <td className={table.num}>{batter.avg ?? '-'}</td>
    </tr>
  );
}

function PitchingGrid({
  side,
  ownerFor,
}: {
  side: MlbBoxSide;
  ownerFor: (teamAbbr: string, fullName: string) => OwnedInfo | undefined;
}) {
  if (side.pitchers.length === 0) {
    return <p className="muted">No pitching stats yet.</p>;
  }
  return (
    <div className={styles.gridWrap}>
      <table className={table.table}>
        <thead>
          <tr>
            <th className={styles.stickyPlayer}>Pitchers</th>
            <th className={table.num}>IP</th>
            <th className={table.num}>H</th>
            <th className={table.num}>R</th>
            <th className={table.num}>ER</th>
            <th className={table.num}>BB</th>
            <th className={table.num}>SO</th>
            <th className={table.num}>HR</th>
            <th className={table.num} title="Pitches thrown">P</th>
            <th className={table.num}>ERA</th>
          </tr>
        </thead>
        <tbody>
          {side.pitchers.map((p, i) => (
            <PitcherRow key={`${p.fullName}-${i}`} pitcher={p} owner={ownerFor(side.teamAbbr, p.fullName)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PitcherRow({ pitcher, owner }: { pitcher: MlbBoxPitcher; owner: OwnedInfo | undefined }) {
  return (
    <tr className={owner ? styles.ownedRow : undefined}>
      <td className={styles.stickyPlayer}>
        <span className={styles.playerCell}>
          <PlayerName owner={owner} fullName={pitcher.fullName} />
          {pitcher.decision ? <span className={styles.decision}>({pitcher.decision})</span> : null}
          {owner ? <OwnerBadge owner={owner} /> : null}
        </span>
      </td>
      <td className={table.num}>{pitcher.ip}</td>
      <td className={table.num}>{pitcher.h}</td>
      <td className={table.num}>{pitcher.r}</td>
      <td className={table.num}>{pitcher.er}</td>
      <td className={table.num}>{pitcher.bb}</td>
      <td className={table.num}>{pitcher.so}</td>
      <td className={table.num}>{pitcher.hr}</td>
      <td className={table.num}>{pitcher.pitches}</td>
      <td className={table.num}>{pitcher.era ?? '-'}</td>
    </tr>
  );
}
