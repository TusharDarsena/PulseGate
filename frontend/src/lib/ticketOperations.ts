import type { SignFn } from '../types';
import type { PreparedContractTransaction } from './soroban';
import { SUPABASE_URL } from './constants';
import { supabase } from './supabase';

export type TicketOperationType =
  | 'refund'
  | 'create_listing'
  | 'cancel_listing'
  | 'buy_listing';

export type TicketOperationState =
  | 'review'
  | 'approval_required'
  | 'pre_submission_failed'
  | 'signed_submission_pending'
  | 'confirmation_pending'
  | 'status_unknown'
  | 'chain_failed'
  | 'chain_confirmed'
  | 'mirror_syncing'
  | 'sync_warning'
  | 'complete';

export interface TicketOperation {
  operation_id: string;
  request_idempotency_key: string;
  user_id: string;
  operation_type: TicketOperationType;
  actor_address: string;
  ticket_id: string;
  event_id: string;
  seller_address: string | null;
  buyer_address: string | null;
  listing_id: string | null;
  amount_stroops: string | number;
  network: 'StellarTestnet';
  ticket_contract_id: string;
  marketplace_contract_id: string;
  state: TicketOperationState;
  transaction_hash: string | null;
  verified_ledger_sequence: string | number | null;
  chain_confirmed_at: string | null;
  synchronized_at: string | null;
  failure_category: string | null;
  failure_detail: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type AllocateTicketOperationInput =
  | {
      operationType: 'refund';
      ticketId: string;
      idempotencyKey: string;
    }
  | {
      operationType: 'create_listing';
      ticketId: string;
      listingId: string;
      askPriceStroops: bigint;
      idempotencyKey: string;
    }
  | {
      operationType: 'cancel_listing';
      listingId: string;
      idempotencyKey: string;
    }
  | {
      operationType: 'buy_listing';
      sellerAddress: string;
      listingId: string;
      idempotencyKey: string;
    };

interface TicketOperationResponse {
  operation: TicketOperation;
}

const PENDING_STATES = new Set<TicketOperationState>([
  'signed_submission_pending',
  'confirmation_pending',
  'status_unknown',
]);
const SYNCHRONIZABLE_STATES = new Set<TicketOperationState>([
  'chain_confirmed',
  'mirror_syncing',
  'sync_warning',
]);

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ticket-operation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ticket operation service unavailable.');
  return payload as T;
}

function allocationBody(input: AllocateTicketOperationInput): Record<string, unknown> {
  if (input.operationType === 'create_listing') {
    return {
      ...input,
      askPriceStroops: input.askPriceStroops.toString(),
    };
  }
  return input;
}

export function allocateTicketOperation(input: AllocateTicketOperationInput) {
  return invoke<TicketOperationResponse>({
    action: 'allocate',
    ...allocationBody(input),
  });
}

export function getTicketOperation(operationId: string) {
  return invoke<TicketOperationResponse>({ action: 'get', operationId });
}

export function listTicketOperations() {
  return invoke<{ operations: TicketOperation[] }>({ action: 'list' });
}

export function resolveTicketOperation(operationId: string) {
  return invoke<TicketOperationResponse>({ action: 'resolve', operationId });
}

export function retryTicketOperationSync(operationId: string) {
  return invoke<TicketOperationResponse>({ action: 'retry-sync', operationId });
}

async function beginTicketOperation(
  operationId: string,
  transaction: PreparedContractTransaction,
) {
  return invoke<TicketOperationResponse>({
    action: 'begin-attempt',
    operationId,
    ...transaction.identity,
  });
}

async function recordSignedTicketOperation(
  operationId: string,
  signedTransactionHash: string,
) {
  return invoke<TicketOperationResponse>({
    action: 'record-signed-attempt',
    operationId,
    signedTransactionHash,
  });
}

async function recordPreSubmissionFailure(
  operationId: string,
  category:
    | 'approval_rejected'
    | 'approval_expired'
    | 'preparation_failed'
    | 'signing_provider_failed',
  detail: string,
) {
  return invoke<TicketOperationResponse>({
    action: 'pre-submission-failed',
    operationId,
    category,
    detail,
  });
}

export async function executeTicketOperation(input: {
  allocation: AllocateTicketOperationInput;
  signFn: SignFn;
  prepare: (operation: TicketOperation) => Promise<PreparedContractTransaction>;
  onChange?: (operation: TicketOperation) => void;
}): Promise<TicketOperation> {
  const allocated = await allocateTicketOperation(input.allocation);
  const operation = allocated.operation;
  input.onChange?.(operation);
  if (operation.state === 'complete') return operation;
  if (SYNCHRONIZABLE_STATES.has(operation.state)) {
    const synchronized = operation.state === 'sync_warning' ? await retryTicketOperationSync(operation.operation_id) : await resolveTicketOperation(operation.operation_id);
    input.onChange?.(synchronized.operation);
    return synchronized.operation;
  }
  if (PENDING_STATES.has(operation.state)) {
    const resolved = await resolveTicketOperation(operation.operation_id);
    input.onChange?.(resolved.operation);
    return resolved.operation;
  }
  const prepared = await prepareTicketOperationFromAllocated(operation, input.prepare);
  return submitPreparedTicketOperation(prepared, input.signFn, input.onChange);
}

export interface PreparedTicketOperation {
  operation: TicketOperation;
  transaction: PreparedContractTransaction;
}

export async function prepareTicketOperation(input: {
  allocation: AllocateTicketOperationInput;
  prepare: (operation: TicketOperation) => Promise<PreparedContractTransaction>;
  onChange?: (operation: TicketOperation) => void;
}): Promise<PreparedTicketOperation> {
  const allocated = await allocateTicketOperation(input.allocation);
  const operation = allocated.operation;
  input.onChange?.(operation);

  if (operation.state === 'complete') throw new Error('This operation is already complete.');
  if (SYNCHRONIZABLE_STATES.has(operation.state)) {
    const synchronized = operation.state === 'sync_warning'
      ? await retryTicketOperationSync(operation.operation_id)
      : await resolveTicketOperation(operation.operation_id);
    input.onChange?.(synchronized.operation);
    throw new Error(ticketOperationMessage(synchronized.operation, 'This operation is already being finalized.'));
  }
  if (PENDING_STATES.has(operation.state)) {
    const resolved = await resolveTicketOperation(operation.operation_id);
    input.onChange?.(resolved.operation);
    throw new Error(ticketOperationMessage(resolved.operation, 'This operation is still being checked.'));
  }

  return prepareTicketOperationFromAllocated(operation, input.prepare);
}

async function prepareTicketOperationFromAllocated(
  operation: TicketOperation,
  prepare: (operation: TicketOperation) => Promise<PreparedContractTransaction>,
): Promise<PreparedTicketOperation> {
  try {
    const transaction = await prepare(operation);
    return { operation, transaction };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Ticket operation failed.';
    await recordPreSubmissionFailure(
      operation.operation_id,
      'preparation_failed',
      detail,
    ).catch(() => undefined);
    throw error;
  }
}

export async function submitPreparedTicketOperation(
  prepared: PreparedTicketOperation,
  signFn: SignFn,
  onChange?: (operation: TicketOperation) => void,
): Promise<TicketOperation> {
  let operation = prepared.operation;
  let signedHashPersisted = false;
  try {
    const { transaction } = prepared;
    const begun = await beginTicketOperation(operation.operation_id, transaction);
    operation = begun.operation;
    onChange?.(operation);
    const operationBoundSigner: SignFn = (xdr, options) => signFn(xdr, {
      ...options,
      externalId: `ticket-operation:${operation.operation_id}:${transaction.identity.unsignedEnvelopeHash}`,
    });
    await transaction.submit(operationBoundSigner, async ({ signedTransactionHash }) => {
      const signed = await recordSignedTicketOperation(
        operation.operation_id,
        signedTransactionHash,
      );
      signedHashPersisted = true;
      operation = signed.operation;
      onChange?.(operation);
    });

    const resolved = await resolveTicketOperation(operation.operation_id);
    onChange?.(resolved.operation);
    return resolved.operation;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Ticket operation failed.';
    if (signedHashPersisted) {
      try {
        const resolved = await resolveTicketOperation(operation.operation_id);
        onChange?.(resolved.operation);
        return resolved.operation;
      } catch {
        const current = await getTicketOperation(operation.operation_id);
        onChange?.(current.operation);
        return current.operation;
      }
    }
    await recordPreSubmissionFailure(
      operation.operation_id,
      /reject|declin|cancel/i.test(detail)
          ? 'approval_rejected'
          : 'signing_provider_failed',
      detail,
    ).catch(() => undefined);
    throw error;
  }
}

export function ticketOperationMessage(
  operation: TicketOperation,
  successMessage: string,
): string {
  if (operation.state === 'complete') return successMessage;
  if (operation.state === 'sync_warning') {
    return 'The blockchain transaction succeeded, but app data is still synchronizing. Do not repeat the blockchain action; use Retry synchronization.';
  }
  if (
    operation.state === 'signed_submission_pending' ||
    operation.state === 'confirmation_pending' ||
    operation.state === 'status_unknown'
  ) {
    return 'The signed transaction has an unresolved Stellar status. Do not repeat the action; use Resolve status.';
  }
  if (operation.state === 'chain_failed') {
    return operation.failure_detail || 'Stellar rejected the transaction.';
  }
  return operation.failure_detail || 'The operation did not reach a confirmed state.';
}

export function isRecoverableTicketOperation(operation: TicketOperation): boolean {
  return PENDING_STATES.has(operation.state) || SYNCHRONIZABLE_STATES.has(operation.state);
}

export function isTicketOperationSyncRecovery(operation: TicketOperation): boolean {
  return SYNCHRONIZABLE_STATES.has(operation.state);
}
