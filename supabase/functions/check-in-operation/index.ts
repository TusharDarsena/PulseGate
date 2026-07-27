import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { rpc } from 'npm:@stellar/stellar-sdk@16.1.0';
import {
  asSafeNumber,
  eventStatus,
  isProvablyExpiredWithoutSubmission,
  readAuthoritativeEvent,
  readAuthoritativeTicket,
  resolveExactTicketUsedEvent,
  ticketStatus,
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
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Invalid ${label}.`);
  return number;
}

type AdminClient = ReturnType<typeof createClient>;

interface CheckInOperation {
  operation_id: string;
  request_idempotency_key: string;
  user_id: string;
  event_id: string;
  ticket_id: string;
  expected_owner_address: string;
  expected_organizer_address: string;
  network: string;
  ticket_contract_id: string;
  state: string;
  unsigned_envelope_hash: string | null;
  signed_transaction_hash: string | null;
  source_sequence: string | null;
  transaction_max_time: number | null;
  verified_event_topic: string | null;
  verified_ticket_id: string | null;
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

function operationResponse(operation: CheckInOperation) {
  return {
    ...operation,
    transaction_hash: operation.signed_transaction_hash,
    chain_confirmed_at: operation.confirmed_at,
    last_error: operation.failure_detail,
  };
}

async function loadOperation(
  admin: AdminClient,
  userId: string,
  operationId: unknown,
): Promise<CheckInOperation> {
  const id = requireString(operationId, 'operation ID');
  const { data, error } = await admin
    .from('check_in_operations')
    .select('*')
    .eq('operation_id', id)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('Check-in operation not found.');
  return data as CheckInOperation;
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
  const ticketId = requireString(body.ticketId, 'ticket ID');
  const expectedOwner = requireString(body.expectedOwnerAddress, 'expected ticket owner');
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotency key');
  const published = await loadOwnedEvent(admin, userId, eventId);
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const [event, ticket] = await Promise.all([
    readAuthoritativeEvent(server, published.ticket_contract_id, eventId),
    readAuthoritativeTicket(server, published.ticket_contract_id, ticketId),
  ]);

  if (event.organizer !== published.organizer_address) {
    throw new Error('The authoritative event organizer does not match the published event.');
  }
  if (ticket.event_id !== eventId) throw new Error('Ticket belongs to another event.');
  if (ticket.owner !== expectedOwner) throw new Error('Ticket ownership changed.');
  if (ticketStatus(ticket.status) !== 'Active') {
    throw new Error(`Ticket is ${ticketStatus(ticket.status).toLowerCase()}.`);
  }
  if (eventStatus(event.status) !== 'Active') {
    throw new Error('The event is not active for check-in.');
  }

  const now = Math.floor(Date.now() / 1000);
  const startUnix = asSafeNumber(event.date_unix, 'start time');
  const endUnix = asSafeNumber(event.end_unix, 'end time');
  if (now < startUnix - 7_200) throw new Error('Check-in is not open yet.');
  if (now >= endUnix) throw new Error('Check-in is closed.');

  const { data, error } = await admin.rpc('allocate_check_in_operation', {
    operation_owner_id: userId,
    requested_idempotency_key: idempotencyKey,
    requested_event_id: eventId,
    requested_ticket_id: ticketId,
    verified_owner_address: ticket.owner,
    verified_organizer_address: event.organizer,
    configured_network: required('STELLAR_NETWORK'),
    configured_ticket_contract_id: required('TICKET_CONTRACT_ID'),
  });
  if (error || !data) throw new Error(error?.message || 'Could not allocate check-in operation.');
  return {
    operation: operationResponse(data as CheckInOperation),
    authority: {
      eventStatus: eventStatus(event.status),
      ticketStatus: ticketStatus(ticket.status),
      organizerAddress: event.organizer,
      ownerAddress: ticket.owner,
      currentSupply: String(event.current_supply),
      capacity: String(event.capacity),
      startUnix: String(event.date_unix),
      endUnix: String(event.end_unix),
    },
  };
}

async function beginAttempt(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  if (!['review', 'pre_submission_failed', 'chain_failed'].includes(operation.state)) {
    throw new Error('This check-in operation already has an unresolved attempt.');
  }
  const unsignedHash = requireHash(body.unsignedEnvelopeHash, 'unsigned envelope hash');
  const sourceSequence = requireString(body.sourceSequence, 'source sequence');
  if (!/^[0-9]+$/.test(sourceSequence)) throw new Error('Invalid source sequence.');
  const maxTime = requirePositiveInteger(body.transactionMaxTime, 'transaction maximum time');
  if (maxTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('The prepared transaction has already expired.');
  }

  const { data, error } = await admin
    .from('check_in_operations')
    .update({
      state: 'approval_required',
      unsigned_envelope_hash: unsignedHash,
      signed_transaction_hash: null,
      source_sequence: sourceSequence,
      transaction_max_time: maxTime,
      verified_event_topic: null,
      verified_ticket_id: null,
      verified_ledger_sequence: null,
      verified_ledger_closed_at: null,
      confirmed_at: null,
      failure_category: null,
      failure_detail: null,
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .in('state', ['review', 'pre_submission_failed', 'chain_failed'])
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not begin check-in attempt.');
  return { operation: operationResponse(data as CheckInOperation) };
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
    throw new Error('This check-in operation cannot accept a signed transaction.');
  }
  if (operation.unsigned_envelope_hash !== signedHash) {
    throw new Error('The signed transaction does not match the prepared check-in.');
  }
  const { data, error } = await admin
    .from('check_in_operations')
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
  return { operation: operationResponse(data as CheckInOperation) };
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
    throw new Error('A possibly submitted check-in cannot be marked pre-submission failure.');
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
    .from('check_in_operations')
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
  return { operation: operationResponse(data as CheckInOperation) };
}

async function persistResolutionState(
  admin: AdminClient,
  operation: CheckInOperation,
  state: 'status_unknown' | 'chain_failed',
  category: string,
  detail: string,
) {
  const { data, error } = await admin
    .from('check_in_operations')
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
  return data as CheckInOperation;
}

async function synchronize(
  admin: AdminClient,
  userId: string,
  operationId: string,
) {
  let operation = await loadOperation(admin, userId, operationId);
  if (operation.state === 'complete') return { operation: operationResponse(operation) };
  if (!['chain_confirmed', 'mirror_syncing', 'sync_warning'].includes(operation.state)) {
    throw new Error('This check-in operation is not ready for mirror synchronization.');
  }
  await admin
    .from('check_in_operations')
    .update({ state: 'mirror_syncing', updated_at: new Date().toISOString() })
    .eq('operation_id', operation.operation_id)
    .in('state', ['chain_confirmed', 'sync_warning']);

  try {
    const server = new rpc.Server(required('STELLAR_RPC_URL'));
    const [event, ticket] = await Promise.all([
      readAuthoritativeEvent(server, operation.ticket_contract_id, operation.event_id),
      readAuthoritativeTicket(server, operation.ticket_contract_id, operation.ticket_id),
    ]);
    if (
      event.organizer !== operation.expected_organizer_address ||
      ticket.event_id !== operation.event_id ||
      ticket.owner !== operation.expected_owner_address ||
      ticketStatus(ticket.status) !== 'Used'
    ) {
      throw new Error('Current contract state does not match the verified check-in receipt.');
    }
    const { data, error } = await admin.rpc('finalize_check_in_sync', {
      requested_operation_id: operation.operation_id,
      verified_ticket_id: operation.ticket_id,
      verified_event_id: operation.event_id,
      verified_owner_address: ticket.owner,
      verified_ticket_status: ticketStatus(ticket.status),
      verified_event_status: eventStatus(event.status),
      verified_event_supply: asSafeNumber(event.current_supply, 'supply'),
      verified_event_capacity: asSafeNumber(event.capacity, 'capacity'),
      verified_transaction_hash: operation.signed_transaction_hash,
      verified_ledger_sequence: operation.verified_ledger_sequence,
      verified_at: new Date().toISOString(),
      verified_network: operation.network,
      verified_ticket_contract_id: operation.ticket_contract_id,
    });
    if (error || !data) throw new Error(error?.message || 'Check-in mirror sync failed.');
    return { operation: operationResponse(data as CheckInOperation) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Check-in mirror sync failed.';
    const { data } = await admin
      .from('check_in_operations')
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
    operation = (data ?? operation) as CheckInOperation;
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
    throw new Error('This check-in operation has no signed transaction to resolve.');
  }
  const hash = requireHash(operation.signed_transaction_hash, 'recorded transaction hash');
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const resolution = await resolveExactTicketUsedEvent(
    server,
    required('STELLAR_NETWORK_PASSPHRASE'),
    operation.ticket_contract_id,
    hash,
    operation.expected_organizer_address,
    operation.ticket_id,
  );
  if (resolution.status === 'failed') {
    operation = await persistResolutionState(
      admin,
      operation,
      'chain_failed',
      'chain_rejected',
      'Stellar rejected the check-in transaction.',
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
        ? 'The signed check-in transaction expired before submission.'
        : 'The signed check-in transaction is not yet visible on Stellar.',
    );
    return { operation: operationResponse(operation) };
  }
  if (resolution.status === 'success_without_event') {
    operation = await persistResolutionState(
      admin,
      operation,
      'status_unknown',
      'receipt_unavailable',
      'The transaction succeeded, but matching tk_used proof is unavailable.',
    );
    return { operation: operationResponse(operation) };
  }

  const [event, ticket] = await Promise.all([
    readAuthoritativeEvent(server, operation.ticket_contract_id, operation.event_id),
    readAuthoritativeTicket(server, operation.ticket_contract_id, operation.ticket_id),
  ]);
  if (
    event.organizer !== operation.expected_organizer_address ||
    ticket.event_id !== operation.event_id ||
    ticket.owner !== operation.expected_owner_address ||
    ticketStatus(ticket.status) !== 'Used'
  ) {
    throw new Error('Current contract state does not match the check-in receipt.');
  }
  const { data, error } = await admin.rpc('confirm_check_in_operation', {
    requested_operation_id: operation.operation_id,
    p_verified_transaction_hash: resolution.proof.transactionHash,
    p_verified_event_topic: resolution.proof.topic,
    p_verified_ticket_id: resolution.proof.ticketId,
    p_verified_ledger_sequence: resolution.proof.ledgerSequence,
    p_verified_ledger_closed_at: resolution.proof.ledgerClosedAt,
  });
  if (error || !data) throw new Error(error?.message || 'Could not persist check-in receipt.');
  return synchronize(admin, userId, operation.operation_id);
}

async function listOperations(admin: AdminClient, userId: string, body: Record<string, unknown>) {
  const eventId = requireString(body.eventId, 'event ID');
  await loadOwnedEvent(admin, userId, eventId);
  const { data, error } = await admin
    .from('check_in_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'))
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return {
    operations: (data as CheckInOperation[] ?? []).map(operationResponse),
  };
}

async function stats(admin: AdminClient, userId: string, body: Record<string, unknown>) {
  const eventId = requireString(body.eventId, 'event ID');
  const published = await loadOwnedEvent(admin, userId, eventId);
  const event = await readAuthoritativeEvent(
    new rpc.Server(required('STELLAR_RPC_URL')),
    published.ticket_contract_id,
    eventId,
  );
  if (event.organizer !== published.organizer_address) {
    throw new Error('The authoritative event organizer does not match the published event.');
  }
  const { data, error } = await admin
    .from('check_in_operations')
    .select('ticket_id,state')
    .eq('user_id', userId)
    .eq('event_id', eventId)
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'));
  if (error) throw error;
  const checkedTickets = new Set<string>();
  const unresolvedTickets = new Set<string>();
  for (const row of data as Array<{ ticket_id: string; state: string }>) {
    if (['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'].includes(row.state)) {
      checkedTickets.add(row.ticket_id);
    }
    if (['signed_submission_pending', 'confirmation_pending', 'status_unknown'].includes(row.state)) {
      unresolvedTickets.add(row.ticket_id);
    }
  }
  const sold = asSafeNumber(event.current_supply, 'supply');
  const checkedIn = checkedTickets.size;
  return {
    stats: {
      sold,
      checkedIn,
      remaining: Math.max(sold - checkedIn, 0),
      unresolved: unresolvedTickets.size,
    },
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
      case 'stats':
        return json(await stats(admin, user.id, body));
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
        return json({ error: 'Unknown check-in-operation action.' }, 400);
    }
  } catch (error) {
    console.error('[check-in-operation]', error instanceof Error ? error.message : error);
    return json({
      error: error instanceof Error ? error.message : 'Check-in operation failed.',
    }, 400);
  }
});
