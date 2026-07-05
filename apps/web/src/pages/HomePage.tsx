import { Navigate } from 'react-router-dom';
import { YAHOO_LOGIN_URL } from '../api/client';
import { useSession } from '../context/SessionContext';

/** Landing page for guests; authed users are sent straight into the app. */
export function HomePage() {
  const { session } = useSession();

  if (session.status === 'loading') {
    // Session boot fetch drives the global LoadingOverlay; render nothing here.
    return null;
  }

  if (session.status === 'connected') {
    return <Navigate to="/chat" replace />;
  }

  const sessionExpired = session.status === 'disconnected' && session.sessionExpired;

  return (
    <section>
      <h1>{sessionExpired ? 'Session expired' : 'Connect your Yahoo account'}</h1>
      <p>
        {sessionExpired
          ? 'Your Yahoo sign-in is no longer valid. Sign in again to load your leagues (read-only).'
          : 'Sign in with Yahoo to load your fantasy baseball leagues (read-only).'}
      </p>
      <a className="button button--block" href={YAHOO_LOGIN_URL}>
        Connect Yahoo
      </a>
    </section>
  );
}
