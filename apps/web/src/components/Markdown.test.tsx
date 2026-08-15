import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CitedSource } from '@fcm/contracts';
import { Markdown } from './Markdown';

const sources: CitedSource[] = [
  { index: 1, title: 'Alonso to Baltimore', url: 'https://mlb.com/alonso', domain: 'mlb.com' },
];

describe('Markdown citations', () => {
  it('renders [[s:N]] as a numbered pill linking to the source in a new, isolated tab', () => {
    render(<Markdown citations={sources}>{'He is an Oriole now[[s:1]].'}</Markdown>);

    const link = screen.getByRole('link');
    expect(link).toHaveTextContent('1');
    expect(link).toHaveAttribute('href', 'https://mlb.com/alonso');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    expect(link).toHaveAttribute('title', 'Alonso to Baltimore — mlb.com');
  });

  it('drops citation markers with no matching source rather than showing raw syntax', () => {
    const { container } = render(<Markdown citations={sources}>{'Bogus[[s:99]] claim.'}</Markdown>);
    expect(container.textContent).toBe('Bogus claim.');
    expect(container.querySelector('a')).toBeNull();
  });

  it('leaves [[s:N]] untouched (no crash) when no citations are provided', () => {
    const { container } = render(<Markdown>{'Text with [[s:1]] marker.'}</Markdown>);
    expect(container.textContent).toContain('[[s:1]]');
  });

  it('still opens ordinary links in a new tab', () => {
    render(<Markdown>{'See [the docs](https://example.com/x).'}</Markdown>);
    const link = screen.getByRole('link', { name: 'the docs' });
    expect(link).toHaveAttribute('href', 'https://example.com/x');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('Markdown Value+ glossary', () => {
  it('renders "Value+" mentions as a hoverable term (not a link) with the explainer', () => {
    const { container } = render(<Markdown>{'His Value+ 126 leads your staff.'}</Markdown>);

    const term = container.querySelector('abbr');
    expect(term).not.toBeNull();
    expect(term).toHaveTextContent('Value+');
    expect(term?.getAttribute('title')).toMatch(/100 = league average/i);
    // The surrounding prose (and the number) survive intact; it isn't turned into a link.
    expect(container.textContent).toBe('His Value+ 126 leads your staff.');
    expect(container.querySelector('a')).toBeNull();
  });
});
