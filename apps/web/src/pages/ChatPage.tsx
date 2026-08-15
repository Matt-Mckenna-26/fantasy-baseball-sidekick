import { ChatBackdrop } from '../chat/ChatBackdrop';
import { ChatGuestView } from '../chat/ChatGuestView';
import { ChatRuntimeProvider } from '../chat/ChatRuntimeProvider';
import { ChatThread } from '../chat/ChatThread';
import styles from '../chat/chat.module.css';
import { LeagueResourceNotice } from '../components/LeagueResourceNotice';
import { useSession } from '../context/SessionContext';

/**
 * The AI co-manager chat. Guests never see the composer: Yahoo has to be connected and a
 * closed-beta league selected, same gate as the other data pages. Streaming and persistence
 * live in [ChatRuntimeProvider]; the headless surface lives in [ChatThread].
 */
export function ChatPage() {
  const { session } = useSession();

  if (session.status === 'loading') {
    return <LeagueResourceNotice status="loading" />;
  }
  if (session.status === 'disconnected') {
    return <ChatGuestView />;
  }
  if (!session.selectedLeague) {
    return <LeagueResourceNotice status={session.leagues.length === 0 ? 'empty' : 'not_allowed'} />;
  }

  return (
    <div className={styles.stage}>
      <div className={styles.backdropHost} aria-hidden="true">
        <ChatBackdrop />
      </div>
      <div className={styles.thread}>
        <ChatRuntimeProvider>
          <ChatThread />
        </ChatRuntimeProvider>
      </div>
    </div>
  );
}
