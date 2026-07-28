import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ticket } from '../types';
import { MyTicketsPage } from './MyTicketsPage';

const mocks = vi.hoisted(() => ({
  events: [] as Array<{ eventId: string; dateUnix: number; endUnix: number; status: string }>,
  fetchOpenListingsByTicketIds: vi.fn(),
  onViewReceipt: vi.fn(),
  onViewTicket: vi.fn(),
}));

vi.mock('../components/tickets/TicketCard', () => ({
  TicketCard: ({ onListForSale }: { onListForSale?: (ticketId: string) => void }) => (
    <p>{onListForSale ? 'resale-enabled' : 'resale-unavailable'}</p>
  ),
}));

vi.mock('../components/tickets/TicketOperationRecovery', () => ({
  TicketOperationRecovery: () => null,
}));

vi.mock('../components/ui/LoadingSkeleton', () => ({
  CollectionSkeleton: () => null,
}));

vi.mock('../hooks/useScopedEvents', () => ({
  usePublishedEventsByIds: () => ({ events: mocks.events, loading: false, error: null }),
}));

vi.mock('../hooks/useTicketOperationRecovery', () => ({
  useTicketOperationRecovery: () => ({
    operations: [],
    busyOperationId: null,
    error: null,
    remember: vi.fn(),
    recover: vi.fn(),
  }),
}));

vi.mock('../lib/soroban', () => ({
  prepareCancelListing: vi.fn(),
  prepareListTicket: vi.fn(),
  prepareRefundTicket: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  fetchOpenListingsByTicketIds: mocks.fetchOpenListingsByTicketIds,
}));

vi.mock('../lib/ticketOperations', () => ({
  executeTicketOperation: vi.fn(),
  ticketOperationMessage: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: () => ({
    attendeeWallet: { readiness: 'idle', address: null, signFn: null },
    setTxState: vi.fn(),
  }),
}));

const missingProjectionTicket: Ticket = {
  ticketId: 'ticket-without-event-row',
  eventId: 'missing-event',
  owner: 'GATTENDEE',
  status: 'Active',
  purchasedAt: '2026-07-29T12:00:00.000Z',
  receiptOperationId: 'receipt-operation',
};

function renderPage(tickets: Ticket[] = [missingProjectionTicket]) {
  return render(
    <MyTicketsPage
      tickets={tickets}
      loadingTickets={false}
      errorTickets={null}
      onViewTicket={mocks.onViewTicket}
      onViewReceipt={mocks.onViewReceipt}
      onShowQR={vi.fn()}
      onBrowseMore={vi.fn()}
      invalidateTickets={vi.fn()}
      pendingSync={[]}
      retryPending={vi.fn()}
    />,
  );
}

describe('MyTicketsPage listing truth and missing event visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.events = [];
    mocks.fetchOpenListingsByTicketIds.mockResolvedValue([]);
  });

  it('keeps tickets with no event projection in a visible fallback group', async () => {
    renderPage();

    await waitFor(() => expect(mocks.fetchOpenListingsByTicketIds).toHaveBeenCalledWith([
      'ticket-without-event-row',
    ]));
    expect(await screen.findByRole('heading', { name: 'Tickets awaiting event details' })).toBeInTheDocument();
    expect(screen.getByText('ticket-without-event-row')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View ticket' }));
    fireEvent.click(screen.getByRole('button', { name: 'View receipt' }));
    expect(mocks.onViewTicket).toHaveBeenCalledWith('ticket-without-event-row');
    expect(mocks.onViewReceipt).toHaveBeenCalledWith('receipt-operation');
  });

  it('keeps resale actions unavailable and offers one retry after the batch lookup fails', async () => {
    mocks.events = [{
      eventId: 'active-event',
      dateUnix: 2_525_644_800,
      endUnix: 2_525_652_000,
      status: 'Active',
    }];
    mocks.fetchOpenListingsByTicketIds
      .mockRejectedValueOnce(new Error('Resale read model offline'))
      .mockResolvedValueOnce([]);
    renderPage([{ ...missingProjectionTicket, eventId: 'active-event' }]);

    expect(await screen.findByText('Resale status is unavailable.')).toBeInTheDocument();
    expect(screen.getByText('resale-unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry resale status' }));

    await waitFor(() => expect(mocks.fetchOpenListingsByTicketIds).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Resale status is unavailable.')).not.toBeInTheDocument());
    expect(screen.getByText('resale-enabled')).toBeInTheDocument();
  });
});
