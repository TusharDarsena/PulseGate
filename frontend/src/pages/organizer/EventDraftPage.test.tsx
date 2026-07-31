import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventPublicationDraft } from '../../lib/supabase';
import { EMPTY_ORGANIZER_WALLET, useAppStore } from '../../store/useAppStore';
import type { OrganizerWalletState, SignFn } from '../../types';
import { EventDraftPage } from './EventDraftPage';

const mocks = vi.hoisted(() => ({
  beginEventPublication: vi.fn(),
  getMyEventDraft: vi.fn(),
  prepareCreateEvent: vi.fn(),
  preflightEventPublication: vi.fn(),
  recordSignedEventPublication: vi.fn(),
  resolveEventPublication: vi.fn(),
  connectOrganizer: vi.fn(),
  saveEventDraft: vi.fn(),
}));

vi.mock('../../lib/soroban', () => ({
  prepareCreateEvent: mocks.prepareCreateEvent,
}));

vi.mock('../../lib/supabase', () => ({
  beginEventPublication: mocks.beginEventPublication,
  deleteEventDraft: vi.fn(),
  DraftConflictError: class DraftConflictError extends Error {},
  getMyEventDraft: mocks.getMyEventDraft,
  preflightEventPublication: mocks.preflightEventPublication,
  recordPublicationPreSubmissionFailure: vi.fn(),
  recordSignedEventPublication: mocks.recordSignedEventPublication,
  resolveEventPublication: mocks.resolveEventPublication,
  retryEventPublicationSync: vi.fn(),
  saveEventDraft: mocks.saveEventDraft,
}));

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({ connectOrganizer: mocks.connectOrganizer }),
}));

const ORGANIZER = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function draft(
  state: EventPublicationDraft['state'] = 'prepared',
  intendedOrganizerAddress: string | null = ORGANIZER,
): EventPublicationDraft {
  return {
    draft_id: 'draft-1',
    user_id: 'user-1',
    event_id: 'event-1',
    intended_organizer_address: intendedOrganizerAddress,
    expected_name: 'Stellar Builders',
    expected_date_unix: 2_525_644_800,
    expected_capacity: 100,
    expected_price_per_ticket: 10_000_000,
    network: 'StellarTestnet',
    ticket_contract_id: 'CTICKET',
    summary: 'A test event',
    description: 'A complete event draft for publication testing.',
    image_url: 'https://example.test/poster.png',
    category: 'Tech',
    timezone: 'UTC',
    end_unix: 2_525_652_000,
    venue: 'Stellar Hall',
    address: '1 Testnet Way',
    city: 'Bengaluru',
    organizer_display_name: 'PulseGate',
    support_contact: 'support@example.test',
    refund_policy_code: 'cancelled_event_original_price',
    resale_policy_code: 'stellar_marketplace_unlocked',
    entry_instructions: 'Show the ticket QR code at entry.',
    accessibility_notes: null,
    age_restriction: null,
    prohibited_items: null,
    map_url: null,
    public_links: [],
    revision: 1,
    state,
    creation_tx_hash: null,
    chain_verified_at: null,
    last_error: null,
    created_at: '2026-07-28T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
  };
}

describe('EventDraftPage publication after refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.getState().setOrganizerWallet(EMPTY_ORGANIZER_WALLET);
  });

  const renderDraftPage = () => {
    const router = createMemoryRouter([
      {
        path: '/organizer/drafts/:draftId',
        element: <EventDraftPage />,
      },
      {
        path: '/organizer/events',
        element: <p>Organizer events</p>,
      },
    ], { initialEntries: ['/organizer/drafts/draft-1'] });
    return { router, ...render(<RouterProvider router={router} />) };
  };

  it('reconnects the non-persisted Freighter signer and publishes on the first click', async () => {
    const signer: SignFn = vi.fn().mockResolvedValue({ signedTxXdr: 'signed-xdr' });
    const reconnectedWallet: OrganizerWalletState = {
      isConnected: true,
      publicKey: ORGANIZER,
      accountExists: true,
      xlmBalance: '10',
      signFn: signer,
    };
    const initialDraft = draft();
    const publishedDraft = { ...initialDraft, state: 'published' as const, creation_tx_hash: 'tx-hash' };
    const submit = vi.fn(async (_signFn: SignFn, recordSigned: (identity: { signedTransactionHash: string }) => Promise<void>) => {
      await recordSigned({ signedTransactionHash: 'signed-hash' });
      return { transactionHash: 'tx-hash' };
    });

    // This is the persisted wallet shape after a hard refresh: address remains, signer does not.
    useAppStore.getState().setOrganizerWallet({
      ...reconnectedWallet,
      signFn: null,
    });
    mocks.getMyEventDraft.mockResolvedValue(initialDraft);
    mocks.connectOrganizer.mockImplementation(async () => {
      useAppStore.getState().setOrganizerWallet(reconnectedWallet);
      return reconnectedWallet;
    });
    mocks.preflightEventPublication.mockResolvedValue({
      draft: initialDraft,
      preflight: {
        eventId: initialDraft.event_id,
        organizerAddress: ORGANIZER,
        network: 'StellarTestnet',
        ticketContractId: initialDraft.ticket_contract_id,
      },
    });
    mocks.prepareCreateEvent.mockResolvedValue({
      estimatedFeeStroops: 1_000n,
      identity: {
        unsignedEnvelopeHash: 'unsigned-hash',
        sourceSequence: '1',
        transactionMaxTime: 2_525_652_000,
      },
      submit,
    });
    mocks.beginEventPublication.mockResolvedValue({ ...initialDraft, state: 'approval_required' });
    mocks.recordSignedEventPublication.mockResolvedValue({ ...initialDraft, state: 'signed_submission_pending' });
    mocks.resolveEventPublication.mockResolvedValue(publishedDraft);

    renderDraftPage();

    const publish = await screen.findByRole('button', { name: 'Publish on Stellar' });
    expect(publish).toBeEnabled();
    fireEvent.click(publish);

    await waitFor(() => expect(mocks.resolveEventPublication).toHaveBeenCalledWith('draft-1'));
    expect(mocks.connectOrganizer).toHaveBeenCalledTimes(1);
    expect(mocks.preflightEventPublication).toHaveBeenCalledWith('draft-1');
    expect(mocks.prepareCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1' }),
      ORGANIZER,
    );
    expect(submit).toHaveBeenCalledWith(signer, expect.any(Function));
    expect(mocks.recordSignedEventPublication).toHaveBeenCalledWith('draft-1', 'signed-hash');
    expect(await screen.findByText('Publication receipt')).toBeInTheDocument();
  });

  it('binds an unassigned draft only through the explicit organizer action', async () => {
    const unboundDraft = draft('prepared', null);
    useAppStore.getState().setOrganizerWallet({
      isConnected: true,
      publicKey: ORGANIZER,
      accountExists: true,
      xlmBalance: '10',
      signFn: vi.fn(),
    });
    mocks.getMyEventDraft.mockResolvedValue(unboundDraft);
    mocks.saveEventDraft.mockResolvedValue({
      ...unboundDraft,
      intended_organizer_address: ORGANIZER,
      revision: 2,
    });

    renderDraftPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Bind organizer wallet' }));

    await waitFor(() => expect(mocks.saveEventDraft).toHaveBeenCalledWith(
      'draft-1',
      1,
      { intended_organizer_address: ORGANIZER },
    ));
  });

  it('blocks publication before Soroban preparation when the organizer account is not activated', async () => {
    const initialDraft = draft();
    useAppStore.getState().setOrganizerWallet({
      isConnected: true,
      publicKey: ORGANIZER,
      accountExists: false,
      xlmBalance: '0.00',
      signFn: vi.fn(),
    });
    mocks.getMyEventDraft.mockResolvedValue(initialDraft);

    renderDraftPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Publish on Stellar' }));

    expect(await screen.findByText(/not activated on Stellar Testnet/)).toBeInTheDocument();
    expect(mocks.preflightEventPublication).not.toHaveBeenCalled();
    expect(mocks.prepareCreateEvent).not.toHaveBeenCalled();
  });

  it('keeps newer typing while accepting the server draft revision from an in-flight save', async () => {
    const initialDraft = draft();
    let resolveSave: ((value: EventPublicationDraft) => void) | undefined;
    mocks.getMyEventDraft.mockResolvedValue(initialDraft);
    mocks.saveEventDraft.mockImplementation(() => new Promise<EventPublicationDraft>((resolve) => {
      resolveSave = resolve;
    }));

    renderDraftPage();

    const summary = await screen.findByLabelText('Short summary');
    fireEvent.change(summary, { target: { value: 'Saved text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.change(summary, { target: { value: 'Newer local text' } });
    resolveSave?.({ ...initialDraft, summary: 'Saved text', revision: 2 });

    await waitFor(() => expect(screen.getByLabelText('Short summary')).toHaveValue('Newer local text'));
    expect(screen.getByText(/Revision 2/)).toBeInTheDocument();
    expect(mocks.saveEventDraft).toHaveBeenCalledWith(
      'draft-1',
      1,
      expect.not.objectContaining({ intended_organizer_address: expect.anything() }),
    );
  });

  it('blocks unsaved SPA navigation until the organizer stays or discards edits', async () => {
    mocks.getMyEventDraft.mockResolvedValue(draft());
    const { router } = renderDraftPage();

    fireEvent.change(await screen.findByLabelText('Short summary'), {
      target: { value: 'Unsaved organizer edit' },
    });
    void router.navigate('/organizer/events');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText('Short summary')).toHaveValue('Unsaved organizer edit');

    void router.navigate('/organizer/events');
    fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));
    expect(await screen.findByText('Organizer events')).toBeInTheDocument();
  });
});
