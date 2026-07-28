import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./constants', () => ({
  NETWORK_PASSPHRASE: Networks.TESTNET,
  SUPABASE_URL: 'https://supabase.example',
}));

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: 'session-token' } },
      })),
    },
  },
}));

import {
  loadPurchaseRecovery,
  operationBoundPurchaseSigner,
  savePurchaseRecovery,
  type PurchaseOperation,
  type PurchaseOperationResponse,
} from './purchaseOperations';

function operation(state: PurchaseOperation['state']): PurchaseOperation {
  return {
    operation_id: '11111111-1111-4111-8111-111111111111',
    user_id: '22222222-2222-4222-8222-222222222222',
    request_idempotency_key: '33333333-3333-4333-8333-333333333333',
    ticket_id: 'ticket-1',
    event_id: 'event-1',
    attendee_wallet_address: 'GATTENDEE',
    expected_price_stroops: '10000000',
    estimated_fee_stroops: '100',
    confirmed_fee_stroops: null,
    network: 'StellarTestnet',
    ticket_contract_id: 'CCONTRACT',
    state,
    failure_category: null,
    failure_detail: null,
    current_attempt_number: 1,
    transaction_hash: null,
    ledger_sequence: null,
    ledger_closed_at: null,
    receipt_event_name: null,
    receipt_event_start_unix: null,
    receipt_event_timezone: null,
    receipt_venue: null,
    receipt_owner_address: null,
    receipt_amount_stroops: null,
    created_at: '2026-07-27T00:00:00Z',
    updated_at: '2026-07-27T00:00:00Z',
    confirmed_at: null,
  };
}

describe('operation-bound purchase signer', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('records the deterministic signed hash before allowing signAndSend to continue', async () => {
    const sourceAddress = 'GB2RROS3NH7FWUM4LORCIUPJQGUJ2WCTVQ6FQSXCWDNUWLFJMHY32LG5';
    const transaction = new TransactionBuilder(
      new Account(sourceAddress, '1'),
      {
        fee: '123',
        networkPassphrase: Networks.TESTNET,
        timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 },
      },
    )
      .addOperation(Operation.manageData({ name: 'phase3', value: 'purchase-proof' }))
      .build();
    const unsignedXdr = transaction.toEnvelope().toXDR('base64');
    const hash = transaction.hash().toString('hex');
    const externalId = `purchase:11111111-1111-4111-8111-111111111111:1:${hash}`;
    const attempt = {
      operation_id: operation('approval_required').operation_id,
      attempt_number: 1,
      external_id: externalId,
      unsigned_envelope_hash: hash,
      signed_transaction_hash: null,
      source_sequence: transaction.sequence,
      transaction_max_time: Number(transaction.timeBounds?.maxTime),
      estimated_fee_stroops: '123',
      state: 'approval_required' as const,
      signed_at: null,
    };
    const beginResponse: PurchaseOperationResponse = {
      operation: operation('approval_required'),
      attempt,
    };
    const signedOperation = {
      ...operation('signed_submission_pending'),
      transaction_hash: hash,
    };
    const signedResponse: PurchaseOperationResponse = {
      operation: signedOperation,
      attempt: {
        ...attempt,
        signed_transaction_hash: hash,
        state: 'signed_submission_pending',
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => beginResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => signedResponse,
      });
    vi.stubGlobal('fetch', fetchMock);

    const baseSigner = vi.fn(async (xdr: string, options?: { externalId?: string }) => {
      expect(options?.externalId).toBe(externalId);
      return { signedTxXdr: xdr };
    });
    const bound = operationBoundPurchaseSigner(
      operation('preparing'),
      baseSigner,
      () => undefined,
    );

    const result = await bound(unsignedXdr, { networkPassphrase: Networks.TESTNET });

    expect(result.signedTxXdr).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const recordedBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(recordedBody.action).toBe('record-signed-attempt');
    expect(recordedBody.signedTransactionHash).toBe(hash);
    expect(localStorage.getItem('stellar-tickets:purchase-recovery')).not.toContain('signedTxXdr');
  });

  it('does not let unavailable recovery storage interrupt operation resolution', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });
    expect(() => savePurchaseRecovery(operation('signed_submission_pending'))).not.toThrow();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });
    expect(loadPurchaseRecovery()).toBeNull();
  });
});
