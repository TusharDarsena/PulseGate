import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowsePage } from './BrowsePage';

vi.mock('../hooks/useEvents', () => ({
  useEvents: () => ({ events: [], loading: false, error: null }),
}));

describe('BrowsePage hero', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(cleanup);

  it('presents the trust positioning and scrolls to the catalogue', () => {
    render(
      <MemoryRouter>
        <BrowsePage onEventClick={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Event tickets people can trust.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Browse events' }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(screen.getByRole('link', { name: 'How PulseGate works' })).toHaveAttribute(
      'href',
      '/how-it-works',
    );
  });
});
