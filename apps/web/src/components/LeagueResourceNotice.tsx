import { YAHOO_LOGIN_URL } from '../api/client';
import { useSession } from '../context/SessionContext';

/** Renders the loading/disconnected/empty/not_allowed/error states shared by data pages. */
export function LeagueResourceNotice({
  status,
}: {
  status: 'loading' | 'disconnected' | 'empty' | 'not_allowed' | 'error';
}) {
  const { session } = useSession();

  if (status === 'loading') {
    // The in-flight fetch drives the global LoadingOverlay; render nothing here.
    return null;
  }
  if (status === 'disconnected') {
    const sessionExpired = session.status === 'disconnected' && session.sessionExpired;
    return (
      <section>
        <h1>{sessionExpired ? 'Session expired' : 'Connect your Yahoo account'}</h1>
        <p>
          {sessionExpired
            ? 'Your Yahoo sign-in is no longer valid. Sign in again to continue (read-only).'
            : 'Sign in with Yahoo to view this page (read-only).'}
        </p>
        <a className="button" href={YAHOO_LOGIN_URL}>
          Connect Yahoo
        </a>
      </section>
    );
  }
  if (status === 'empty') {
    return <p className="muted">No MLB leagues found on your Yahoo account.</p>;
  }
  if (status === 'not_allowed') {
    return (
      <section>
        <h1>Closed beta</h1>
        <p className="muted">None of your leagues are in the closed beta group yet.</p>
      </section>
    );
  }
  return (
    <section>
      <h1>Something went wrong</h1>
      <p className="muted">We could not load this data. Please try again.</p>
    </section>
  );
}
