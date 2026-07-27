import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { rpc } from 'npm:@stellar/stellar-sdk@16.1.0';
import {
  asSafeNumber,
  eventStatus,
  isProvablyExpiredWithoutSubmission,
  readAuthoritativeEscrow,
  readAuthoritativeEvent,
  resolveExactContractEvent,
} from '../_shared/stellar-verifier.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server configuration is missing ${name}.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}.`);
  return value.trim();
}

function requireHash(value: unknown, label: string): string {
  const hash = requireString(value, label).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Invalid ${label}.`);
  return hash;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`Invalid ${label}.`);
  }
  return number;
}

type AdminClient = ReturnType<typeof createClient>;

interface OrganizerOperation {
  operation_id: string;
  request_idempotency_key: string;
  user_id: string;
  event_id: string;
  operation_type: 'cancel_event' | 'complete_event';
  expected_organizer_address: string;
  cancellation_reason: string | null;
  network: string;
  ticket_contract_id: string;
  state: string;
  unsigned_envelope_hash: string | null;
  signed_transaction_hash: string | null;
  source_sequence: string | null;
  transaction_max_time: number | null;
  verified_event_topic: string | null;
  verified_event_id: string | null;
  verified_released_amount: string | number | null;
  verified_ledger_sequence: number | null;
  verified_ledger_closed_at: string | null;
  confirmed_at: string | null;
  synchronized_at: string | null;
  failure_category: string | null;
  failure_detail: string | null;
  created_at: string;
  updated_at: string;
}

interface OwnedEvent {
  event_id: string;
  organizer_address: string;
  network: string;
  ticket_contract_id: string;
}

function operationResponse(operation: OrganizerOperation) {
  return {
    ...operation,
    transaction_hash: operation.signed_transaction_hash,
    released_amount: operation.verified_released_amount === null
      ? null
      : String(operation.verified_released_amount),
    chain_confirmed_at: operation.confirmed_at,
    last_error: operation.failure_detail,
  };
}

async function loadOperation(
  admin: AdminClient,
  userId: string,
  operationId: unknown,
): Promise<OrganizerOperation> {
  const id = requireString(operationId, 'operation ID');
  const { data, error } = await admin
    .from('organizer_event_operations')
    .select('*')
    .eq('operation_id', id)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('Organizer event operation not found.');
  return data as OrganizerOperation;
}

async function loadOwnedEvent(
  admin: AdminClient,
  userId: string,
  eventId: string,
): Promise<OwnedEvent> {
  const { data: draft, error: draftError } = await admin
    .from('event_publication_drafts')
    .select('event_id,intended_organizer_address,network,ticket_contract_id')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .eq('state', 'published')
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'))
    .single();
  if (draftError || !draft) throw new Error('Owned published event not found.');

  const { data: event, error: eventError } = await admin
    .from('events')
    .select('event_id,organizer_address,network,ticket_contract_id')
    .eq('event_id', eventId)
    .eq('network', draft.network)
    .eq('ticket_contract_id', draft.ticket_contract_id)
    .not('chain_verified_at', 'is', null)
    .single();
  if (eventError || !event) throw new Error('Trusted published event not found.');
  if (
    event.organizer_address !== draft.intended_organizer_address ||
    event.network !== required('STELLAR_NETWORK') ||
    event.ticket_contract_id !== required('TICKET_CONTRACT_ID')
  ) {
    throw new Error('Published ownership does not match the configured Stellar deployment.');
  }
  return event as OwnedEvent;
}

async function allocate(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const eventId = requireString(body.eventId, 'event ID');
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotency key');
  const operationType = requireString(body.operationType, 'operation type');
  if (!['cancel_event', 'complete_event'].includes(operationType)) {
    throw new Error('Unsupported organizer event operation.');
  }
  const cancellationReason = operationType === 'cancel_event'
    ? requireString(body.cancellationReason, 'cancellation reason').slice(0, 1000)
    : null;
  const published = await loadOwnedEvent(admin, userId, eventId);
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const [event, escrow] = await Promise.all([
    readAuthoritativeEvent(server, published.ticket_contract_id, eventId),
    readAuthoritativeEscrow(server, published.ticket_contract_id, eventId),
  ]);
  if (
    event.organizer !== published.organizer_address ||
    eventStatus(event.status) !== 'Active'
  ) {
    throw new Error('The authoritative event is not eligible for this organizer action.');
  }
  if (
    operationType === 'complete_event' &&
    asSafeNumber(event.end_unix, 'end time') > Math.floor(Date.now() / 1000)
  ) {
    throw new Error('The event cannot be completed before its authoritative end time.');
  }

  const { data, error } = await admin.rpc('allocate_organizer_event_operation', {
    operation_owner_id: userId,
    requested_idempotency_key: idempotencyKey,
    requested_event_id: eventId,
    requested_operation_type: operationType,
    verified_organizer_address: event.organizer,
    private_cancellation_reason: cancellationReason,
    configured_network: required('STELLAR_NETWORK'),
    configured_ticket_contract_id: required('TICKET_CONTRACT_ID'),
  });
  if (error || !data) throw new Error(error?.message || 'Could not allocate organizer operation.');
  return {
    operation: operationResponse(data as OrganizerOperation),
    authority: {
      eventStatus: eventStatus(event.status),
      organizerAddress: event.organizer,
      currentSupply: String(event.current_supply),
      capacity: String(event.capacity),
      startUnix: String(event.date_unix),
      endUnix: String(event.end_unix),
      escrowStroops: escrow.toString(),
    },
  };
}

async function beginAttempt(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  if (!['review', 'pre_submission_failed'].includes(operation.state)) {
    throw new Error('This organizer operation already has an unresolved attempt.');
  }
  const unsignedHash = requireHash(body.unsignedEnvelopeHash, 'unsigned envelope hash');
  const sourceSequence = requireString(body.sourceSequence, 'source sequence');
  if (!/^[0-9]+$/.test(sourceSequence)) throw new Error('Invalid source sequence.');
  const maxTime = requirePositiveInteger(body.transactionMaxTime, 'transaction maximum time');
  if (maxTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('The prepared transaction has already expired.');
  }

  const { data, error } = await admin
    .from('organizer_event_operations')
    .update({
      state: 'approval_required',
      unsigned_envelope_hash: unsignedHash,
      signed_transaction_hash: null,
      source_sequence: sourceSequence,
      transaction_max_time: maxTime,
      failure_category: null,
      failure_detail: null,
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .in('state', ['review', 'pre_submission_failed'])
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not begin organizer attempt.');
  return { operation: operationResponse(data as OrganizerOperation) };
}

async function recordSignedAttempt(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  const signedHash = requireHash(body.signedTransactionHash, 'signed transaction hash');
  if (operation.state !== 'approval_required') {
    if (
      ['signed_submission_pending', 'confirmation_pending', 'status_unknown'].includes(
        operation.state,
      ) &&
      operation.signed_transaction_hash === signedHash
    ) {
      return { operation: operationResponse(operation) };
    }
    throw new Error('This organizer operation cannot accept a signed transaction.');
  }
  if (operation.unsigned_envelope_hash !== signedHash) {
    throw new Error('The signed transaction does not match the prepared organizer action.');
  }
  const { data, error } = await admin
    .from('organizer_event_operations')
    .update({
      state: 'signed_submission_pending',
      signed_transaction_hash: signedHash,
      failure_category: null,
      failure_detail: null,
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .eq('state', 'approval_required')
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not persist signed transaction.');
  return { operation: operationResponse(data as OrganizerOperation) };
}

async function preSubmissionFailed(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  if (
    operation.signed_transaction_hash ||
    !['review', 'approval_required', 'pre_submission_failed'].includes(operation.state)
  ) {
    throw new Error('A possibly submitted organizer action cannot be marked pre-submission failure.');
  }
  const category = requireString(body.category, 'failure category');
  if (![
    'approval_rejected',
    'approval_expired',
    'preparation_failed',
    'signing_provider_failed',
  ].includes(category)) {
    throw new Error('Unsupported pre-submission failure category.');
  }
  const { data, error } = await admin
    .from('organizer_event_operations')
    .update({
      state: 'pre_submission_failed',
      failure_category: category,
      failure_detail: typeof body.detail === 'string'
        ? body.detail.slice(0, 1000)
        : category,
      unsigned_envelope_hash: null,
      source_sequence: null,
      transaction_max_time: null,
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .in('state', ['review', 'approval_required', 'pre_submission_failed'])
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not record pre-submission failure.');
  return { operation: operationResponse(data as OrganizerOperation) };
}

async function persistResolutionState(
  admin: AdminClient,
  operation: OrganizerOperation,
  state: 'status_unknown' | 'chain_failed',
  category: string,
  detail: string,
) {
  const { data, error } = await admin
    .from('organizer_event_operations')
    .update({
      state,
      failure_category: category,
      failure_detail: detail.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .in('state', [
      'signed_submission_pending',
      'confirmation_pending',
      'status_unknown',
    ])
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not update operation status.');
  return data as OrganizerOperation;
}

async function synchronize(
  admin: AdminClient,
  userId: string,
  operationId: string,
) {
  let operation = await loadOperation(admin, userId, operationId);
  if (operation.state === 'complete') {
    return { operation: operationResponse(operation) };
  }
  if (!['chain_confirmed', 'mirror_syncing', 'sync_warning'].includes(operation.state)) {
    throw new Error('This organizer operation is not ready for mirror synchronization.');
  }
  await admin
    .from('organizer_event_operations')
    .update({ state: 'mirror_syncing', updated_at: new Date().toISOString() })
    .eq('operation_id', operation.operation_id)
    .in('state', ['chain_confirmed', 'sync_warning']);

  try {
    const event = await readAuthoritativeEvent(
      new rpc.Server(required('STELLAR_RPC_URL')),
      operation.ticket_contract_id,
      operation.event_id,
    );
    const { data, error } = await admin.rpc('finalize_organizer_event_sync', {
      requested_operation_id: operation.operation_id,
      verified_event_status: eventStatus(event.status),
      verified_current_supply: asSafeNumber(event.current_supply, 'supply'),
      verified_capacity: asSafeNumber(event.capacity, 'capacity'),
      verified_at: new Date().toISOString(),
    });
    if (error || !data) throw new Error(error?.message || 'Organizer mirror sync failed.');
    return { operation: operationResponse(data as OrganizerOperation) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Organizer mirror sync failed.';
    const { data } = await admin
      .from('organizer_event_operations')
      .update({
        state: 'sync_warning',
        failure_category: 'synchronization_error',
        failure_detail: detail.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq('operation_id', operation.operation_id)
      .in('state', ['chain_confirmed', 'mirror_syncing', 'sync_warning'])
      .select('*')
      .single();
    operation = (data ?? operation) as OrganizerOperation;
    return { operation: operationResponse(operation) };
  }
}

async function resolve(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  let operation = await loadOperation(admin, userId, body.operationId);
  if (operation.state === 'complete') return { operation: operationResponse(operation) };
  if (['chain_confirmed', 'mirror_syncing', 'sync_warning'].includes(operation.state)) {
    return synchronize(admin, userId, operation.operation_id);
  }
  if (![
    'signed_submission_pending',
    'confirmation_pending',
    'status_unknown',
  ].includes(operation.state)) {
    throw new Error('This organizer operation has no signed transaction to resolve.');
  }
  const hash = requireHash(operation.signed_transaction_hash, 'recorded transaction hash');
  const topic = operation.operation_type === 'cancel_event' ? 'ev_cancel' : 'ev_rel';
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const resolution = await resolveExactContractEvent(
    server,
    required('STELLAR_NETWORK_PASSPHRASE'),
    operation.ticket_contract_id,
    hash,
    operation.expected_organizer_address,
    topic,
    operation.event_id,
  );
  if (resolution.status === 'failed') {
    operation = await persistResolutionState(
      admin,
      operation,
      'chain_failed',
      'chain_rejected',
      'Stellar rejected the organizer transaction.',
    );
    return { operation: operationResponse(operation) };
  }
  if (resolution.status === 'not_found') {
    const expired = await isProvablyExpiredWithoutSubmission(
      server,
      operation.expected_organizer_address,
      operation.source_sequence,
      operation.transaction_max_time,
    );
    operation = await persistResolutionState(
      admin,
      operation,
      expired ? 'chain_failed' : 'status_unknown',
      expired ? 'expired_without_submission' : 'status_unavailable',
      expired
        ? 'The signed transaction expired before submission.'
        : 'The signed transaction is not yet visible on Stellar.',
    );
    return { operation: operationResponse(operation) };
  }
  if (resolution.status === 'success_without_event') {
    operation = await persistResolutionState(
      admin,
      operation,
      'status_unknown',
      'receipt_unavailable',
      `The transaction succeeded, but matching ${topic} proof is unavailable.`,
    );
    return { operation: operationResponse(operation) };
  }

  const event = await readAuthoritativeEvent(
    server,
    operation.ticket_contract_id,
    operation.event_id,
  );
  const expectedStatus = operation.operation_type === 'cancel_event'
    ? 'Cancelled'
    : 'Completed';
  if (
    event.organizer !== operation.expected_organizer_address ||
    eventStatus(event.status) !== expectedStatus
  ) {
    throw new Error('Current contract state does not match the terminal-operation receipt.');
  }
  const { data, error } = await admin.rpc('confirm_organizer_event_operation', {
    requested_operation_id: operation.operation_id,
    p_verified_transaction_hash: resolution.proof.transactionHash,
    p_verified_event_topic: resolution.proof.topic,
    p_verified_event_id: resolution.proof.eventId,
    p_verified_released_amount: resolution.proof.releasedAmount?.toString() ?? null,
    p_verified_ledger_sequence: resolution.proof.ledgerSequence,
    p_verified_ledger_closed_at: resolution.proof.ledgerClosedAt,
  });
  if (error || !data) throw new Error(error?.message || 'Could not persist terminal receipt.');
  return synchronize(admin, userId, operation.operation_id);
}

async function listOperations(admin: AdminClient, userId: string, body: Record<string, unknown>) {
  let query = admin
    .from('organizer_event_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'))
    .order('updated_at', { ascending: false })
    .limit(50);
  if (typeof body.eventId === 'string' && body.eventId) {
    query = query.eq('event_id', body.eventId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return {
    operations: (data as OrganizerOperation[] ?? []).map(operationResponse),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = required('SUPABASE_URL');
    const authHeader = request.headers.get('Authorization') ?? '';
    const authClient = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return json({ error: 'Authentication required.' }, 401);

    const admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'));
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case 'allocate':
        return json(await allocate(admin, user.id, body));
      case 'get': {
        const operation = await loadOperation(admin, user.id, body.operationId);
        return json({ operation: operationResponse(operation) });
      }
      case 'list':
        return json(await listOperations(admin, user.id, body));
      case 'begin-attempt':
        return json(await beginAttempt(admin, user.id, body));
      case 'record-signed-attempt':
        return json(await recordSignedAttempt(admin, user.id, body));
      case 'pre-submission-failed':
        return json(await preSubmissionFailed(admin, user.id, body));
      case 'resolve':
        return json(await resolve(admin, user.id, body));
      case 'retry-sync':
        return json(await synchronize(
          admin,
          user.id,
          requireString(body.operationId, 'operation ID'),
        ));
      default:
        return json({ error: 'Unknown organizer-event-operation action.' }, 400);
    }
  } catch (error) {
    console.error(
      '[organizer-event-operation]',
      error instanceof Error ? error.message : error,
    );
    return json({
      error: error instanceof Error ? error.message : 'Organizer event operation failed.',
    }, 400);
  }
});
