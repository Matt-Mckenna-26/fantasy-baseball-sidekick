import { useEffect, useId, useRef, useState } from 'react';
import { useSession } from '../context/SessionContext';
import { EntityAvatar } from './EntityAvatar';
import styles from './UserMenu.module.css';

const NOT_IN_BETA = 'This league is not in the closed beta group';

export function UserMenu() {
  const { session, selectLeague, logout } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

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

  if (session.status !== 'connected') return null;

  const { leagues, selectedLeague, userGuid } = session;
  const hasAllowed = leagues.some((l) => l.allowed);
  const displayName = selectedLeague?.teamName ?? (userGuid ? 'Yahoo account' : 'Signed in');
  const leagueLine = selectedLeague
    ? `${selectedLeague.name} (${selectedLeague.season})`
    : 'No league selected';
  const avatarLabel = selectedLeague?.teamName ?? selectedLeague?.name ?? displayName;

  async function onSignOut() {
    setOpen(false);
    await logout();
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        aria-label={`Account menu for ${displayName}`}
        onClick={() => setOpen((value) => !value)}
      >
        <EntityAvatar
          label={avatarLabel}
          {...(selectedLeague?.logoUrl ? { imageUrl: selectedLeague.logoUrl } : {})}
        />
        <span className={styles.text}>
          <span className={styles.primary}>{displayName}</span>
          <span className={styles.secondary}>{leagueLine}</span>
        </span>
        <span className={styles.chevron} aria-hidden />
      </button>

      {open ? (
        <div id={menuId} className={styles.menu} role="menu">
          <div className={styles.menuHeader}>
            <span className={styles.menuLabel}>League</span>
            {leagues.length === 0 ? (
              <p className={styles.betaNotice}>No MLB leagues found on your Yahoo account.</p>
            ) : (
              <label className={styles.field}>
                <select
                  className={styles.select}
                  value={selectedLeague?.leagueId ?? ''}
                  disabled={!hasAllowed}
                  onChange={(event) => selectLeague(event.target.value)}
                >
                  {!hasAllowed && <option value="">No leagues available in the closed beta</option>}
                  {leagues.map((league) => (
                    <option
                      key={league.leagueId}
                      value={league.leagueId}
                      disabled={!league.allowed}
                      title={league.allowed ? undefined : NOT_IN_BETA}
                    >
                      {league.name} ({league.season})
                      {league.allowed ? '' : ' — not in closed beta'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!hasAllowed && leagues.length > 0 && (
              <p className={styles.betaNotice}>{NOT_IN_BETA}.</p>
            )}
          </div>
          <button type="button" className={styles.signOut} role="menuitem" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
