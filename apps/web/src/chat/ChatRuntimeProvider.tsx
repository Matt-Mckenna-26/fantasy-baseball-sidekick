import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { ChatMessage, ChatTurn, CitedSource, MentionedPlayer } from '@fcm/contracts';
import { sendChatMessage } from '../api/client';
import { useSession } from '../context/SessionContext';
import { useLeagueStatPool, type LeagueStatPool } from '../hooks/useLeagueStatPool';
import { createSmoothReveal, stripStreamingMentions, type SmoothReveal } from './streaming';
import { THINKING_LABEL } from './ToolActivityCard';

/** One read-only tool the co-manager ran this turn, with its live/finished state. `args`
 *  (the request) and `result` (the output) back the expandable per-tool detail. */
export interface ToolActivity {
  name: string;
  done: boolean;
  ok: boolean;
  /** Raw JSON arguments the model passed to the tool. */
  args?: string;
  /** The tool's (truncated) JSON output. */
  result?: string;
}

/**
 * A transcript entry: a chat message plus any players the co-manager tagged in it and the
 * read-only tools it ran to produce it (kept for the collapsible activity summary). This is
 * the source of truth; assistant-ui renders a converted view of it.
 */
export type ChatEntry = ChatMessage & {
  playersMentioned?: MentionedPlayer[];
  /** Web articles the reply cited (via [[s:N]]), for clickable citation badges/pills. */
  sourcesCited?: CitedSource[];
  toolActivity?: ToolActivity[];
  /** True when this assistant turn failed and can be retried. */
  failed?: boolean;
};

/** Where the transcript is persisted, and how many entries we keep (oldest trimmed first). */
const CHAT_STORAGE_KEY = 'theshowgpt.chat.v1';
const CHAT_HISTORY_CAP = 50;

/** Restore the persisted transcript (capped). Empty when nothing is stored: the empty-state
 *  greeting stands in for a seeded welcome bubble. */
function loadChatHistory(): ChatEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-CHAT_HISTORY_CAP);
  } catch {
    return [];
  }
}

/** Persist the transcript, trimming from the top so storage stays under the cap. */
function saveChatHistory(messages: ChatEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(messages.slice(-CHAT_HISTORY_CAP)),
    );
  } catch {
    // Storage full or unavailable: non-fatal, the transcript just won't persist this session.
  }
}

/**
 * A past conversation the user set aside. Archives are deliberately lightweight: the heavy
 * tool `args`/`result` blobs are stripped (see `slimForArchive`) and the whole collection is
 * capped by count AND total bytes, so parking old chats can never blow the localStorage quota.
 */
export interface ArchivedThread {
  id: string;
  title: string;
  /** ISO 8601 timestamp of when it was archived. */
  archivedAt: string;
  messages: ChatEntry[];
}

const ARCHIVE_STORAGE_KEY = 'theshowgpt.chat.archive.v1';
/** Keep only a handful of recent archives, and never let them exceed this byte budget. */
const MAX_ARCHIVED_THREADS = 10;
const ARCHIVE_BYTE_BUDGET = 256 * 1024;

/** Approximate stored byte size of a value (UTF-8), used to enforce the archive budget. */
function byteLength(value: unknown): number {
  const json = JSON.stringify(value);
  try {
    return new TextEncoder().encode(json).length;
  } catch {
    return json.length;
  }
}

/**
 * Strip an archived thread down to what's worth keeping: the messages, tagged players, and
 * the tool NAMES/outcomes for context - but not the tool request/result JSON, which is by far
 * the largest field and pointless to retain in cold storage.
 */
function slimForArchive(messages: ChatEntry[]): ChatEntry[] {
  return messages.map((m) => {
    if (!m.toolActivity || m.toolActivity.length === 0) return m;
    const toolActivity = m.toolActivity.map((t) => ({ name: t.name, done: t.done, ok: t.ok }));
    return { ...m, toolActivity };
  });
}

/** A short, human title for an archive, from its first user message. */
function deriveTitle(messages: ChatEntry[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim().length > 0);
  const text = first?.content.trim() ?? 'Conversation';
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/** Enforce the archive caps: newest first, at most N threads, and within the byte budget. */
function capArchives(list: ArchivedThread[]): ArchivedThread[] {
  let capped = list.slice(0, MAX_ARCHIVED_THREADS);
  // Evict the oldest (tail) until the collection fits the budget; always keep at least one.
  while (capped.length > 1 && byteLength(capped) > ARCHIVE_BYTE_BUDGET) {
    capped = capped.slice(0, -1);
  }
  return capped;
}

function loadArchives(): ArchivedThread[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ARCHIVE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ArchivedThread[];
    return Array.isArray(parsed) ? capArchives(parsed) : [];
  } catch {
    return [];
  }
}

function saveArchives(archives: ArchivedThread[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archives));
  } catch {
    // Storage full or unavailable: non-fatal, archives just won't persist this session.
  }
}

/** Map the local transcript to the contract's turn shape sent to the co-manager. */
function toTurns(messages: ChatEntry[]): ChatTurn[] {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Convert one transcript entry to assistant-ui's message shape. Assistant replies expose the
 * tools they ran as `tool-call` parts (rendered as the activity trail) followed by the text
 * part; the players they tagged and the live "thinking/writing" label ride along in
 * `metadata.custom` so the message component can render the citation cards and placeholder.
 */
function convertEntry(
  entry: ChatEntry,
  idx: number,
  total: number,
  isRunning: boolean,
): ThreadMessageLike {
  const createdAt = new Date(entry.createdAt);
  if (entry.role === 'user') {
    return {
      role: 'user',
      id: entry.id,
      createdAt,
      content: [{ type: 'text', text: entry.content }],
    };
  }

  const activity = entry.toolActivity ?? [];
  const toolParts = activity.map((tool, i) => ({
    type: 'tool-call' as const,
    toolCallId: `${entry.id}-tool-${i}`,
    toolName: tool.name,
    argsText: tool.args ?? '',
    // A finished tool carries a result so the runtime marks the part complete (and the card
    // can expand to show the output); an in-flight tool has none, so within a running reply
    // it renders as still spinning.
    ...(tool.done ? { result: { ok: tool.ok, output: tool.result }, isError: !tool.ok } : {}),
  }));

  const streaming = isRunning && idx === total - 1;
  const displayText = streaming ? stripStreamingMentions(entry.content) : entry.content;
  const anyToolRunning = activity.some((tool) => !tool.done);
  const composing = streaming && !anyToolRunning && displayText.trim() === '';
  // Always show "Thinking" while composing - a single short word that never wraps, whether or
  // not tools ran first.
  const composingLabel = composing ? THINKING_LABEL : null;

  return {
    role: entry.role,
    id: entry.id,
    createdAt,
    content: [...toolParts, { type: 'text', text: displayText }],
    metadata: {
      custom: {
        playersMentioned: entry.playersMentioned ?? [],
        sourcesCited: entry.sourcesCited ?? [],
        composingLabel,
        failed: entry.failed === true,
      },
    },
  };
}

/** Shared data the assistant message footer needs to render the "Players mentioned" cards. */
type ChatFooterValue = { pool: LeagueStatPool; onAnalyze: (playerIds: string[]) => void };
const ChatFooterContext = createContext<ChatFooterValue | null>(null);

export function useChatFooter(): ChatFooterValue {
  const ctx = useContext(ChatFooterContext);
  if (!ctx) throw new Error('useChatFooter must be used within ChatRuntimeProvider');
  return ctx;
}

/** Chat-management controls (clear / archive / restore) exposed to the thread header. */
export interface ChatControls {
  /** Whether the active thread has anything to clear or archive. */
  hasMessages: boolean;
  /** True while a reply is streaming - controls are disabled to avoid mid-stream edits. */
  busy: boolean;
  archives: ArchivedThread[];
  /** Archive the current thread (if any), then start an empty one. */
  archiveAndClear: () => void;
  /** Discard the current thread without archiving. */
  clear: () => void;
  /** Reopen an archived thread (parking the current one first so nothing is lost). */
  restore: (id: string) => void;
  deleteArchive: (id: string) => void;
  /** Re-run the user turn that produced a failed assistant reply. */
  retry: (assistantId: string) => void;
  /** Abort the in-flight reply. */
  stop: () => void;
}
const ChatControlsContext = createContext<ChatControls | null>(null);

export function useChatControls(): ChatControls {
  const ctx = useContext(ChatControlsContext);
  if (!ctx) throw new Error('useChatControls must be used within ChatRuntimeProvider');
  return ctx;
}

const ERROR_REPLY =
  'Sorry - I hit a snag reaching your league data. Make sure your Yahoo account is connected, then try again.';

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';
}

/**
 * Owns the chat transcript state and bridges it to assistant-ui via an external-store runtime.
 * Keeps our bespoke NDJSON streaming client, tool-activity, and localStorage persistence; the
 * headless UI ([ChatThread]) just renders the converted messages and drives `onNew`.
 */
export function ChatRuntimeProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const navigate = useNavigate();
  const league = session.status === 'connected' ? session.selectedLeague : null;
  const leagueId = league?.leagueId;
  const teamName = league?.teamName;
  const leagueName = league?.name;

  const [messages, setMessages] = useState<ChatEntry[]>(loadChatHistory);
  const [isRunning, setIsRunning] = useState(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const abortRef = useRef<AbortController | null>(null);
  // Smoothly reveals streamed text (see createSmoothReveal); tracked so stop()/unmount can snap.
  const revealRef = useRef<SmoothReveal | null>(null);

  // Snap any in-flight reveal to full text if the component unmounts mid-stream.
  useEffect(() => () => revealRef.current?.cancel(), []);

  // Keep the transcript capped and mirrored to localStorage. When over the cap we trim the
  // oldest entries first; that state update re-runs this effect, which then persists.
  useEffect(() => {
    if (messages.length > CHAT_HISTORY_CAP) {
      setMessages((prev) => prev.slice(-CHAT_HISTORY_CAP));
      return;
    }
    saveChatHistory(messages);
  }, [messages]);

  const [archives, setArchives] = useState<ArchivedThread[]>(loadArchives);
  const archivesRef = useRef(archives);
  archivesRef.current = archives;
  useEffect(() => {
    saveArchives(archives);
  }, [archives]);

  // Snapshot the current thread into the (capped, slimmed) archive list. No-op when empty.
  const archiveCurrent = useCallback(() => {
    const current = messagesRef.current;
    if (current.length === 0) return;
    const entry: ArchivedThread = {
      id: crypto.randomUUID(),
      title: deriveTitle(current),
      archivedAt: new Date().toISOString(),
      messages: slimForArchive(current),
    };
    setArchives((prev) => capArchives([entry, ...prev]));
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  const archiveAndClear = useCallback(() => {
    archiveCurrent();
    setMessages([]);
  }, [archiveCurrent]);

  const restore = useCallback(
    (id: string) => {
      const target = archivesRef.current.find((a) => a.id === id);
      if (!target) return;
      // Park the current thread first so restoring never silently drops it.
      archiveCurrent();
      setArchives((prev) => prev.filter((a) => a.id !== id));
      setMessages(target.messages);
    },
    [archiveCurrent],
  );

  const deleteArchive = useCallback(
    (id: string) => setArchives((prev) => prev.filter((a) => a.id !== id)),
    [],
  );

  // Only fetch the league stat pool (for the rank cards) once a reply has actually tagged
  // players; it powers every message's "Players mentioned" section at the season window.
  const hasMentions = messages.some((m) => (m.playersMentioned?.length ?? 0) > 0);
  const pool = useLeagueStatPool(leagueId, 'season', hasMentions);
  const onAnalyze = useCallback(
    (playerIds: string[]) => {
      if (playerIds.length === 0) return;
      navigate(`/stats?players=${encodeURIComponent(playerIds.join(','))}`);
    },
    [navigate],
  );
  const footer = useMemo<ChatFooterValue>(() => ({ pool, onAnalyze }), [pool, onAnalyze]);

  const stop = useCallback(() => {
    // Snap the typing animation to full text, then abort the request.
    revealRef.current?.cancel();
    abortRef.current?.abort();
  }, []);

  const runTurn = useCallback(
    async (history: ChatEntry[]) => {
      // Page gate + this guard: never call the chat API without a connected, allowed league.
      if (!leagueId) return;

      const assistantId = crypto.randomUUID();
      setMessages([
        ...history,
        { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() },
      ]);
      setIsRunning(true);

      revealRef.current?.cancel();
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const patchAssistant = (patch: Partial<ChatEntry>) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));

      // Reveal streamed text as a smooth "fast typing" animation rather than snapping in whole
      // network chunks. It writes straight into this assistant entry's content.
      const reveal = createSmoothReveal((text) => patchAssistant({ content: text }));
      revealRef.current = reveal;

      // Track activity locally so the finished list can be attached to the reply entry
      // (React state updates are async and would be stale when the promise resolves).
      const activity: ToolActivity[] = [];
      try {
        const {
          message: reply,
          playersMentioned,
          sourcesCited,
        } = await sendChatMessage(
          {
            messages: toTurns(history),
            leagueId,
            ...(teamName ? { teamName } : {}),
            ...(leagueName ? { leagueName } : {}),
          },
          {
            signal: ac.signal,
            onToolEvent: (event) => {
              if (event.phase === 'start') {
                activity.push({
                  name: event.name,
                  done: false,
                  ok: false,
                  ...(event.args ? { args: event.args } : {}),
                });
              } else {
                for (let i = activity.length - 1; i >= 0; i--) {
                  const item = activity[i];
                  if (item && item.name === event.name && !item.done) {
                    activity[i] = {
                      ...item,
                      done: true,
                      ok: event.ok ?? true,
                      ...(event.result ? { result: event.result } : {}),
                    };
                    break;
                  }
                }
              }
              patchAssistant({ toolActivity: activity.map((a) => ({ ...a })) });
            },
            onDelta: (delta) => reveal.push(delta),
            onReset: () => reveal.reset(),
          },
        );
        // Attach the metadata now, but let the reveal finish typing the (sanitized) final text
        // so the reply lands smoothly instead of snapping to the full string.
        patchAssistant({
          failed: false,
          ...(playersMentioned?.length ? { playersMentioned } : {}),
          ...(sourcesCited?.length ? { sourcesCited } : {}),
          ...(activity.length ? { toolActivity: activity } : {}),
        });
        await reveal.finish(reply.content);
      } catch (err) {
        // Stop the typing loop first: on abort it snaps to whatever streamed; below we may
        // replace that with the error copy, so cancel must run before we set a terminal state.
        reveal.cancel();
        if (isAbortError(err)) {
          setMessages((prev) => {
            const last = prev.find((m) => m.id === assistantId);
            if (last && !last.content.trim()) {
              return prev.filter((m) => m.id !== assistantId);
            }
            return prev;
          });
        } else {
          patchAssistant({ content: ERROR_REPLY, failed: true });
        }
      } finally {
        if (revealRef.current === reveal) revealRef.current = null;
        if (abortRef.current === ac) {
          abortRef.current = null;
          setIsRunning(false);
        }
      }
    },
    [leagueId, teamName, leagueName],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim();
      if (!text || !leagueId) return;

      const userEntry: ChatEntry = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
      await runTurn([...messagesRef.current, userEntry]);
    },
    [runTurn, leagueId],
  );

  const retry = useCallback(
    (assistantId: string) => {
      const current = messagesRef.current;
      const idx = current.findIndex((m) => m.id === assistantId);
      if (idx < 1) return;
      const prior = current.slice(0, idx);
      if (prior[prior.length - 1]?.role !== 'user') return;
      void runTurn(prior);
    },
    [runTurn],
  );

  const controls = useMemo<ChatControls>(
    () => ({
      hasMessages: messages.length > 0,
      busy: isRunning,
      archives,
      archiveAndClear,
      clear,
      restore,
      deleteArchive,
      retry,
      stop,
    }),
    [
      messages.length,
      isRunning,
      archives,
      archiveAndClear,
      clear,
      restore,
      deleteArchive,
      retry,
      stop,
    ],
  );

  const runtime = useExternalStoreRuntime<ChatEntry>({
    messages,
    isRunning,
    onNew,
    onCancel: async () => stop(),
    convertMessage: (entry, idx) => convertEntry(entry, idx, messages.length, isRunning),
  });

  return (
    <ChatFooterContext.Provider value={footer}>
      <ChatControlsContext.Provider value={controls}>
        <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
      </ChatControlsContext.Provider>
    </ChatFooterContext.Provider>
  );
}
