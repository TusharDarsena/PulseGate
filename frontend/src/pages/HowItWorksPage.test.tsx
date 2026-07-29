import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MARKETPLACE_CONTRACT_ID,
  STELLAR_EXPLORER_URL,
  TICKET_CONTRACT_ID,
} from '../lib/constants';
import { HowItWorksPage } from './HowItWorksPage';

describe('HowItWorksPage', () => {
  afterEach(cleanup);

  it('renders the public lifecycle and authority boundary', () => {
    render(
      <MemoryRouter>
        <HowItWorksPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Ticket truth lives on Stellar.',
    );
    expect(screen.getByRole('heading', { name: 'The ticket lifecycle' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What Stellar controls' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What Supabase accelerates' })).toBeInTheDocument();
    expect(screen.getByText(/Testnet XLM has no monetary value/i)).toBeInTheDocument();
  });

  it('uses environment-backed contract IDs and explorer links', () => {
    render(
      <MemoryRouter>
        <HowItWorksPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: TICKET_CONTRACT_ID })).toHaveAttribute(
      'href',
      `${STELLAR_EXPLORER_URL}/contract/${TICKET_CONTRACT_ID}`,
    );
    expect(screen.getByRole('link', { name: MARKETPLACE_CONTRACT_ID })).toHaveAttribute(
      'href',
      `${STELLAR_EXPLORER_URL}/contract/${MARKETPLACE_CONTRACT_ID}`,
    );
  });

  it('links to the browse route and the existing protected organizer destination', () => {
    render(
      <MemoryRouter>
        <HowItWorksPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Browse attendee flow' })).toHaveAttribute(
      'href',
      '/events',
    );
    expect(screen.getByRole('link', { name: 'Start organizer flow' })).toHaveAttribute(
      'href',
      '/organizer/events',
    );
  });
});
