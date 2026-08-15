import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react';
import { useEffect, useRef, useState } from 'react';
import type { CitedSource, MentionedPlayer } from '@fcm/contracts';
import { Markdown } from '../components/Markdown';
import { MentionedPlayers } from '../components/MentionedPlayers';
import { useSession } from '../context/SessionContext';
import { previewChatSuggestions } from '../fixtures/preview';
import { useChatControls, useChatFooter } from './ChatRuntimeProvider';
import {
  ActivityRow,
  ToolActivityFallback,
  ToolActivityGroup,
  WebSearchToolCard,
} from './ToolActivityCard';
import { SourceBadges } from './SourceBadges';
import styles from './chat.module.css';

function SendIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.sendIcon}>
      <path
        fill="currentColor"
        d="M8.5 3.2 16.8 9.1c.4.3.4.9 0 1.2L8.5 16.2c-.5.4-1.2 0-1.2-.6V12H4.5c-.6 0-1-.4-1-1V9c0-.6.4-1 1-1h2.8V3.8c0-.6.7-1 1.2-.6Z"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.sendIcon}>
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={styles.copyIcon}>
      <rect
        x="7"
        y="7"
        width="9"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4 13V4.8A1.8 1.8 0 0 1 5.8 3H12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be denied; the button is a convenience, not a requirement.
    }
  };

  return (
    <button
      type="button"
      className={styles.copyButton}
      onClick={() => void onCopy()}
      aria-label={copied ? 'Copied' : 'Copy reply'}
    >
      {copied ? 'Copied' : <CopyIcon />}
    </button>
  );
}

/** User text: rendered verbatim inside the user bubble (no Markdown). */
function UserText({ text }: { text: string }) {
  return <>{text}</>;
}

/** Assistant text: Markdown prose, but nothing while the reply has not started streaming
 *  (so no empty bubble flashes before the first token). Inline [[s:N]] citation markers are
 *  rendered as numbered pills that link to the cited article (see Markdown `citations`). */
function AssistantText({ text }: { text: string }) {
  const sources = useAuiState(
    (s) => s.message.metadata.custom.sourcesCited as CitedSource[] | undefined,
  );
  if (!text.trim()) return null;
  return (
    <div className={styles.assistantBlock}>
      <div className={`${styles.bubble} ${styles.bubbleAssistant}`}>
        <Markdown className={styles.prose} {...(sources?.length ? { citations: sources } : {})}>
          {text}
        </Markdown>
      </div>
      <CopyButton text={text} />
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className={`${styles.row} ${styles.rowUser}`}>
      <div className={styles.messageCol}>
        <div className={`${styles.bubble} ${styles.bubbleUser}`}>
          <MessagePrimitive.Parts components={{ Text: UserText }} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

/** The "Thinking" placeholder shown while the reply is composing. */
function ComposingRow() {
  const label = useAuiState((s) => s.message.metadata.custom.composingLabel as string | null);
  if (!label) return null;
  return (
    <div className={styles.activityPanel} aria-live="polite" aria-busy="true">
      <ActivityRow label={label} state="loading" active />
    </div>
  );
}

/** "Players mentioned" citation cards under a reply, fed by the shared league stat pool. */
function MentionedFooter() {
  const { pool, onAnalyze } = useChatFooter();
  const players = useAuiState(
    (s) => s.message.metadata.custom.playersMentioned as MentionedPlayer[] | undefined,
  );
  if (!players || players.length === 0) return null;
  return <MentionedPlayers players={players} pool={pool} onAnalyze={onAnalyze} />;
}

/** "Sources" badges under a reply that used web_search, fed by the resolved citation list. */
function SourcesFooter() {
  const sources = useAuiState(
    (s) => s.message.metadata.custom.sourcesCited as CitedSource[] | undefined,
  );
  if (!sources || sources.length === 0) return null;
  return <SourceBadges sources={sources} />;
}

/** Retry control under a failed assistant turn. */
function FailedRetry() {
  const failed = useAuiState((s) => s.message.metadata.custom.failed === true);
  const id = useAuiState((s) => s.message.id);
  const { retry, busy } = useChatControls();
  if (!failed) return null;
  return (
    <button type="button" className={styles.retryButton} onClick={() => retry(id)} disabled={busy}>
      Try again
    </button>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className={`${styles.row} ${styles.rowAssistant}`}>
      <div className={styles.messageCol}>
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            tools: { Fallback: ToolActivityFallback, by_name: { web_search: WebSearchToolCard } },
            ToolGroup: ToolActivityGroup,
          }}
        />
        <ComposingRow />
        <FailedRetry />
        <SourcesFooter />
        <MentionedFooter />
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  const { busy, stop } = useChatControls();

  return (
    <ComposerPrimitive.Root className={styles.composer}>
      <div className={styles.inputShell}>
        <ComposerPrimitive.Input
          className={styles.input}
          placeholder="Ask a question about your team…"
          aria-label="Ask a question about your team"
          minRows={1}
          maxRows={6}
          autoFocus
        />
        <ChatMenu />
        {busy ? (
          <button
            type="button"
            className={styles.sendButton}
            aria-label="Stop generating"
            onClick={stop}
          >
            <StopIcon />
          </button>
        ) : (
          <ComposerPrimitive.Send className={styles.sendButton} aria-label="Send message">
            <SendIcon />
          </ComposerPrimitive.Send>
        )}
      </div>
    </ComposerPrimitive.Root>
  );
}

const archivedDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/**
 * Overflow menu for managing the transcript: clear the current chat, archive it and start
 * fresh, or reopen/delete a past thread. Only appears once there's something to manage. The
 * destructive actions (clear, delete) confirm first since neither can be undone.
 */
function ChatMenu() {
  const { hasMessages, busy, archives, archiveAndClear, clear, restore, deleteArchive } =
    useChatControls();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!hasMessages && archives.length === 0) return null;

  const onClear = () => {
    if (window.confirm('Clear this chat? This cannot be undone.')) {
      clear();
      setOpen(false);
    }
  };
  const onArchive = () => {
    archiveAndClear();
    setOpen(false);
  };
  const onRestore = (id: string) => {
    restore(id);
    setOpen(false);
  };
  const onDelete = (id: string) => {
    if (window.confirm('Delete this archived chat? This cannot be undone.')) deleteArchive(id);
  };

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.menuButton}
        aria-label="Chat options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={styles.menuIcon}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="14" height="3.2" rx="1.1" />
          <path d="M4.4 7.2h11.2V15a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 15z" />
          <path d="M8.1 10.4h3.8" />
        </svg>
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={onArchive}
            disabled={!hasMessages || busy}
          >
            Archive &amp; start new
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={onClear}
            disabled={!hasMessages || busy}
          >
            Clear chat
          </button>

          {archives.length > 0 && (
            <div className={styles.menuArchives}>
              <p className={styles.menuLabel}>Archived</p>
              <ul className={styles.archiveList}>
                {archives.map((thread) => (
                  <li key={thread.id} className={styles.archiveItem}>
                    <button
                      type="button"
                      className={styles.archiveOpen}
                      onClick={() => onRestore(thread.id)}
                      disabled={busy}
                      title={thread.title}
                      aria-label={`Open archived chat: ${thread.title}`}
                    >
                      <span className={styles.archiveTitle}>{thread.title}</span>
                      <span className={styles.archiveDate}>
                        {archivedDate.format(new Date(thread.archivedAt))}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={styles.archiveDelete}
                      aria-label={`Delete archived chat: ${thread.title}`}
                      onClick={() => onDelete(thread.id)}
                    >
                      <svg
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                        className={styles.archiveDeleteIcon}
                      >
                        <path
                          fill="currentColor"
                          d="M6 6l8 8M14 6l-8 8"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The headless chat surface: an auto-scrolling message log plus a single always-mounted glass
 * composer. When the thread is empty the composer floats to the center under an animated
 * greeting; on the first send it docks to the bottom and the log takes over.
 */
export function ChatThread() {
  const { session } = useSession();
  const league = session.status === 'connected' ? session.selectedLeague : null;
  const greetingSubject = league?.teamName ?? league?.name;
  const isEmpty = useAuiState((s) => s.thread.isEmpty);

  return (
    <ThreadPrimitive.Root className={styles.chat} data-empty={isEmpty || undefined}>
      <ThreadPrimitive.Viewport className={styles.log} autoScroll>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        <div className={styles.logSpacer} aria-hidden="true" />
      </ThreadPrimitive.Viewport>

      <ThreadPrimitive.ScrollToBottom
        className={styles.scrollToBottom}
        aria-label="Scroll to latest"
      >
        ↓
      </ThreadPrimitive.ScrollToBottom>

      <div className={styles.dock}>
        <ThreadPrimitive.Empty>
          <h1 className={styles.greeting}>
            {greetingSubject ? (
              <>
                How can we help <span className={styles.greetingAccent}>{greetingSubject}</span>{' '}
                today?
              </>
            ) : (
              'How can we help you today?'
            )}
          </h1>
        </ThreadPrimitive.Empty>

        <Composer />

        <ThreadPrimitive.Empty>
          <div className={styles.suggestions}>
            {previewChatSuggestions.map((suggestion) => (
              <ThreadPrimitive.Suggestion
                key={suggestion}
                prompt={suggestion}
                className={styles.suggestion}
              >
                {suggestion}
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        </ThreadPrimitive.Empty>
      </div>
    </ThreadPrimitive.Root>
  );
}
