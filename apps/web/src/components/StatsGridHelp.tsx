import { useEffect, useId, useRef, useState } from 'react';
import { hasSeenStatsGridHelp, markStatsGridHelpSeen } from '../lib/statsGridHelpSeen';
import styles from '../pages/StatsPage.module.css';

/** The comparison pool the heat colors rank against, used to word the help lead. */
type StatsGridScope = 'players' | 'teams' | 'matchup';

/** Lead sentence describing the pool each scope's heat colors rank against. */
const SCOPE_LEAD: Record<StatsGridScope, string> = {
  teams: 'Stat cells are shaded by where each value ranks among every team in your league for this tab.',
  players:
    'Stat cells are shaded by where each value ranks among every player shown in this tab (all rostered batters or pitchers in your league).',
  matchup:
    'Stat cells are shaded by where each value ranks among only the players in this matchup — both teams’ batters or pitchers for the shown week, not the whole league.',
};

/** Explains percentile heat colors and how to sort/filter a stats grid (players, teams, or matchup). */
export function StatsGridHelp({ scope = 'players' }: { scope?: StatsGridScope }) {
  const [open, setOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(() => !hasSeenStatsGridHelp(scope));
  const isMatchup = scope === 'matchup';
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.gridHelp} ref={rootRef}>
      <button
        type="button"
        className={styles.gridHelpTrigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={
          showBadge
            ? 'How color coding, sort, and filter work on this grid (new guide)'
            : 'How color coding, sort, and filter work on this grid'
        }
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) {
              markStatsGridHelpSeen(scope);
              setShowBadge(false);
            }
            return next;
          });
        }}
      >
        ?
        {showBadge ? <span className={styles.gridHelpBadge} aria-hidden /> : null}
      </button>
      {open ? (
        <div
          id={panelId}
          className={styles.gridHelpPanel}
          role="dialog"
          aria-label="Stats grid guide"
        >
          <p className={styles.gridHelpLead}>{SCOPE_LEAD[scope]}</p>

          <section className={styles.gridHelpSection}>
            <h3 className={styles.gridHelpHeading}>Color coding</h3>
            <ul className={styles.gridHelpList}>
              <li>
                Each value gets a <strong>percentile from 0 to 100</strong> within that stat column,
                using mid-rank: (players strictly lower + half of ties) ÷ players with a value.
              </li>
              <li>
                <span className={styles.gridHelpSwatch} data-tone="cold" aria-hidden />{' '}
                <strong>Blue</strong> = below average for that stat;{' '}
                <span className={styles.gridHelpSwatch} data-tone="neutral" aria-hidden /> neutral
                near the 50th percentile;{' '}
                <span className={styles.gridHelpSwatch} data-tone="hot" aria-hidden />{' '}
                <strong>red</strong> = above average.
              </li>
              <li>
                For stats where lower is better (ERA, WHIP, strikeouts for batters, etc.), the scale
                is inverted so <strong>red always means better</strong> and blue means worse.
              </li>
              <li>Hover a colored cell to see its exact percentile (e.g. 73rd).</li>
            </ul>
          </section>

          <section className={styles.gridHelpSection}>
            <h3 className={styles.gridHelpHeading}>Compare teams and players</h3>
            <ul className={styles.gridHelpList}>
              <li>
                <strong>Sort</strong> — click any column header to sort; click again to reverse.
                Find league leaders or laggards in a category.
              </li>
              <li>
                <strong>Filter by team</strong> — open the Team column filter, pick one or more
                fantasy teams, and compare only those rosters side by side.
              </li>
              <li>
                <strong>Filter by stat</strong> — use number filters on stat columns (e.g. HR ≥ 5)
                to narrow the player pool.
              </li>
              {isMatchup ? null : (
                <li>
                  <strong>Time window</strong> — switch Today, Last 7, Last 30, or Season above the
                  grid. Colors recalculate for that window so you can spot hot streaks vs
                  season-long performance.
                </li>
              )}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
