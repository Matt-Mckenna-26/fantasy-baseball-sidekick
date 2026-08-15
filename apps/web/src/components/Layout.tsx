import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../context/SessionContext';
import { EntityAvatar } from './EntityAvatar';
import { UserMenu } from './UserMenu';
import { LoadingOverlay } from './LoadingOverlay';
import { BackToTop } from './BackToTop';
import styles from './Layout.module.css';

const DEFAULT_TITLE = 'Fantasy Baseball Co-Manager';

function teamPossessive(teamName: string): string {
  return /s$/i.test(teamName.trim()) ? `${teamName.trim()}'` : `${teamName.trim()}'s`;
}

function ShellBrand() {
  const { session } = useSession();

  if (session.status !== 'connected') {
    return <span className={styles.title}>{DEFAULT_TITLE}</span>;
  }

  const teamName = session.selectedLeague?.teamName?.trim();
  if (!teamName) {
    return <span className={styles.title}>{DEFAULT_TITLE}</span>;
  }

  const logoUrl = session.selectedLeague?.logoUrl;
  const title = `${teamPossessive(teamName)} ${DEFAULT_TITLE}`;

  return (
    <div className={styles.brandBadge} aria-label={title}>
      <EntityAvatar
        label={teamName}
        className={styles.brandAvatar}
        {...(logoUrl ? { imageUrl: logoUrl } : {})}
      />
      <span className={styles.brandTitle}>
        <span className={styles.brandTeam}>{teamPossessive(teamName)}</span>
        <span className={styles.brandTagline}>{DEFAULT_TITLE}</span>
      </span>
    </div>
  );
}

const authedNavItems = [
  { to: '/chat', label: 'TheShowGPT' },
  { to: '/rosters', label: 'Rosters' },
  { to: '/scores', label: 'Scores' },
  { to: '/standings', label: 'Live Standings' },
  { to: '/matchups', label: 'Matchups' },
  { to: '/stats', label: 'Players' },
  { to: '/team-stats', label: 'League' },
];

function SparkleIcon() {
  return (
    <svg className={styles.sparkleIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0.5 9.4 5.8 14.5 7.2 9.4 8.6 8 13.9 6.6 8.6 1.5 7.2 6.6 5.8 8 0.5Z"
      />
      <path
        fill="currentColor"
        d="M12.8 1.2 13.3 2.9 15 3.4 13.3 3.9 12.8 5.6 12.3 3.9 10.6 3.4 12.3 2.9 12.8 1.2Z"
      />
    </svg>
  );
}

function LabFlaskIcon() {
  return (
    <svg className={styles.labFlaskIcon} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.2 1.5h3.6M8 1.5v3.1M5.4 8.2 3.6 12.8c-.4.9.3 1.7 1.3 1.7h6.2c1 0 1.7-.8 1.3-1.7L10.6 8.2"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        d="M5.8 8.2h4.4"
      />
      <path
        fill="currentColor"
        d="M6.6 10.1c.5.35 1.1.55 1.4.55s.9-.2 1.4-.55"
        opacity="0.85"
      />
    </svg>
  );
}

function NavLabel({ to, label }: { to: string; label: string }) {
  if (to === '/chat') {
    return (
      <span className={styles.navLabel}>
        <SparkleIcon />
        <span>TheShowGPT</span>
      </span>
    );
  }
  if (to === '/standings') {
    return (
      <span className={styles.navLabel}>
        <span className={styles.liveDot} aria-hidden="true" />
        <span>Live Standings</span>
      </span>
    );
  }
  if (to === '/stats' || to === '/team-stats') {
    return (
      <span className={styles.navLabel}>
        <LabFlaskIcon />
        <span>{label}</span>
      </span>
    );
  }
  return <span className={styles.navLabel}>{label}</span>;
}

const guestNavItems = [
  { to: '/', label: 'Home' },
  ...authedNavItems.filter((item) => item.to !== '/chat'),
];

/** Data-heavy pages need the full viewport width so stat tables fit without scrolling. */
const WIDE_MAIN_PATHS = new Set([
  '/rosters',
  '/scores',
  '/standings',
  '/matchups',
  '/stats',
  '/team-stats',
]);

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { session } = useSession();
  const isAuthed = session.status === 'connected';
  const navItems = isAuthed ? authedNavItems : guestNavItems;
  const isChat = pathname === '/chat';
  const mainClass = WIDE_MAIN_PATHS.has(pathname)
    ? `${styles.main} ${styles.mainWide}`
    : isChat
      ? `${styles.main} ${styles.mainChat}`
      : styles.main;

  return (
    <div className={isChat ? `${styles.shell} ${styles.shellChat}` : styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerBar}>
          <div className={styles.brandSlot}>
            <ShellBrand />
          </div>
          <nav className={styles.nav} aria-label="Main">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                }
              >
                <NavLabel to={item.to} label={item.label} />
              </NavLink>
            ))}
          </nav>
          <div className={styles.actions}>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className={mainClass}>
        <LoadingOverlay />
        {children}
      </main>
      {!isChat && <BackToTop />}
      {!isChat && (
        <footer className={styles.footer}>
        {/* Required attribution per Yahoo Fantasy Sports API terms; must link back to Yahoo Fantasy
            using the official Yahoo Fantasy logo. */}
        <a
          className={styles.attribution}
          href="https://baseball.fantasysports.yahoo.com/"
          target="_blank"
          rel="noreferrer noopener"
        >
          <span>Fantasy data provided by</span>
          <img className={styles.attributionLogo} src="/yahoo-fantasy.svg" alt="Yahoo Fantasy" />
        </a>
        </footer>
      )}
    </div>
  );
}
