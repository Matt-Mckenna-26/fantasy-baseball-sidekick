import { useState } from 'react';
import type { CitedSource } from '@fcm/contracts';
import styles from './chat.module.css';

/**
 * ChatGPT-style "Sources" row shown under an assistant reply that used web_search: a wrap of
 * clickable glass badges, one per cited article. Each badge shows the site's favicon, the
 * article title, and its hostname, and is a plain anchor that opens the article in a NEW tab
 * (`rel="noopener noreferrer"`), so the chat thread stays focused and untouched. The number
 * matches the inline [[s:N]] pill in the prose.
 */
export function SourceBadges({ sources }: { sources: CitedSource[] }) {
  if (sources.length === 0) return null;
  return (
    <section className={styles.sources} aria-label="Sources">
      <span className={styles.sourcesLabel}>Sources</span>
      <div className={styles.sourceList}>
        {sources.map((source) => (
          <SourceBadge key={source.index} source={source} />
        ))}
      </div>
    </section>
  );
}

function SourceBadge({ source }: { source: CitedSource }) {
  const [iconFailed, setIconFailed] = useState(false);
  const letter = source.domain.charAt(0).toUpperCase() || '?';
  return (
    <a
      className={styles.sourceBadge}
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${source.title} — ${source.domain}`}
    >
      <span className={styles.sourceIndex}>{source.index}</span>
      {iconFailed ? (
        <span className={styles.sourceFavIconFallback} aria-hidden="true">
          {letter}
        </span>
      ) : (
        <img
          className={styles.sourceFavIcon}
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(source.domain)}&sz=64`}
          alt=""
          width={16}
          height={16}
          loading="lazy"
          onError={() => setIconFailed(true)}
        />
      )}
      <span className={styles.sourceText}>
        <span className={styles.sourceTitle}>{source.title}</span>
        <span className={styles.sourceDomain}>{source.domain}</span>
      </span>
    </a>
  );
}
