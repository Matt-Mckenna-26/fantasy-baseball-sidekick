import { useEffect, useState } from 'react';
import type { LeagueSummary } from '@fcm/contracts';
import { getAuthStatus, getMyLeagues, logout, YAHOO_LOGIN_URL } from '../api/client';

type Status = 'loading' | 'connected' | 'disconnected' | 'error';

export function HomePage() {
  const [status, setStatus] = useState<Status>('loading');
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);

  async function refresh() {
    setStatus('loading');
    try {
      const auth = await getAuthStatus();
      if (!auth.authenticated) {
        setStatus('disconnected');
        return;
      }
      const data = await getMyLeagues();
      setLeagues(data.leagues);
      setStatus('connected');
    } catch {
      setStatus('error');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onLogout() {
    await logout();
    setLeagues([]);
    await refresh();
  }

  if (status === 'loading') {
    return <p>Loading...</p>;
  }

  if (status === 'disconnected') {
    return (
      <section className="home">
        <h1>Connect your Yahoo account</h1>
        <p>Sign in with Yahoo to load your fantasy baseball leagues (read-only).</p>
        <a className="button" href={YAHOO_LOGIN_URL}>
          Connect Yahoo
        </a>
      </section>
    );
  }

  if (status === 'error') {
    return (
      <section className="home">
        <h1>Something went wrong</h1>
        <p>We could not load your leagues. Please try connecting again.</p>
        <a className="button" href={YAHOO_LOGIN_URL}>
          Reconnect Yahoo
        </a>
      </section>
    );
  }

  return (
    <section className="home">
      <div className="home__header">
        <h1>Your MLB Leagues</h1>
        <button className="button button--secondary" onClick={() => void onLogout()}>
          Disconnect
        </button>
      </div>
      {leagues.length === 0 ? (
        <p>No MLB leagues found on your Yahoo account.</p>
      ) : (
        <ul className="league-list">
          {leagues.map((league) => (
            <li key={league.leagueId} className="league-item">
              <span className="league-item__name">{league.name}</span>
              <span className="league-item__season">{league.season}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
