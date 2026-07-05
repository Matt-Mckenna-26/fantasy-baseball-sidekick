import type { Matchup, MatchupTeam } from '@fcm/contracts';
import { EntityAvatar } from './EntityAvatar';
import styles from './MatchupCarousel.module.css';

type MatchupCarouselProps = {
  week: number;
  matchups: Matchup[];
  /** A team in the currently-focused matchup; that card renders as selected. */
  selectedTeamId?: string;
  /** When provided, cards become clickable and invoke this on click. */
  onSelectMatchup?: (matchup: Matchup) => void;
};

/** Stable-ish key from the matchup's two teams (falls back to index). */
export function matchupKey(matchup: Matchup, index: number): string {
  return matchup.teams.map((t) => t.teamId).join('-') || String(index);
}

/** True when either side of the matchup is `teamId`. */
function matchupHasTeam(matchup: Matchup, teamId: string | undefined): boolean {
  return teamId !== undefined && matchup.teams.some((t) => t.teamId === teamId);
}

/** Horizontal carousel of this week's matchup cards; optionally clickable/selectable. */
export function MatchupCarousel({
  week,
  matchups,
  selectedTeamId,
  onSelectMatchup,
}: MatchupCarouselProps) {
  return (
    <div className={styles.carousel}>
      <div className={styles.carouselHeader}>
        <span className={styles.liveDot} aria-hidden="true" />
        <span>Week {week} matchups</span>
      </div>
      <div className={styles.carouselTrack}>
        {matchups.map((matchup, i) => (
          <MatchupCard
            key={matchupKey(matchup, i)}
            matchup={matchup}
            selected={matchupHasTeam(matchup, selectedTeamId)}
            {...(onSelectMatchup ? { onSelect: () => onSelectMatchup(matchup) } : {})}
          />
        ))}
      </div>
    </div>
  );
}

function MatchupCard({
  matchup,
  selected,
  onSelect,
}: {
  matchup: Matchup;
  selected: boolean;
  onSelect?: () => void;
}) {
  const [home, away] = matchup.teams;
  // The team leading more categories is the projected winner; equal means tied.
  const homeLeads = home && away ? home.categoriesWon > away.categoriesWon : false;
  const awayLeads = home && away ? away.categoriesWon > home.categoriesWon : false;

  const body = (
    <>
      {home && <MatchupSide team={home} leading={homeLeads} />}
      <div className={styles.cardDivider}>vs</div>
      {away && <MatchupSide team={away} leading={awayLeads} />}
    </>
  );

  const className = `${styles.card}${selected ? ` ${styles.cardSelected}` : ''}`;

  if (onSelect) {
    return (
      <button
        type="button"
        className={`${className} ${styles.cardButton}`}
        onClick={onSelect}
        aria-pressed={selected}
      >
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

function MatchupSide({ team, leading }: { team: MatchupTeam; leading: boolean }) {
  return (
    <div className={leading ? `${styles.side} ${styles.sideLeading}` : styles.side}>
      <EntityAvatar label={team.teamName} {...(team.logoUrl ? { imageUrl: team.logoUrl } : {})} />
      <span className={styles.sideName} title={team.teamName}>
        {team.teamName}
      </span>
      <span className={styles.sideScore}>{team.categoriesWon}</span>
    </div>
  );
}
