import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatMessage, ChatRole, ChatToolEvent, ChatTurn, MentionedPlayer } from '@fcm/contracts';
import { sendChatMessage } from '../api/client';
import { useSession } from '../context/SessionContext';
import { useLeagueStatPool } from '../hooks/useLeagueStatPool';
import { Markdown } from '../components/Markdown';
import { MentionedPlayers } from '../components/MentionedPlayers';
import { previewChatHistory, previewChatSuggestions } from '../fixtures/preview';
import styles from './ChatPage.module.css';

/** One read-only tool the co-manager ran this turn, with its live/finished state. */
interface ToolActivity {
  name: string;
  done: boolean;
  ok: boolean;
}

/**
 * A transcript entry: a chat message plus any players the co-manager tagged in it and the
 * read-only tools it ran to produce it (kept for the collapsible activity summary).
 */
type ChatEntry = ChatMessage & {
  playersMentioned?: MentionedPlayer[];
  toolActivity?: ToolActivity[];
};

/** Where the transcript is persisted, and how many entries we keep (oldest trimmed first). */
const CHAT_STORAGE_KEY = 'theshowgpt.chat.v1';
const CHAT_HISTORY_CAP = 50;

/** Restore the persisted transcript (capped), falling back to the seeded preview history. */
function loadChatHistory(): ChatEntry[] {
  if (typeof window === 'undefined') return previewChatHistory;
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return previewChatHistory;
    const parsed = JSON.parse(raw) as ChatEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) return previewChatHistory;
    return parsed.slice(-CHAT_HISTORY_CAP);
  } catch {
    return previewChatHistory;
  }
}

/** Persist the transcript, trimming from the top so storage stays under the cap. */
function saveChatHistory(messages: ChatEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-CHAT_HISTORY_CAP)));
  } catch {
    // Storage full or unavailable: non-fatal, the transcript just won't persist this session.
  }
}

const rowClassByRole: Record<ChatRole, string> = {
  user: styles.rowUser ?? '',
  assistant: styles.rowAssistant ?? '',
  system: styles.rowSystem ?? '',
};

const bubbleClassByRole: Record<ChatRole, string> = {
  user: styles.bubbleUser ?? '',
  assistant: styles.bubbleAssistant ?? '',
  system: styles.bubbleSystem ?? '',
};

const INPUT_MAX_HEIGHT = 160;

/**
 * Human-friendly labels for the read-only tools the co-manager can call, shown as live
 * activity cards while a reply is in flight. Unknown/new tools fall back to a generic verb.
 */
const TOOL_LABELS: Record<string, string> = {
  get_league_standings: 'Checking the standings',
  get_matchups: 'Pulling matchup details',
  get_league_rosters: 'Reviewing rosters',
  get_league_team_stats: 'Comparing category strengths',
  get_team_stats: 'Analyzing team stats',
  get_league_player_stats: 'Benchmarking players',
  get_player_value: 'Scoring player value (Value+)',
  get_free_agents: 'Scanning the waiver wire',
  get_player_mlb_stats: 'Looking up MLB stats',
  get_player_news: 'Checking injury news',
  get_probable_starters: 'Checking probable starters',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? 'Gathering data';
}

/** Shown while the co-manager composes the final reply (no tool actively running). */
const COMPOSING_LABEL = 'Writing your answer';

/** Shown before the first tool call on a turn. */
const THINKING_LABEL = 'Thinking';

/**
 * Render streamed reply text without the raw [[p:Name]] player tags: unwrap any complete
 * tag to the plain name, and hide a trailing not-yet-closed tag fragment (e.g. "[[p:Aaron")
 * until it finishes streaming, so the marker syntax never flashes on screen. The final
 * `done` message carries the authoritative, already-stripped content.
 */
export function stripStreamingMentions(text: string): string {
  const unwrapped = text.replace(/\[\[p:([^\]]+)\]\]/g, '$1');
  const open = unwrapped.lastIndexOf('[[');
  return open !== -1 && unwrapped.indexOf(']]', open) === -1 ? unwrapped.slice(0, open) : unwrapped;
}

/** Map the local transcript to the contract's turn shape sent to the co-manager. */
function toTurns(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

function ActivityStatusIcon({ state }: { state: 'loading' | 'done' | 'failed' }) {
  return (
    <span className={styles.activityStatusSlot} aria-hidden="true">
      {state === 'loading' ? (
        <span className={styles.spinner} />
      ) : (
        <svg viewBox="0 0 16 16" className={styles.activityIcon}>
          {state === 'done' ? (
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.5 8.5 6.5 11.5 12.5 4.5"
            />
          ) : (
            <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 8h8" />
          )}
        </svg>
      )}
    </span>
  );
}

function ActivityRow({
  label,
  state,
  active = false,
}: {
  label: string;
  state: 'loading' | 'done' | 'failed';
  active?: boolean;
}) {
  return (
    <div
      className={`${styles.activityRow} ${active ? styles.activityRowActive : ''} ${
        state === 'done' ? styles.activityRowDone : ''
      }`}
    >
      <ActivityStatusIcon state={state} />
      <span className={styles.activityRowLabel}>{label}</span>
      {active && state === 'loading' ? (
        <span className={styles.ellipsis} aria-hidden="true">
          <span className={styles.ellipsisDot} />
          <span className={styles.ellipsisDot} />
          <span className={styles.ellipsisDot} />
        </span>
      ) : null}
    </div>
  );
}

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

export function ChatPage() {
  const { session } = useSession();
  const navigate = useNavigate();
  const selectedLeague = session.status === 'connected' ? session.selectedLeague : null;
  const leagueId = selectedLeague?.leagueId;
  const teamName = selectedLeague?.teamName;
  const leagueName = selectedLeague?.name;
  const [messages, setMessages] = useState<ChatEntry[]>(loadChatHistory);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Only fetch the league stat pool (for the rank cards) once a reply has actually tagged
  // players; it powers every message's "Players mentioned" section at the season window.
  const hasMentions = messages.some((m) => (m.playersMentioned?.length ?? 0) > 0);
  const statPool = useLeagueStatPool(leagueId, 'season', hasMentions);

  const analyzePlayers = (playerIds: string[]) => {
    if (playerIds.length === 0) return;
    navigate(`/stats?players=${encodeURIComponent(playerIds.join(','))}`);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, toolActivity, streamingText]);

  // Keep the transcript capped and mirrored to localStorage. When over the cap we trim the
  // oldest entries first; that state update re-runs this effect, which then persists.
  useEffect(() => {
    if (messages.length > CHAT_HISTORY_CAP) {
      setMessages((prev) => prev.slice(-CHAT_HISTORY_CAP));
      return;
    }
    saveChatHistory(messages);
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [input]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    const history = [...messages, userMessage];
    setMessages(history);
    setInput('');
    setThinking(true);
    setToolActivity([]);
    setStreamingText('');
    // Track activity locally so the finished list can be attached to the reply entry
    // (React state updates are async and would be stale when the promise resolves).
    const activity: ToolActivity[] = [];
    const onToolEvent = (event: ChatToolEvent) => {
      if (event.phase === 'start') {
        activity.push({ name: event.name, done: false, ok: false });
      } else {
        for (let i = activity.length - 1; i >= 0; i--) {
          const item = activity[i];
          if (item && item.name === event.name && !item.done) {
            activity[i] = { ...item, done: true, ok: event.ok ?? true };
            break;
          }
        }
      }
      setToolActivity(activity.map((a) => ({ ...a })));
    };
    try {
      const { message, playersMentioned } = await sendChatMessage(
        {
          messages: toTurns(history),
          ...(leagueId ? { leagueId } : {}),
          ...(teamName ? { teamName } : {}),
          ...(leagueName ? { leagueName } : {}),
        },
        {
          onToolEvent,
          onDelta: (text) => setStreamingText((prev) => prev + text),
          onReset: () => setStreamingText(''),
        },
      );
      setMessages((prev) => [
        ...prev,
        {
          ...message,
          ...(playersMentioned?.length ? { playersMentioned } : {}),
          ...(activity.length ? { toolActivity: activity } : {}),
        },
      ]);
    } catch {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content:
          'Sorry - I hit a snag reaching your league data. Make sure your Yahoo account is connected, then try again.',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setThinking(false);
      setToolActivity([]);
      setStreamingText('');
    }
  }

  const showSuggestions = messages.filter((m) => m.role === 'user').length === 0;
  const canSend = Boolean(input.trim()) && !thinking;
  // No tool is actively running: either before the first tool call or, notably, in the gap
  // after the last tool finishes while the co-manager writes the answer.
  const composing = thinking && toolActivity.every((tool) => tool.done);

  return (
    <section className={styles.chat}>
      <div className={styles.log}>
        {messages.map((message) => (
          <div key={message.id} className={`${styles.row} ${rowClassByRole[message.role]}`}>
            <div className={styles.messageCol}>
              {message.role !== 'user' && message.toolActivity && message.toolActivity.length > 0 ? (
                <details className={styles.activitySummary}>
                  <summary className={styles.activitySummaryLabel}>
                    Used {message.toolActivity.length}{' '}
                    {message.toolActivity.length === 1 ? 'tool' : 'tools'}
                  </summary>
                  <div className={styles.activityList}>
                    {message.toolActivity.map((tool, i) => (
                      <ActivityRow
                        key={`${tool.name}-${i}`}
                        label={toolLabel(tool.name)}
                        state={tool.ok ? 'done' : 'failed'}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
              <div className={`${styles.bubble} ${bubbleClassByRole[message.role]}`}>
                {message.role === 'user' ? (
                  message.content
                ) : (
                  <>
                    <Markdown className={styles.prose}>{message.content}</Markdown>
                    {message.playersMentioned && message.playersMentioned.length > 0 ? (
                      <MentionedPlayers
                        players={message.playersMentioned}
                        pool={statPool}
                        onAnalyze={analyzePlayers}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {thinking && (
          <div className={`${styles.row} ${styles.rowAssistant}`}>
            <div className={styles.messageCol}>
              <div className={styles.activityPanel} aria-live="polite" aria-busy="true">
                {toolActivity.map((tool, i) => (
                  <ActivityRow
                    key={`${tool.name}-${i}`}
                    label={toolLabel(tool.name)}
                    state={!tool.done ? 'loading' : tool.ok ? 'done' : 'failed'}
                    active={!tool.done}
                  />
                ))}
                {/* Once the answer starts streaming, drop the "writing" placeholder for the live text. */}
                {composing && !streamingText ? (
                  <ActivityRow
                    label={toolActivity.length === 0 ? THINKING_LABEL : COMPOSING_LABEL}
                    state="loading"
                    active
                  />
                ) : null}
              </div>
              {streamingText ? (
                <div className={`${styles.bubble} ${bubbleClassByRole.assistant}`}>
                  <Markdown className={styles.prose}>{stripStreamingMentions(streamingText)}</Markdown>
                </div>
              ) : null}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={styles.composerDock}>
        {showSuggestions && (
          <div className={styles.suggestions}>
            {previewChatSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.suggestion}
                onClick={() => void send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <div className={styles.inputShell}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={input}
              placeholder="Message TheShowGPT…"
              rows={1}
              aria-label="Message TheShowGPT"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
            />
            <button
              type="submit"
              className={styles.sendButton}
              disabled={!canSend}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
