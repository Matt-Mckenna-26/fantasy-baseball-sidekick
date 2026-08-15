import type { PropsWithChildren, ReactNode } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import styles from './chat.module.css';

/**
 * Human-friendly labels for the read-only tools the co-manager can call, shown as live
 * activity cards while a reply is in flight. Unknown/new tools fall back to a generic verb.
 */
export const TOOL_LABELS: Record<string, string> = {
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

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? 'Gathering data';
}

/** Shown while the co-manager is thinking or composing the reply (no tool actively running). */
export const THINKING_LABEL = 'Thinking';

type RowState = 'loading' | 'done' | 'failed';

/**
 * A tool label with only its leading verb (e.g. "Scoring", "Checking") highlighted and
 * shimmering while the step is active; once the step finishes the whole label is static text.
 */
function VerbLabel({ label, active }: { label: string; active: boolean }) {
  const space = label.indexOf(' ');
  const verb = space === -1 ? label : label.slice(0, space);
  const rest = space === -1 ? '' : label.slice(space);
  return (
    <span className={styles.activityLabel}>
      {active ? <span className={styles.activityVerb}>{verb}</span> : verb}
      {rest}
    </span>
  );
}

function ActivityStatusIcon({ state }: { state: RowState }) {
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
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M4 8h8"
            />
          )}
        </svg>
      )}
    </span>
  );
}

/** One activity line, reused for the live panel, the composing placeholder, and the summary. */
export function ActivityRow({
  label,
  state,
  active = false,
}: {
  label: string;
  state: RowState;
  active?: boolean;
}) {
  return (
    <div
      className={`${styles.activityRow} ${active ? styles.activityRowActive : ''} ${
        state === 'done' ? styles.activityRowDone : ''
      }`}
    >
      <ActivityStatusIcon state={state} />
      <VerbLabel label={label} active={state === 'loading'} />
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

/** Pretty-print a JSON string for the expandable detail; fall back to the raw text
 *  (e.g. a truncated result that no longer parses) or empty when there's nothing. */
function formatJson(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

// Tokenizes pretty-printed JSON into keys, strings, numbers, and literals for coloring.
const JSON_TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Render a JSON string as syntax-highlighted React nodes (keys/strings/numbers/literals). */
function highlightJson(json: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  JSON_TOKEN.lastIndex = 0;
  while ((match = JSON_TOKEN.exec(json)) !== null) {
    if (match.index > last) nodes.push(json.slice(last, match.index));
    if (match[1] !== undefined) {
      const isKey = match[2] !== undefined;
      nodes.push(
        <span key={key++} className={isKey ? styles.jsonKey : styles.jsonString}>
          {match[1]}
        </span>,
      );
      if (isKey) nodes.push(match[2]);
    } else if (match[3] !== undefined) {
      nodes.push(
        <span key={key++} className={styles.jsonLiteral}>
          {match[3]}
        </span>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <span key={key++} className={styles.jsonNumber}>
          {match[4]}
        </span>,
      );
    }
    last = JSON_TOKEN.lastIndex;
  }
  if (last < json.length) nodes.push(json.slice(last));
  return nodes;
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" className={styles.toolChevron} aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 4l4 4-4 4"
      />
    </svg>
  );
}

/** The animated dots trailing a tool that's still running. */
function RunningDots() {
  return (
    <span className={styles.ellipsis} aria-hidden="true">
      <span className={styles.ellipsisDot} />
      <span className={styles.ellipsisDot} />
      <span className={styles.ellipsisDot} />
    </span>
  );
}

/**
 * Renders one tool call as its own glass bubble with a glowing verb. While the turn runs the
 * bubble shows a spinner; once finished it flips to a check (or a dash on failure). A finished
 * tool that captured its request/output becomes an expandable bubble, so a curious user can
 * inspect exactly what the co-manager asked for and got back.
 */
export function ToolActivityFallback({
  toolName,
  status,
  isError,
  argsText,
  result,
}: ToolCallMessagePartProps) {
  const running = status.type === 'running' || status.type === 'requires-action';
  const state: RowState = running ? 'loading' : isError ? 'failed' : 'done';
  const label = toolLabel(toolName);

  const request = formatJson(argsText);
  const output = formatJson((result as { output?: string } | undefined)?.output);
  const expandable = !running && (request !== '' || output !== '');

  const head = (
    <>
      <ActivityStatusIcon state={state} />
      <VerbLabel label={label} active={running} />
      {running ? <RunningDots /> : expandable ? <Chevron /> : null}
    </>
  );

  if (!expandable) {
    return (
      <div className={`${styles.toolBubble} ${running ? styles.toolBubbleActive : ''}`}>
        <div className={styles.toolBubbleHead}>{head}</div>
      </div>
    );
  }

  return (
    <details className={styles.toolBubble}>
      <summary className={styles.toolBubbleHead}>{head}</summary>
      <div className={styles.toolDetailBody}>
        {request !== '' ? (
          <section className={styles.toolDetailSection}>
            <h4 className={styles.toolDetailHeading}>Request</h4>
            <pre className={styles.toolDetailPre}>{highlightJson(request)}</pre>
          </section>
        ) : null}
        {output !== '' ? (
          <section className={styles.toolDetailSection}>
            <h4 className={styles.toolDetailHeading}>Result</h4>
            <pre className={styles.toolDetailPre}>{highlightJson(output)}</pre>
          </section>
        ) : null}
      </div>
    </details>
  );
}

/** Stacks the consecutive tool-call parts of one reply as individual bubbles. */
export function ToolActivityGroup({
  children,
}: PropsWithChildren<{ startIndex: number; endIndex: number }>) {
  return <div className={styles.toolStack}>{children}</div>;
}
