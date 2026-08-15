import { Navigate } from 'react-router-dom';
import { useSession } from '../context/SessionContext';

/**
 * Landing route (`/`). Everyone lands in the chat experience: authed users get the
 * co-manager, guests get the TheShowGPT sign-in hero ([ChatGuestView], rendered by
 * [ChatPage]). We redirect rather than render a second sign-in screen so guests never
 * see the old bare "Connect Yahoo" page and the chat shell styling stays consistent.
 */
export function HomePage() {
  const { session } = useSession();

  if (session.status === 'loading') {
    // Session boot fetch drives the global LoadingOverlay; render nothing here.
    return null;
  }
  return <Navigate to="/chat" replace />;
}
