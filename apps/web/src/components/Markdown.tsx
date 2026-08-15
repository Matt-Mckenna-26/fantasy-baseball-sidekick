import type { Components } from 'react-markdown';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CitedSource } from '@fcm/contracts';
import styles from './Markdown.module.css';

/**
 * Renders assistant/system chat content as Markdown - the industry-standard way chat
 * assistants format replies (headings, bold labels, bullet lists, tables). Raw HTML is
 * intentionally NOT enabled (react-markdown's safe default), so model output cannot inject
 * markup; only GitHub-flavored Markdown structure is rendered. Links open in a new tab.
 *
 * When `citations` are provided, inline [[s:N]] markers the co-manager emits are rendered as
 * ChatGPT-style numbered citation pills that link to the source article (new tab, so the chat
 * stays put). Unknown indexes (a hallucinated [[s:99]]) are dropped rather than shown.
 *
 * Tables are wrapped for horizontal scroll on narrow viewports (wide comparison grids).
 */
export function Markdown({
  children,
  className,
  citations,
}: {
  children: string;
  className?: string;
  citations?: CitedSource[];
}) {
  const byIndex = new Map((citations ?? []).map((s) => [s.index, s]));
  // Rewrite [[s:N]] to a markdown link with a private `cite:` scheme so the `a` renderer can
  // style it as a pill and swap in the real (validated) source URL. Drop unknown indexes.
  const source = byIndex.size > 0 ? rewriteCitations(children, byIndex) : children;

  const components: Components = {
    a: ({ node: _node, href, children: linkChildren, ...props }) => {
      const citeIndex = parseCiteHref(href);
      if (citeIndex !== undefined) {
        const src = byIndex.get(citeIndex);
        if (!src) return null;
        return (
          <a
            href={src.url}
            target="_blank"
            rel="noreferrer noopener"
            className={styles.citation}
            title={`${src.title} — ${src.domain}`}
          >
            {citeIndex}
          </a>
        );
      }
      return (
        <a {...props} href={href} target="_blank" rel="noreferrer noopener">
          {linkChildren}
        </a>
      );
    },
    table: ({ node: _node, ...props }) => (
      <div className="proseTableScroll">
        <table {...props} />
      </div>
    ),
  };

  // react-markdown sanitizes URLs and would strip our private `cite:` scheme (leaving an
  // href-less anchor); let it through so the citation pills keep their handle to the source.
  const urlTransform = (url: string): string =>
    url.startsWith('cite:') ? url : defaultUrlTransform(url);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={urlTransform}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

/** Replace each [[s:N]] whose source exists with a `cite:N` markdown link; drop the rest. */
function rewriteCitations(text: string, byIndex: Map<number, CitedSource>): string {
  return text.replace(/\[\[s:(\d+)\]\]/g, (_m, digits: string) => {
    const idx = Number(digits);
    return byIndex.has(idx) ? `[${idx}](cite:${idx})` : '';
  });
}

/** Parse the citation index out of a `cite:N` href, or undefined for ordinary links. */
function parseCiteHref(href: string | undefined): number | undefined {
  if (!href) return undefined;
  const match = /^cite:(\d+)$/.exec(href);
  return match ? Number(match[1]) : undefined;
}
