import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders assistant/system chat content as Markdown - the industry-standard way chat
 * assistants format replies (headings, bold labels, bullet lists, tables). Raw HTML is
 * intentionally NOT enabled (react-markdown's safe default), so model output cannot inject
 * markup; only GitHub-flavored Markdown structure is rendered. Links open in a new tab.
 *
 * Tables are wrapped for horizontal scroll on narrow viewports (wide comparison grids).
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  const components: Components = {
    a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
    table: ({ node: _node, ...props }) => (
      <div className="proseTableScroll">
        <table {...props} />
      </div>
    ),
  };

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
