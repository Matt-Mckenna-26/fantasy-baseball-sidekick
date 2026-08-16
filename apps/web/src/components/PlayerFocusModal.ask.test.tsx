import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskTheShowGptButton } from './PlayerFocusModal';
import { playerResearchPrompt } from '../lib/chatAsk';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

describe('AskTheShowGptButton', () => {
  it('routes to chat with a rostered-player research prompt', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AskTheShowGptButton playerName="Aaron Judge" onMyTeam />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Ask TheShowGPT about Aaron Judge' }));

    const expected = `/chat?ask=${encodeURIComponent(playerResearchPrompt('Aaron Judge', true))}`;
    expect(screen.getByTestId('location')).toHaveTextContent(expected);
  });

  it('routes to chat with an add-value prompt when the player is not on my team', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AskTheShowGptButton playerName="Shohei Ohtani" onMyTeam={false} />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Ask TheShowGPT about Shohei Ohtani' }));

    const expected = `/chat?ask=${encodeURIComponent(playerResearchPrompt('Shohei Ohtani', false))}`;
    expect(screen.getByTestId('location')).toHaveTextContent(expected);
  });
});
