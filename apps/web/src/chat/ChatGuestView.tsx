import { YAHOO_LOGIN_URL } from '../api/client';
import { useSession } from '../context/SessionContext';
import { previewChatSuggestions } from '../fixtures/preview';
import { ChatBackdrop } from './ChatBackdrop';
import styles from './chat.module.css';

/**
 * Signed-out /chat view. Mirrors the empty-chat hero (full-bleed star-field + a centered
 * stack) but swaps the composer for a Yahoo sign-in CTA. The suggestion chips preview what
 * the co-manager can do; each links into the read-only OAuth flow so a guest can start from
 * any of them.
 */
export function ChatGuestView() {
  const { session } = useSession();
  const expired = session.status === 'disconnected' && session.sessionExpired;

  return (
    <div className={styles.stage}>
      <div className={styles.backdropHost} aria-hidden="true">
        <ChatBackdrop />
      </div>
      <div className={styles.thread}>
        <div className={styles.chat} data-empty>
          <div className={styles.dock}>
            <h1 className={styles.greeting}>
              {expired ? (
                'Welcome back'
              ) : (
                <>
                  Meet <span className={styles.greetingAccent}>TheShowGPT</span>
                </>
              )}
            </h1>
            <p className={styles.guestLede}>
              {expired
                ? 'Your Yahoo sign-in expired. Sign in again to pick up where you left off — read-only, we never make a move for you.'
                : 'Your AI fantasy baseball co-manager. Sign in with Yahoo for grounded, data-driven advice on your league — read-only, we never make a move for you.'}
            </p>
            <a className={styles.signIn} href={YAHOO_LOGIN_URL}>
              <span className={styles.signInMark} aria-hidden="true">
                Y!
              </span>
              Sign in with Yahoo
            </a>
            <p className={styles.guestSuggestionsLabel}>
              Once you&rsquo;re in, ask things like&hellip;
            </p>
            <div className={styles.suggestions}>
              {previewChatSuggestions.map((suggestion) => (
                <a
                  key={suggestion}
                  className={styles.suggestion}
                  href={YAHOO_LOGIN_URL}
                  aria-label={`Sign in with Yahoo to ask: ${suggestion}`}
                >
                  {suggestion}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
