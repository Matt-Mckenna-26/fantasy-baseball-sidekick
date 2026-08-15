import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CitedSource } from '@fcm/contracts';
import { SourceBadges } from './SourceBadges';

const sources: CitedSource[] = [
  {
    index: 1,
    title: 'Alonso to Baltimore',
    url: 'https://mlb.com/alonso',
    domain: 'mlb.com',
    publishedDate: '2026-08-01',
  },
  { index: 2, title: 'Signing analysis', url: 'https://espn.com/alonso', domain: 'espn.com' },
];

describe('SourceBadges', () => {
  it('renders one clickable badge per source that opens the article in a new, isolated tab', () => {
    render(<SourceBadges sources={sources} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', 'https://mlb.com/alonso');
    // New tab + isolated (chat stays put; the opened page can't touch this window).
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    // Title + hostname are both shown.
    expect(screen.getByText('Alonso to Baltimore')).toBeInTheDocument();
    expect(screen.getByText('mlb.com')).toBeInTheDocument();
    expect(screen.getByText('espn.com')).toBeInTheDocument();
  });

  it('renders nothing when there are no sources', () => {
    const { container } = render(<SourceBadges sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
