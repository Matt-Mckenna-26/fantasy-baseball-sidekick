import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ChatRole } from '@fcm/contracts';
import { previewChatHistory, previewChatSuggestions } from '../fixtures/preview';
import styles from './ChatPage.module.css';

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
 * SEAM(mock-api): this stands in for `client.sendChatMessage(req)` and returns
 * the same `ChatMessage` DTO the API will return. Swap this call for the real
 * client function once the chat endpoint exists - no UI changes required.
 */
function previewReply(userText: string): Promise<ChatMessage> {
  const reply: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content:
      `Here's how I'd think about "${userText.trim()}": weigh recent form, matchup, and park factors, ` +
      `then favor the higher-floor option on days you need safety. ` +
      `(Live analysis lights up once your Yahoo league data is connected.)`,
    createdAt: new Date().toISOString(),
  };
  return new Promise((resolve) => setTimeout(() => resolve(reply), 600));
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
  const [messages, setMessages] = useState<ChatMessage[]>(previewChatHistory);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

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
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setThinking(true);
    try {
      const reply = await previewReply(trimmed);
      setMessages((prev) => [...prev, reply]);
    } finally {
      setThinking(false);
    }
  }

  const showSuggestions = messages.filter((m) => m.role === 'user').length === 0;
  const canSend = Boolean(input.trim()) && !thinking;

  return (
    <section className={styles.chat}>
      <div className={styles.log}>
        {messages.map((message) => (
          <div key={message.id} className={`${styles.row} ${rowClassByRole[message.role]}`}>
            <div className={`${styles.bubble} ${bubbleClassByRole[message.role]}`}>
              {message.content}
            </div>
          </div>
        ))}
        {thinking && (
          <div className={`${styles.row} ${styles.rowAssistant}`}>
            <div className={`${styles.bubble} ${styles.bubbleAssistant} ${styles.bubbleThinking}`}>
              <span className={styles.dot} />
              <span className={styles.dot} />
              <span className={styles.dot} />
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
