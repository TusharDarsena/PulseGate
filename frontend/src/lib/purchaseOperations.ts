import { TransactionBuilder } from '@stellar/stellar-sdk';
import type { SignFn } from '../types';
import {
  NETWORK_PASSPHRASE,
  SUPABASE_URL,
} from './constants';
import { safeStorageGet, safeStorageRemove, safeStorageSet } from './safeStorage';
import { supabase } from './supabase';

export type PurchaseOperationState =
  | 'review'
  | 'preparing'
  | 'approval_required'
  | 'signed_submission_pending'
  | 'confirming'
  | 'status_unknown'
  | 'pre_submission_failed'
  | 'chain_failed'
  | 'chain_confirmed'
  | 'mirror_syncing'
  | 'sync_warning'
  | 'complete';

export type PreSubmissionFailureCategory =
  | 'approval_rejected'
  | 'approval_expired'
  | 'preparation_failed'
  | 'signing_provider_failed';

export interface PurchaseOperation {
  operation_id: string;
  user_id: string;
  request_idempotency_key: string;
  ticket_id: string;
  event_id: string;
  attendee_wallet_address: string;
  expected_price_stroops: string | number;
  estimated_fee_stroops: string | number;
  confirmed_fee_stroops: string | number | null;
  network: 'StellarTestnet';
  ticket_contract_id: string;
  state: PurchaseOperationState;
  failure_category: string | null;
  failure_detail: string | null;
  current_attempt_number: number;
  transaction_hash: string | null;
  ledger_sequence: number | null;
  ledger_closed_at: string | null;
  receipt_event_name: string | null;
  receipt_event_start_unix: number | null;
  receipt_event_timezone: string | null;
  receipt_venue: string | null;
  receipt_owner_address: string | null;
  receipt_amount_stroops: string | number | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

export interface PurchaseAttempt {
  operation_id: string;
  attempt_number: number;
  external_id: string;
  unsigned_envelope_hash: string;
  signed_transaction_hash: string | null;
  source_sequence: string;
  transaction_max_time: number;
  estimated_fee_stroops: string | number;
  state: PurchaseOperationState;
  signed_at: string | null;
}

export interface PurchaseOperationResponse {
  operation: PurchaseOperation;
  attempt: PurchaseAttempt | null;
}

interface PurchaseRecoveryBridge {
  operationId: string;
  eventId: string;
  ticketId: string;
  transactionHash?: string;
}

const RECOVERY_KEY = 'stellar-tickets:purchase-recovery';

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/purchase-operation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Purchase service unavailable.');
  return payload as T;
}

export function savePurchaseRecovery(operation: PurchaseOperation) {
  const bridge: PurchaseRecoveryBridge = {
    operationId: operation.operation_id,
    eventId: operation.event_id,
    ticketId: operation.ticket_id,
    transactionHash: operation.transaction_hash ?? undefined,
  };
  safeStorageSet('localStorage', RECOVERY_KEY, JSON.stringify(bridge));
}

export function clearPurchaseRecovery(operationId: string) {
  const bridge = loadPurchaseRecovery();
  if (bridge?.operationId === operationId) {
    safeStorageRemove('localStorage', RECOVERY_KEY);
  }
}

export function loadPurchaseRecovery(): PurchaseRecoveryBridge | null {
  const raw = safeStorageGet('localStorage', RECOVERY_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PurchaseRecoveryBridge;
    if (!value.operationId || !value.eventId || !value.ticketId) return null;
    return value;
  } catch {
    return null;
  }
}

export function allocatePurchaseOperation(eventId: string, idempotencyKey: string) {
  return invoke<PurchaseOperationResponse>({
    action: 'allocate',
    eventId,
    idempotencyKey,
  });
}

export function getPurchaseOperation(operationId: string) {
  return invoke<PurchaseOperationResponse>({ action: 'get', operationId });
}

export function markPurchasePreparing(operationId: string) {
  return invoke<PurchaseOperationResponse>({ action: 'mark-preparing', operationId });
}

export function markPurchaseReviewReady(operationId: string, estimatedFeeStroops: bigint) {
  return invoke<PurchaseOperationResponse>({
    action: 'mark-review-ready',
    operationId,
    estimatedFeeStroops: estimatedFeeStroops.toString(),
  });
}

export function resolvePurchaseOperation(operationId: string) {
  return invoke<PurchaseOperationResponse>({ action: 'resolve', operationId });
}

export function retryPurchaseSync(operationId: string) {
  return invoke<PurchaseOperationResponse>({ action: 'retry-purchase-sync', operationId });
}

export function listPendingPurchaseSync() {
  return invoke<{ operations: PurchaseOperationResponse[] }>({ action: 'list-pending-sync' });
}

export function getPurchaseOperationForTicket(ticketId: string) {
  return invoke<{ result: PurchaseOperationResponse | null }>({
    action: 'get-ticket-operation',
    ticketId,
  });
}

export async function recordPreparationFailure(operationId: string, detail: string) {
  return invoke<PurchaseOperationResponse>({
    action: 'pre-submission-failed',
    operationId,
    category: 'preparation_failed',
    detail,
  });
}

export async function requestTestFunding() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/test-funding`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Test funding unavailable.');
  return payload as {
    status: 'confirmed';
    kind: 'activation' | 'top_up';
    exists: true;
    balanceStroops: string;
  };
}

function signingFailure(error: unknown): {
  category: PreSubmissionFailureCategory;
  detail: string;
} {
  const detail = error instanceof Error ? error.message : 'Signing approval failed.';
  if (
    (error instanceof DOMException && error.name === 'NotAllowedError') ||
    /reject|declin|cancel/i.test(detail)
  ) {
    return { category: 'approval_rejected', detail };
  }
  if (/expir/i.test(detail)) return { category: 'approval_expired', detail };
  return { category: 'signing_provider_failed', detail };
}

export class PurchaseSigningError extends Error {
  readonly category: PreSubmissionFailureCategory;

  constructor(category: PreSubmissionFailureCategory, detail: string, cause?: unknown) {
    super(detail, { cause });
    this.name = 'PurchaseSigningError';
    this.category = category;
  }
}

export function operationBoundPurchaseSigner(
  operation: PurchaseOperation,
  baseSigner: SignFn,
  onChange: (response: PurchaseOperationResponse) => void,
): SignFn {
  return async (unsignedXdr, options) => {
    const passphrase = options?.networkPassphrase || NETWORK_PASSPHRASE;
    const transaction = TransactionBuilder.fromXDR(unsignedXdr, passphrase);
    if (!('sequence' in transaction) || !('timeBounds' in transaction)) {
      throw new Error('Fee-bump envelopes are not supported for attendee purchases.');
    }
    const unsignedEnvelopeHash = transaction.hash().toString('hex');
    const maxTime = Number(transaction.timeBounds?.maxTime ?? 0);
    if (!maxTime) throw new Error('The prepared purchase transaction has no expiration boundary.');

    const started = await invoke<PurchaseOperationResponse>({
      action: 'begin-attempt',
      operationId: operation.operation_id,
      unsignedEnvelopeHash,
      sourceSequence: transaction.sequence,
      transactionMaxTime: maxTime,
      estimatedFeeStroops: transaction.fee,
    });
    onChange(started);

    let signed;
    try {
      signed = await baseSigner(unsignedXdr, {
        ...options,
        externalId: started.attempt?.external_id,
      });
    } catch (error) {
      const failure = signingFailure(error);
      const failed = await invoke<PurchaseOperationResponse>({
        action: 'pre-submission-failed',
        operationId: operation.operation_id,
        attemptNumber: started.attempt?.attempt_number,
        category: failure.category,
        detail: failure.detail,
      }).catch(() => null);
      if (failed) onChange(failed);
      throw new PurchaseSigningError(failure.category, failure.detail, error);
    }

    const signedTransaction = TransactionBuilder.fromXDR(signed.signedTxXdr, passphrase);
    const signedHash = signedTransaction.hash().toString('hex');
    const recorded = await invoke<PurchaseOperationResponse>({
      action: 'record-signed-attempt',
      operationId: operation.operation_id,
      attemptNumber: started.attempt?.attempt_number,
      signedTransactionHash: signedHash,
    });
    onChange(recorded);
    savePurchaseRecovery(recorded.operation);
    return signed;
  };
}
