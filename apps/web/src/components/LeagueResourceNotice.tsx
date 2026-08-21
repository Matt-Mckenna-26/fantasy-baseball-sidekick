import { Navigate } from 'react-router-dom';

/** Renders the loading/disconnected/empty/not_allowed/error states shared by data pages. */
export function LeagueResourceNotice({
  status,
}: {
  status: 'loading' | 'disconnected' | 'empty' | 'not_allowed' | 'error';
}) {
  if (status === 'loading') {
    // The in-flight fetch drives the global LoadingOverlay; render nothing here.
    return null;
  }
  if (status === 'disconnected') {
    // Guests never see a bare "Connect Yahoo" page: send them to the TheShowGPT sign-in
    // hero (/chat), which handles both the cold and expired-session copy.
    return <Navigate to="/chat" replace />;
  }
  if (status === 'empty') {
    return (
      <section className="emptyState">
        <p className="muted">No MLB leagues found on your Yahoo account.</p>
      </section>
    );
  }
  if (status === 'not_allowed') {
    return (
      <section className="emptyState">
        <h1>Closed beta</h1>
        <p className="muted">None of your leagues are in the closed beta group yet.</p>
      </section>
    );
  }
  return (
    <section className="emptyState">
      <h1>Something went wrong</h1>
      <p className="muted">We could not load this data. Please try again.</p>
    </section>
  );
}
