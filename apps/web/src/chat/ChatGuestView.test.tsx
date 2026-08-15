import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatGuestView } from './ChatGuestView';
import { previewChatSuggestions } from '../fixtures/preview';

vi.mock('../api/client', () => ({ YAHOO_LOGIN_URL: '/auth/yahoo' }));

const sessionMock = vi.hoisted(() => ({
  value: { status: 'disconnected' } as Record<string, unknown>,
}));
vi.mock('../context/SessionContext', () => ({
  useSession: () => ({ session: sessionMock.value }),
}));

describe('ChatGuestView', () => {
  it('offers a Yahoo sign-in CTA that begins OAuth', () => {
    sessionMock.value = { status: 'disconnected' };
    render(<ChatGuestView />);

    const cta = screen.getByRole('link', { name: 'Sign in with Yahoo' });
    expect(cta).toHaveAttribute('href', '/auth/yahoo');
    expect(screen.getByRole('heading', { name: /theshowgpt/i })).toBeInTheDocument();
  });

  it('previews the starter prompts, leading with the free-agent research prompt, each linking to sign-in', () => {
    sessionMock.value = { status: 'disconnected' };
    render(<ChatGuestView />);

    const chips = screen.getAllByRole('link', { name: /^Sign in with Yahoo to ask:/ });
    expect(chips).toHaveLength(previewChatSuggestions.length);
    expect(chips[0]).toHaveTextContent(previewChatSuggestions[0]);
    expect(chips[0]).toHaveTextContent(/FantasyPros rest-of-season rankings/i);
    for (const chip of chips) expect(chip).toHaveAttribute('href', '/auth/yahoo');
  });

  it('acknowledges an expired session instead of a cold welcome', () => {
    sessionMock.value = { status: 'disconnected', sessionExpired: true };
    render(<ChatGuestView />);

    expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    expect(screen.getByText(/your yahoo sign-in expired/i)).toBeInTheDocument();
  });
});
