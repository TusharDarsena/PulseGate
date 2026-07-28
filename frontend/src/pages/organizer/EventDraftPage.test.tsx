import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
  saveEventDraft: vi.fn(),
}));

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => ({ connectOrganizer: mocks.connectOrganizer }),
}));

const ORGANIZER = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function draft(state: EventPublicationDraft['state'] = 'prepared'): EventPublicationDraft {
  return {
    draft_id: 'draft-1',
    user_id: 'user-1',
    event_id: 'event-1',
    intended_organizer_address: ORGANIZER,
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
    organizer_display_name: 'StellarTickets',
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

  it('reconnects the non-persisted Freighter signer and publishes on the first click', async () => {
    const signer: SignFn = vi.fn().mockResolvedValue({ signedTxXdr: 'signed-xdr' });
    const reconnectedWallet: OrganizerWalletState = {
      isConnected: true,
      publicKey: ORGANIZER,
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

    render(
      <MemoryRouter initialEntries={['/organizer/drafts/draft-1']}>
        <Routes>
          <Route path="/organizer/drafts/:draftId" element={<EventDraftPage />} />
        </Routes>
      </MemoryRouter>,
    );

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
});
