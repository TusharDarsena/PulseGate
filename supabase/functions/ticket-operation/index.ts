import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { rpc } from 'npm:@stellar/stellar-sdk@16.1.0';
import {
  asSafeNumber,
  eventStatus,
  isProvablyExpiredWithoutSubmission,
  listingStatus,
  readAuthoritativeEvent,
  readAuthoritativeListing,
  readAuthoritativeTicket,
  resolveExactTicketOperationEvent,
  ticketStatus,
  type TicketOperationEventTopic,
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

function requirePositiveBigInt(value: unknown, label: string): bigint {
  try {
    const amount = BigInt(String(value));
    if (amount <= 0n) throw new Error();
    return amount;
  } catch {
    throw new Error(`Invalid ${label}.`);
  }
}

type AdminClient = ReturnType<typeof createClient>;
type OperationType = 'refund' | 'create_listing' | 'cancel_listing' | 'buy_listing';

interface TicketOperation {
  operation_id: string;
  request_idempotency_key: string;
  user_id: string;
  operation_type: OperationType;
  actor_address: string;
  ticket_id: string;
  event_id: string;
  seller_address: string | null;
  buyer_address: string | null;
  listing_id: string | null;
  amount_stroops: string | number;
  network: string;
  ticket_contract_id: string;
  marketplace_contract_id: string;
  state: string;
  unsigned_envelope_hash: string | null;
  signed_transaction_hash: string | null;
  source_sequence: string | null;
  transaction_max_time: number | null;
  verified_event_topic: string | null;
  verified_event_entity_id: string | null;
  verified_event_actor: string | null;
  verified_event_amount_stroops: string | number | null;
  verified_ledger_sequence: number | null;
  verified_ledger_closed_at: string | null;
  confirmed_at: string | null;
  synchronized_at: string | null;
  failure_category: string | null;
  failure_detail: string | null;
  created_at: string;
  updated_at: string;
}

interface AttendeeWallet {
  address: string;
  network: string;
  readiness: string;
}

function operationResponse(operation: TicketOperation) {
  return {
    ...operation,
    transaction_hash: operation.signed_transaction_hash,
    chain_confirmed_at: operation.confirmed_at,
    last_error: operation.failure_detail,
  };
}

function requireOperationType(value: unknown): OperationType {
  if (
    value !== 'refund' &&
    value !== 'create_listing' &&
    value !== 'cancel_listing' &&
    value !== 'buy_listing'
  ) {
    throw new Error('Unsupported ticket operation.');
  }
  return value;
}

async function loadWallet(admin: AdminClient, userId: string): Promise<AttendeeWallet> {
  const { data, error } = await admin
    .from('attendee_wallets')
    .select('address,network,readiness')
    .eq('user_id', userId)
    .single();
  if (error || !data || data.readiness !== 'ready' || !data.address) {
    throw new Error('A ready attendee wallet is required.');
  }
  if (data.network !== required('STELLAR_NETWORK')) {
    throw new Error('The attendee wallet belongs to another Stellar network.');
  }
  return data as AttendeeWallet;
}

async function loadOperation(
  admin: AdminClient,
  userId: string,
  operationId: unknown,
): Promise<TicketOperation> {
  const id = requireString(operationId, 'operation ID');
  const { data, error } = await admin
    .from('ticket_operations')
    .select('*')
    .eq('operation_id', id)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('Ticket operation not found.');
  const operation = data as TicketOperation;
  if (
    operation.network !== required('STELLAR_NETWORK') ||
    operation.ticket_contract_id !== required('TICKET_CONTRACT_ID') ||
    operation.marketplace_contract_id !== required('MARKETPLACE_CONTRACT_ID')
  ) {
    throw new Error('The ticket operation belongs to another Stellar deployment.');
  }
  return operation;
}

async function allocate(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operationType = requireOperationType(body.operationType);
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotency key');
  const wallet = await loadWallet(admin, userId);
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const ticketContractId = required('TICKET_CONTRACT_ID');
  const marketplaceContractId = required('MARKETPLACE_CONTRACT_ID');

  let ticketId: string;
  let eventId: string;
  let sellerAddress: string | null = null;
  let buyerAddress: string | null = null;
  let listingId: string | null = null;
  let amount: bigint;

  if (operationType === 'refund') {
    ticketId = requireString(body.ticketId, 'ticket ID');
    const ticket = await readAuthoritativeTicket(server, ticketContractId, ticketId);
    const event = await readAuthoritativeEvent(server, ticketContractId, ticket.event_id);
    if (ticket.owner !== wallet.address) throw new Error('Ticket ownership changed.');
    if (ticketStatus(ticket.status) !== 'Active') {
      throw new Error(`Ticket is ${ticketStatus(ticket.status).toLowerCase()}.`);
    }
    if (eventStatus(event.status) !== 'Cancelled') {
      throw new Error('Refunds are available only after event cancellation.');
    }
    eventId = ticket.event_id;
    amount = BigInt(String(event.price_per_ticket));
  } else if (operationType === 'create_listing') {
    ticketId = requireString(body.ticketId, 'ticket ID');
    listingId = requireString(body.listingId, 'listing ID');
    amount = requirePositiveBigInt(body.askPriceStroops, 'ask price');
    const ticket = await readAuthoritativeTicket(server, ticketContractId, ticketId);
    const event = await readAuthoritativeEvent(server, ticketContractId, ticket.event_id);
    if (ticket.owner !== wallet.address) throw new Error('Ticket ownership changed.');
    if (ticketStatus(ticket.status) !== 'Active') {
      throw new Error(`Ticket is ${ticketStatus(ticket.status).toLowerCase()}.`);
    }
    if (eventStatus(event.status) !== 'Active') {
      throw new Error('Only tickets for active events may be listed.');
    }
    sellerAddress = wallet.address;
    eventId = ticket.event_id;
  } else {
    sellerAddress = operationType === 'cancel_listing'
      ? wallet.address
      : requireString(body.sellerAddress, 'seller address');
    listingId = requireString(body.listingId, 'listing ID');
    const listing = await readAuthoritativeListing(
      server,
      marketplaceContractId,
      sellerAddress,
      listingId,
    );
    const ticket = await readAuthoritativeTicket(
      server,
      ticketContractId,
      listing.ticket_id,
    );
    const event = await readAuthoritativeEvent(server, ticketContractId, ticket.event_id);
    if (listing.seller !== sellerAddress) throw new Error('Listing seller changed.');
    if (listingStatus(listing.status) !== 'Open') {
      throw new Error(`Listing is ${listingStatus(listing.status).toLowerCase()}.`);
    }
    ticketId = listing.ticket_id;
    eventId = ticket.event_id;
    amount = BigInt(String(listing.ask_price));

    if (operationType === 'cancel_listing') {
      if (sellerAddress !== wallet.address) {
        throw new Error('Only the original seller may cancel this listing.');
      }
    } else {
      buyerAddress = wallet.address;
      if (buyerAddress === sellerAddress) throw new Error('You cannot buy your own listing.');
      if (
        ticket.owner !== sellerAddress ||
        ticketStatus(ticket.status) !== 'Active'
      ) {
        throw new Error('Ticket ownership changed or the ticket is no longer active.');
      }
      if (eventStatus(event.status) !== 'Active') {
        throw new Error('The event is no longer active for resale.');
      }
    }
  }

  const { data, error } = await admin.rpc('allocate_ticket_operation', {
    operation_owner_id: userId,
    requested_idempotency_key: idempotencyKey,
    requested_operation_type: operationType,
    resolved_actor_address: wallet.address,
    verified_ticket_id: ticketId,
    verified_event_id: eventId,
    verified_seller_address: sellerAddress,
    verified_buyer_address: buyerAddress,
    verified_listing_id: listingId,
    verified_amount_stroops: amount.toString(),
    configured_network: required('STELLAR_NETWORK'),
    configured_ticket_contract_id: ticketContractId,
    configured_marketplace_contract_id: marketplaceContractId,
  });
  if (error || !data) throw new Error(error?.message || 'Could not allocate ticket operation.');
  return { operation: operationResponse(data as TicketOperation) };
}

async function beginAttempt(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  if (!['review', 'approval_required', 'pre_submission_failed', 'chain_failed'].includes(operation.state)) {
    throw new Error('This ticket operation already has an unresolved attempt.');
  }
  const unsignedHash = requireHash(body.unsignedEnvelopeHash, 'unsigned envelope hash');
  const sourceSequence = requireString(body.sourceSequence, 'source sequence');
  if (!/^[0-9]+$/.test(sourceSequence)) throw new Error('Invalid source sequence.');
  const maxTime = requirePositiveInteger(body.transactionMaxTime, 'transaction maximum time');
  if (maxTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('The prepared transaction has already expired.');
  }

  const { data, error } = await admin
    .from('ticket_operations')
    .update({
      state: 'approval_required',
      unsigned_envelope_hash: unsignedHash,
      signed_transaction_hash: null,
      source_sequence: sourceSequence,
      transaction_max_time: maxTime,
      verified_event_topic: null,
      verified_event_entity_id: null,
      verified_event_actor: null,
      verified_event_amount_stroops: null,
      verified_ledger_sequence: null,
      verified_ledger_closed_at: null,
      confirmed_at: null,
      synchronized_at: null,
      failure_category: null,
      failure_detail: null,
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .in('state', ['review', 'approval_required', 'pre_submission_failed', 'chain_failed'])
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not begin ticket attempt.');
  return { operation: operationResponse(data as TicketOperation) };
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
    throw new Error('This ticket operation cannot accept a signed transaction.');
  }
  if (operation.unsigned_envelope_hash !== signedHash) {
    throw new Error('The signed transaction does not match the prepared operation.');
  }
  const { data, error } = await admin
    .from('ticket_operations')
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
  return { operation: operationResponse(data as TicketOperation) };
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
    throw new Error('A possibly submitted ticket operation cannot be marked pre-submission failure.');
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
    .from('ticket_operations')
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
  return { operation: operationResponse(data as TicketOperation) };
}

async function persistResolutionState(
  admin: AdminClient,
  operation: TicketOperation,
  state: 'status_unknown' | 'chain_failed',
  category: string,
  detail: string,
) {
  const { data, error } = await admin
    .from('ticket_operations')
    .update({
      state,
      failure_category: category,
      failure_detail: detail.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .in('state', ['signed_submission_pending', 'confirmation_pending', 'status_unknown'])
    .select('*')
    .single();
  if (error || !data) throw error ?? new Error('Could not update ticket-operation status.');
  return data as TicketOperation;
}

async function synchronize(
  admin: AdminClient,
  userId: string,
  operationId: string,
) {
  let operation = await loadOperation(admin, userId, operationId);
  if (operation.state === 'complete') return { operation: operationResponse(operation) };
  if (!['chain_confirmed', 'mirror_syncing', 'sync_warning'].includes(operation.state)) {
    throw new Error('This ticket operation is not ready for synchronization.');
  }
  await admin
    .from('ticket_operations')
    .update({ state: 'mirror_syncing', updated_at: new Date().toISOString() })
    .eq('operation_id', operation.operation_id)
    .in('state', ['chain_confirmed', 'sync_warning']);

  try {
    const server = new rpc.Server(required('STELLAR_RPC_URL'));
    const ticket = await readAuthoritativeTicket(
      server,
      operation.ticket_contract_id,
      operation.ticket_id,
    );
    if (ticket.event_id !== operation.event_id) {
      throw new Error('Current ticket event does not match the confirmed operation.');
    }

    let listing: Awaited<ReturnType<typeof readAuthoritativeListing>> | null = null;
    if (operation.operation_type !== 'refund') {
      listing = await readAuthoritativeListing(
        server,
        operation.marketplace_contract_id,
        requireString(operation.seller_address, 'operation seller'),
        requireString(operation.listing_id, 'operation listing ID'),
      );
      if (
        listing.seller !== operation.seller_address ||
        listing.ticket_id !== operation.ticket_id ||
        BigInt(String(listing.ask_price)) !== BigInt(String(operation.amount_stroops))
      ) {
        throw new Error('Current listing does not match the confirmed operation.');
      }
      if (
        operation.operation_type === 'create_listing' &&
        listing.event_id !== operation.event_id
      ) {
        throw new Error('The created listing contains an unexpected event identity.');
      }
      if (
        operation.operation_type === 'cancel_listing' &&
        listingStatus(listing.status) !== 'Cancelled'
      ) {
        throw new Error('The listing is not authoritatively cancelled.');
      }
      if (
        operation.operation_type === 'buy_listing' &&
        listingStatus(listing.status) !== 'Sold'
      ) {
        throw new Error('The resale listing is not authoritatively sold.');
      }
    } else {
      const event = await readAuthoritativeEvent(
        server,
        operation.ticket_contract_id,
        operation.event_id,
      );
      if (
        ticket.owner !== operation.actor_address ||
        ticketStatus(ticket.status) !== 'Refunded' ||
        eventStatus(event.status) !== 'Cancelled'
      ) {
        throw new Error('Current ticket state does not match the confirmed refund.');
      }
    }

    const latest = await server.getLatestLedger();
    const observationLedger = asSafeNumber(latest.sequence, 'observation ledger');
    const { data, error } = await admin.rpc('finalize_ticket_operation_sync', {
      requested_operation_id: operation.operation_id,
      verified_ticket_id: operation.ticket_id,
      verified_event_id: operation.event_id,
      verified_ticket_owner: ticket.owner,
      verified_ticket_status: ticketStatus(ticket.status),
      verified_listing_seller: listing?.seller ?? null,
      verified_listing_id: operation.listing_id,
      verified_listing_ticket_id: listing?.ticket_id ?? null,
      verified_listing_event_id: listing ? ticket.event_id : null,
      verified_listing_ask_price: listing ? String(listing.ask_price) : null,
      verified_listing_status: listing ? listingStatus(listing.status) : null,
      verified_observation_ledger_sequence: observationLedger,
      verified_at: new Date().toISOString(),
      verified_network: operation.network,
      verified_ticket_contract_id: operation.ticket_contract_id,
      verified_marketplace_contract_id: operation.marketplace_contract_id,
    });
    if (error || !data) throw new Error(error?.message || 'Ticket mirror sync failed.');
    return { operation: operationResponse(data as TicketOperation) };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Ticket mirror sync failed.';
    const { data } = await admin
      .from('ticket_operations')
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
    operation = (data ?? operation) as TicketOperation;
    return { operation: operationResponse(operation) };
  }
}

function proofIdentity(operation: TicketOperation): {
  contractId: string;
  topic: TicketOperationEventTopic;
  entityId: string;
} {
  switch (operation.operation_type) {
    case 'refund':
      return {
        contractId: operation.ticket_contract_id,
        topic: 'tk_refund',
        entityId: operation.ticket_id,
      };
    case 'create_listing':
      return {
        contractId: operation.marketplace_contract_id,
        topic: 'mk_list',
        entityId: requireString(operation.listing_id, 'operation listing ID'),
      };
    case 'cancel_listing':
      return {
        contractId: operation.marketplace_contract_id,
        topic: 'mk_cancel',
        entityId: requireString(operation.listing_id, 'operation listing ID'),
      };
    case 'buy_listing':
      return {
        contractId: operation.marketplace_contract_id,
        topic: 'mk_sold',
        entityId: requireString(operation.listing_id, 'operation listing ID'),
      };
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
    throw new Error('This ticket operation has no signed transaction to resolve.');
  }

  const hash = requireHash(operation.signed_transaction_hash, 'recorded transaction hash');
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const expected = proofIdentity(operation);
  const resolution = await resolveExactTicketOperationEvent(
    server,
    required('STELLAR_NETWORK_PASSPHRASE'),
    expected.contractId,
    hash,
    operation.actor_address,
    expected.topic,
    expected.entityId,
  );

  if (resolution.status === 'failed') {
    operation = await persistResolutionState(
      admin,
      operation,
      'chain_failed',
      'chain_rejected',
      'Stellar rejected the ticket operation.',
    );
    return { operation: operationResponse(operation) };
  }
  if (resolution.status === 'not_found') {
    const expired = await isProvablyExpiredWithoutSubmission(
      server,
      operation.actor_address,
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
      `The transaction succeeded, but matching ${expected.topic} proof is unavailable.`,
    );
    return { operation: operationResponse(operation) };
  }

  const { data, error } = await admin.rpc('confirm_ticket_operation', {
    requested_operation_id: operation.operation_id,
    p_verified_transaction_hash: resolution.proof.transactionHash,
    p_verified_event_topic: resolution.proof.topic,
    p_verified_event_entity_id: resolution.proof.entityId,
    p_verified_event_actor: resolution.proof.actor,
    p_verified_event_amount_stroops: resolution.proof.amount?.toString() ?? null,
    p_verified_ledger_sequence: resolution.proof.ledgerSequence,
    p_verified_ledger_closed_at: resolution.proof.ledgerClosedAt,
  });
  if (error || !data) throw new Error(error?.message || 'Could not persist Stellar proof.');
  return synchronize(admin, userId, operation.operation_id);
}

async function listOperations(admin: AdminClient, userId: string) {
  const { data, error } = await admin
    .from('ticket_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'))
    .eq('marketplace_contract_id', required('MARKETPLACE_CONTRACT_ID'))
    .in('state', [
      'signed_submission_pending',
      'confirmation_pending',
      'status_unknown',
      'chain_confirmed',
      'mirror_syncing',
      'sync_warning',
    ])
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return {
    operations: (data as TicketOperation[] ?? []).map(operationResponse),
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
        return json(await listOperations(admin, user.id));
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
        return json({ error: 'Unknown ticket-operation action.' }, 400);
    }
  } catch (error) {
    console.error('[ticket-operation]', error instanceof Error ? error.message : error);
    return json({
      error: error instanceof Error ? error.message : 'Ticket operation failed.',
    }, 400);
  }
});
