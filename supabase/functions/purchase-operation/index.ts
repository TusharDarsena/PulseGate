import {
  nativeToScVal,
  rpc,
  scValToNative,
  Contract,
  Networks,
  TransactionBuilder,
} from 'npm:@stellar/stellar-sdk@16.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

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

function requireIntegerString(value: unknown, label: string): string {
  const text = requireString(value, label);
  if (!/^[0-9]+$/.test(text)) throw new Error(`Invalid ${label}.`);
  return text;
}

function requireNonNegativeBigint(value: unknown, label: string): bigint {
  const text = typeof value === 'number' ? String(value) : requireString(value, label);
  if (!/^[0-9]+$/.test(text)) throw new Error(`Invalid ${label}.`);
  return BigInt(text);
}

type AdminClient = ReturnType<typeof createClient>;

interface PurchaseOperation {
  operation_id: string;
  user_id: string;
  request_idempotency_key: string;
  ticket_id: string;
  event_id: string;
  attendee_wallet_address: string;
  expected_price_stroops: string | number;
  estimated_fee_stroops: string | number;
  confirmed_fee_stroops: string | number | null;
  network: string;
  ticket_contract_id: string;
  state: string;
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

interface PurchaseAttempt {
  operation_id: string;
  attempt_number: number;
  external_id: string;
  unsigned_envelope_hash: string;
  signed_transaction_hash: string | null;
  source_sequence: string;
  transaction_max_time: number;
  estimated_fee_stroops: string | number;
  state: string;
  signed_at: string | null;
}

const READ_ONLY_KEY = Deno.env.get('STELLAR_READ_ONLY_PUBLIC_KEY')
  ?? 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

function statusTag(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'tag' in value) return String((value as { tag: unknown }).tag);
  return String(value);
}

async function simulateRead(
  server: rpc.Server,
  operation: PurchaseOperation,
  method: 'get_ticket' | 'get_event',
  value: string,
) {
  const account = await server.getAccount(READ_ONLY_KEY);
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Deno.env.get('STELLAR_NETWORK_PASSPHRASE') ?? Networks.TESTNET,
  })
    .addOperation(new Contract(operation.ticket_contract_id).call(
      method,
      nativeToScVal(value, { type: 'string' }),
    ))
    .setTimeout(30)
    .build();
  const simulated = await server.simulateTransaction(tx);
  if ('error' in simulated || !simulated.results || simulated.results.length !== 1) {
    throw new Error('The TicketContract state is temporarily unavailable.');
  }
  return scValToNative(simulated.results[0].retval) as Record<string, unknown>;
}

async function readSorobanState(server: rpc.Server, operation: PurchaseOperation) {
  const ticketResult = await simulateRead(server, operation, 'get_ticket', operation.ticket_id);
  const ticket = ticketResult && 'Ok' in ticketResult ? ticketResult.Ok as Record<string, unknown> : ticketResult;
  if (!ticket || String(ticket.event_id) !== operation.event_id) {
    throw new Error('The verified ticket belongs to a different event.');
  }
  const eventResult = await simulateRead(server, operation, 'get_event', operation.event_id);
  const event = eventResult && 'Ok' in eventResult ? eventResult.Ok as Record<string, unknown> : eventResult;
  if (!ticket || !event) throw new Error('The TicketContract record could not be read.');
  return {
    owner: String(ticket.owner), eventId: String(ticket.event_id), status: statusTag(ticket.status),
    eventStatus: statusTag(event.status), currentSupply: BigInt(String(event.current_supply)),
    capacity: BigInt(String(event.capacity)),
  };
}

async function synchronizePurchase(admin: AdminClient, userId: string, operationId: unknown) {
  let operation = await loadOperation(admin, userId, operationId);
  if (operation.state === 'complete') return operationResponse(admin, operation);
  const synchronizable = ['chain_confirmed', 'mirror_syncing', 'sync_warning'];
  if (!synchronizable.includes(operation.state)) {
    throw new Error('This purchase has not been confirmed on Stellar.');
  }
  const { error: syncingError } = await admin.from('purchase_operations').update({
    state: 'mirror_syncing', failure_category: null, failure_detail: null, updated_at: new Date().toISOString(),
  }).eq('operation_id', operation.operation_id).in('state', synchronizable);
  if (syncingError) throw syncingError;
  operation = await loadOperation(admin, userId, operation.operation_id);
  if (operation.state === 'complete') return operationResponse(admin, operation);
  if (!synchronizable.includes(operation.state)) {
    throw new Error('This purchase is no longer ready for synchronization.');
  }
  try {
    const chain = await readSorobanState(new rpc.Server(required('STELLAR_RPC_URL')), operation);
    const { data, error } = await admin.rpc('finalize_verified_purchase_sync', {
      requested_operation_id: operation.operation_id,
      verified_ticket_id: operation.ticket_id,
      verified_event_id: chain.eventId,
      verified_owner_address: chain.owner,
      verified_ticket_status: chain.status,
      verified_event_status: chain.eventStatus,
      verified_event_supply: chain.currentSupply.toString(),
      verified_event_capacity: chain.capacity.toString(),
      verified_transaction_hash: operation.transaction_hash,
      verified_ledger_sequence: operation.ledger_sequence,
      verified_at: new Date().toISOString(),
      verified_network: required('STELLAR_NETWORK'),
      verified_ticket_contract_id: required('TICKET_CONTRACT_ID'),
    });
    if (error || !data) throw new Error(error?.message || 'The ticket mirror could not be finalized.');
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Ticket synchronization is delayed.';
    await admin.from('purchase_operations').update({
      state: 'sync_warning', failure_category: 'synchronization_error',
      failure_detail: detail.slice(0, 1000), updated_at: new Date().toISOString(),
    }).eq('operation_id', operation.operation_id).eq('state', 'mirror_syncing');
  }
  return operationResponse(admin, await loadOperation(admin, userId, operation.operation_id));
}

async function loadOperationForTicket(
  admin: AdminClient,
  userId: string,
  ticketIdValue: unknown,
) {
  const ticketId = requireString(ticketIdValue, 'ticket ID');
  const { data, error } = await admin
    .from('purchase_operations')
    .select('*')
    .eq('user_id', userId)
    .eq('ticket_id', ticketId)
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'))
    .in('state', ['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'])
    .order('confirmed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? operationResponse(admin, data as PurchaseOperation) : null;
}

async function loadWallet(admin: AdminClient, userId: string) {
  const { data, error } = await admin
    .from('attendee_wallets')
    .select('address,network,readiness')
    .eq('user_id', userId)
    .single();
  if (error || !data || data.readiness !== 'ready' || !data.address) {
    throw new Error('The recorded attendee wallet is not ready.');
  }
  if (data.network !== required('STELLAR_NETWORK')) {
    throw new Error('The attendee wallet belongs to a different Stellar network.');
  }
  return data as { address: string; network: string; readiness: string };
}

async function loadOperation(admin: AdminClient, userId: string, operationId: unknown) {
  const id = requireString(operationId, 'purchase operation ID');
  const { data, error } = await admin
    .from('purchase_operations')
    .select('*')
    .eq('operation_id', id)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('Purchase operation not found.');
  const operation = data as PurchaseOperation;
  if (
    operation.network !== required('STELLAR_NETWORK') ||
    operation.ticket_contract_id !== required('TICKET_CONTRACT_ID')
  ) {
    throw new Error('The purchase operation belongs to a different Stellar deployment.');
  }
  return operation;
}

async function loadLatestAttempt(admin: AdminClient, operationId: string) {
  const { data, error } = await admin
    .from('purchase_operation_attempts')
    .select('*')
    .eq('operation_id', operationId)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as PurchaseAttempt | null;
}

async function operationResponse(admin: AdminClient, operation: PurchaseOperation) {
  return {
    operation,
    attempt: await loadLatestAttempt(admin, operation.operation_id),
  };
}

async function allocate(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const eventId = requireString(body.eventId, 'event ID');
  const idempotencyKey = requireString(body.idempotencyKey, 'idempotency key');
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) throw new Error('Invalid idempotency key.');

  const wallet = await loadWallet(admin, userId);
  const { data: event, error: eventError } = await admin
    .from('events')
    .select('event_id,price_per_ticket,network,ticket_contract_id,chain_verified_at')
    .eq('event_id', eventId)
    .not('chain_verified_at', 'is', null)
    .single();
  if (eventError || !event) throw new Error('Trusted published event not found.');
  if (
    event.network !== required('STELLAR_NETWORK') ||
    event.ticket_contract_id !== required('TICKET_CONTRACT_ID')
  ) {
    throw new Error('The event belongs to a different Stellar deployment.');
  }

  const { data, error } = await admin.rpc('allocate_purchase_operation', {
    operation_owner_id: userId,
    requested_idempotency_key: idempotencyKey,
    requested_event_id: eventId,
    resolved_wallet_address: wallet.address,
    verified_expected_price_stroops: event.price_per_ticket,
    configured_network: required('STELLAR_NETWORK'),
    configured_ticket_contract_id: required('TICKET_CONTRACT_ID'),
  });
  if (error || !data) throw new Error(error?.message || 'Could not reserve the purchase operation.');
  return operationResponse(admin, data as PurchaseOperation);
}

async function beginAttempt(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  const unsignedHash = requireHash(body.unsignedEnvelopeHash, 'unsigned envelope hash');
  const sourceSequence = requireIntegerString(body.sourceSequence, 'source sequence');
  const maxTime = Number(requireNonNegativeBigint(body.transactionMaxTime, 'transaction maximum time'));
  const fee = requireNonNegativeBigint(body.estimatedFeeStroops, 'estimated fee');
  if (!Number.isSafeInteger(maxTime) || maxTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('The prepared transaction has already expired.');
  }

  const { data, error } = await admin.rpc('begin_purchase_attempt', {
    operation_owner_id: userId,
    requested_operation_id: operation.operation_id,
    provided_unsigned_envelope_hash: unsignedHash,
    provided_source_sequence: sourceSequence,
    provided_transaction_max_time: maxTime,
    provided_estimated_fee_stroops: fee.toString(),
  });
  if (error || !data) throw new Error(error?.message || 'Could not begin the purchase attempt.');
  return {
    operation: (await loadOperation(admin, userId, operation.operation_id)),
    attempt: data as PurchaseAttempt,
  };
}

async function recordSignedAttempt(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  const attemptNumber = Number(body.attemptNumber);
  const signedHash = requireHash(body.signedTransactionHash, 'signed transaction hash');
  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    throw new Error('Invalid purchase attempt number.');
  }

  const { data: attempt, error: attemptError } = await admin
    .from('purchase_operation_attempts')
    .select('*')
    .eq('operation_id', operation.operation_id)
    .eq('attempt_number', attemptNumber)
    .single();
  if (attemptError || !attempt) throw new Error('Purchase attempt not found.');
  if (attempt.unsigned_envelope_hash !== signedHash) {
    throw new Error('The signed transaction does not match the prepared transaction.');
  }
  if (!['approval_required', 'signed_submission_pending'].includes(attempt.state)) {
    throw new Error('This purchase attempt cannot accept a signed transaction.');
  }

  const signedAt = new Date().toISOString();
  const { error: updateAttemptError } = await admin
    .from('purchase_operation_attempts')
    .update({
      signed_transaction_hash: signedHash,
      state: 'signed_submission_pending',
      signed_at: signedAt,
      failure_category: null,
      failure_detail: null,
    })
    .eq('operation_id', operation.operation_id)
    .eq('attempt_number', attemptNumber);
  if (updateAttemptError) throw updateAttemptError;

  const { error: updateOperationError } = await admin
    .from('purchase_operations')
    .update({
      state: 'signed_submission_pending',
      transaction_hash: signedHash,
      failure_category: null,
      failure_detail: null,
      updated_at: signedAt,
    })
    .eq('operation_id', operation.operation_id)
    .eq('current_attempt_number', attemptNumber);
  if (updateOperationError) throw updateOperationError;

  return operationResponse(
    admin,
    await loadOperation(admin, userId, operation.operation_id),
  );
}

async function recordPreSubmissionFailure(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  const attemptNumber = Number(body.attemptNumber);
  const category = requireString(body.category, 'failure category');
  const allowed = new Set([
    'approval_rejected',
    'approval_expired',
    'preparation_failed',
    'signing_provider_failed',
  ]);
  if (!allowed.has(category)) throw new Error('Unsupported pre-submission failure category.');
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 1000) : null;

  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    if (category !== 'preparation_failed' || !['review', 'preparing'].includes(operation.state)) {
      throw new Error('This operation cannot accept a preparation failure.');
    }
    await admin
      .from('purchase_operations')
      .update({
        state: 'pre_submission_failed',
        failure_category: category,
        failure_detail: detail,
        updated_at: new Date().toISOString(),
      })
      .eq('operation_id', operation.operation_id);
    return operationResponse(
      admin,
      await loadOperation(admin, userId, operation.operation_id),
    );
  }

  const { data: attempt, error } = await admin
    .from('purchase_operation_attempts')
    .select('state,signed_transaction_hash')
    .eq('operation_id', operation.operation_id)
    .eq('attempt_number', attemptNumber)
    .single();
  if (error || !attempt) throw new Error('Purchase attempt not found.');
  if (attempt.signed_transaction_hash || attempt.state === 'signed_submission_pending') {
    throw new Error('A signed attempt cannot be marked as a pre-submission failure.');
  }

  await admin
    .from('purchase_operation_attempts')
    .update({
      state: 'pre_submission_failed',
      failure_category: category,
      failure_detail: detail,
      resolved_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id)
    .eq('attempt_number', attemptNumber);
  await admin
    .from('purchase_operations')
    .update({
      state: 'pre_submission_failed',
      failure_category: category,
      failure_detail: detail,
      updated_at: new Date().toISOString(),
    })
    .eq('operation_id', operation.operation_id);

  return operationResponse(
    admin,
    await loadOperation(admin, userId, operation.operation_id),
  );
}

async function findPurchaseEvent(server: rpc.Server, operation: PurchaseOperation) {
  const latest = await server.getLatestLedger();
  const response = await server.getEvents({
    startLedger: Math.max(1, latest.sequence - 120_000),
    filters: [{
      type: 'contract',
      contractIds: [operation.ticket_contract_id],
      topics: [[
        nativeToScVal('tk_buy', { type: 'symbol' }).toXDR('base64'),
        nativeToScVal(operation.ticket_id, { type: 'string' }).toXDR('base64'),
      ]],
    }],
    limit: 100,
  });

  for (const event of response.events) {
    const payload = scValToNative(event.value) as unknown;
    if (!Array.isArray(payload) || payload.length !== 2) continue;
    const [buyer, eventId] = payload.map(String);
    if (
      buyer === operation.attendee_wallet_address &&
      eventId === operation.event_id &&
      event.inSuccessfulContractCall
    ) {
      return event;
    }
  }
  return null;
}

async function confirmFromEvent(
  admin: AdminClient,
  userId: string,
  operation: PurchaseOperation,
  event: Awaited<ReturnType<typeof findPurchaseEvent>> & object,
  server: rpc.Server,
) {
  const transaction = await server.getTransaction(event.txHash);
  if (transaction.status !== 'SUCCESS') {
    throw new Error('The purchase event transaction is not successful.');
  }
  const fee = transaction.resultXdr.feeCharged().toString();
  const { data: published, error: publishedError } = await admin
    .from('events')
    .select('name,date_unix,timezone,venue')
    .eq('event_id', operation.event_id)
    .not('chain_verified_at', 'is', null)
    .single();
  if (publishedError || !published) throw new Error('Published receipt metadata is unavailable.');

  const confirmedAt = event.ledgerClosedAt;
  const update = {
    state: 'chain_confirmed',
    transaction_hash: event.txHash,
    confirmed_fee_stroops: fee,
    ledger_sequence: event.ledger,
    ledger_closed_at: confirmedAt,
    receipt_event_name: published.name,
    receipt_event_start_unix: published.date_unix,
    receipt_event_timezone: published.timezone,
    receipt_venue: published.venue,
    receipt_owner_address: operation.attendee_wallet_address,
    receipt_amount_stroops: operation.expected_price_stroops,
    failure_category: null,
    failure_detail: null,
    confirmed_at: confirmedAt,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from('purchase_operations')
    .update(update)
    .eq('operation_id', operation.operation_id)
    .in('state', [
      'signed_submission_pending',
      'confirming',
      'status_unknown',
      'chain_confirmed',
    ]);
  if (error) throw error;
  await admin
    .from('purchase_operation_attempts')
    .update({
      state: 'chain_confirmed',
      signed_transaction_hash: event.txHash,
      submitted_at: confirmedAt,
      resolved_at: confirmedAt,
      failure_category: null,
      failure_detail: null,
    })
    .eq('operation_id', operation.operation_id)
    .eq('signed_transaction_hash', event.txHash);

  return operationResponse(
    admin,
    await loadOperation(admin, userId, operation.operation_id),
  );
}

async function persistUnknownStatus(
  admin: AdminClient,
  operation: PurchaseOperation,
  attempt: PurchaseAttempt,
  detail: string,
) {
  const { error: attemptError } = await admin.from('purchase_operation_attempts').update({
    state: 'status_unknown',
    failure_category: 'status_unavailable',
    failure_detail: detail,
  })
    .eq('operation_id', operation.operation_id)
    .eq('attempt_number', attempt.attempt_number)
    .in('state', ['signed_submission_pending', 'confirming', 'status_unknown']);
  if (attemptError) throw attemptError;
  const { error: operationError } = await admin.from('purchase_operations').update({
    state: 'status_unknown',
    failure_category: 'status_unavailable',
    failure_detail: detail,
    updated_at: new Date().toISOString(),
  })
    .eq('operation_id', operation.operation_id)
    .in('state', ['signed_submission_pending', 'confirming', 'status_unknown']);
  if (operationError) throw operationError;
}

async function resolve(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const operation = await loadOperation(admin, userId, body.operationId);
  if (operation.state === 'complete') return operationResponse(admin, operation);
  if (operation.state === 'chain_confirmed' || operation.state === 'sync_warning' || operation.state === 'mirror_syncing') {
    return synchronizePurchase(admin, userId, operation.operation_id);
  }

  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const attempt = await loadLatestAttempt(admin, operation.operation_id);
  let purchaseEvent: Awaited<ReturnType<typeof findPurchaseEvent>>;
  try {
    purchaseEvent = await findPurchaseEvent(server, operation);
  } catch (error) {
    if (!attempt?.signed_transaction_hash) throw error;
    await persistUnknownStatus(
      admin,
      operation,
      attempt,
      'Stellar RPC is temporarily unavailable while checking the signed transaction.',
    );
    return operationResponse(
      admin,
      await loadOperation(admin, userId, operation.operation_id),
    );
  }
  if (purchaseEvent) {
    try {
      const confirmed = await confirmFromEvent(admin, userId, operation, purchaseEvent, server);
      return synchronizePurchase(admin, userId, confirmed.operation.operation_id);
    } catch (error) {
      if (!attempt?.signed_transaction_hash) throw error;
      await persistUnknownStatus(
        admin,
        operation,
        attempt,
        'The purchase event was found, but its confirmation details are temporarily unavailable.',
      );
      return operationResponse(
        admin,
        await loadOperation(admin, userId, operation.operation_id),
      );
    }
  }

  if (!attempt?.signed_transaction_hash) return operationResponse(admin, operation);

  let transaction: Awaited<ReturnType<rpc.Server['getTransaction']>>;
  try {
    transaction = await server.getTransaction(attempt.signed_transaction_hash);
  } catch {
    await persistUnknownStatus(
      admin,
      operation,
      attempt,
      'Stellar RPC is temporarily unavailable while checking the signed transaction.',
    );
    return operationResponse(
      admin,
      await loadOperation(admin, userId, operation.operation_id),
    );
  }
  if (transaction.status === 'FAILED') {
    const detail = 'Stellar definitively rejected the signed purchase transaction.';
    await admin.from('purchase_operation_attempts').update({
      state: 'chain_failed',
      failure_category: 'chain_rejected',
      failure_detail: detail,
      resolved_at: new Date().toISOString(),
    }).eq('operation_id', operation.operation_id).eq('attempt_number', attempt.attempt_number);
    await admin.from('purchase_operations').update({
      state: 'chain_failed',
      failure_category: 'chain_rejected',
      failure_detail: detail,
      updated_at: new Date().toISOString(),
    })
      .eq('operation_id', operation.operation_id)
      .in('state', ['signed_submission_pending', 'confirming', 'status_unknown']);
    return operationResponse(
      admin,
      await loadOperation(admin, userId, operation.operation_id),
    );
  }

  if (transaction.status === 'SUCCESS') {
    await persistUnknownStatus(
      admin,
      operation,
      attempt,
      'The transaction succeeded, but its immutable purchase event is temporarily unavailable.',
    );
    return operationResponse(
      admin,
      await loadOperation(admin, userId, operation.operation_id),
    );
  }

  await persistUnknownStatus(
    admin,
    operation,
    attempt,
    'The signed transaction is not yet visible on Stellar.',
  );
  return operationResponse(
    admin,
    await loadOperation(admin, userId, operation.operation_id),
  );
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
      case 'get':
        {
          const loaded = await loadOperation(admin, user.id, body.operationId);
          return json(['chain_confirmed', 'mirror_syncing', 'sync_warning'].includes(loaded.state)
            ? await synchronizePurchase(admin, user.id, loaded.operation_id)
            : await operationResponse(admin, loaded));
        }
      case 'begin-attempt':
        return json(await beginAttempt(admin, user.id, body));
      case 'mark-preparing': {
        const operation = await loadOperation(admin, user.id, body.operationId);
        if (!['review', 'pre_submission_failed'].includes(operation.state)) {
          throw new Error('This purchase operation cannot be prepared again.');
        }
        const { error } = await admin.from('purchase_operations').update({
          state: 'preparing',
          failure_category: null,
          failure_detail: null,
          updated_at: new Date().toISOString(),
        }).eq('operation_id', operation.operation_id);
        if (error) throw error;
        return json(await operationResponse(
          admin,
          await loadOperation(admin, user.id, operation.operation_id),
        ));
      }
      case 'mark-review-ready': {
        const operation = await loadOperation(admin, user.id, body.operationId);
        if (operation.state !== 'preparing') {
          throw new Error('This purchase operation is not being prepared.');
        }
        const fee = requireNonNegativeBigint(body.estimatedFeeStroops, 'estimated fee');
        const { error } = await admin.from('purchase_operations').update({
          state: 'review',
          estimated_fee_stroops: fee.toString(),
          failure_category: null,
          failure_detail: null,
          updated_at: new Date().toISOString(),
        }).eq('operation_id', operation.operation_id);
        if (error) throw error;
        return json(await operationResponse(
          admin,
          await loadOperation(admin, user.id, operation.operation_id),
        ));
      }
      case 'record-signed-attempt':
        return json(await recordSignedAttempt(admin, user.id, body));
      case 'pre-submission-failed':
        return json(await recordPreSubmissionFailure(admin, user.id, body));
      case 'resolve':
        return json(await resolve(admin, user.id, body));
      case 'retry-purchase-sync':
        return json(await synchronizePurchase(admin, user.id, body.operationId));
      case 'get-ticket-operation':
        return json({ result: await loadOperationForTicket(admin, user.id, body.ticketId) });
      case 'list-pending-sync': {
        const { data, error } = await admin.from('purchase_operations').select('*')
          .eq('user_id', user.id).in('state', ['chain_confirmed', 'mirror_syncing', 'sync_warning'])
          .eq('network', required('STELLAR_NETWORK'))
          .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'))
          .order('updated_at', { ascending: false }).limit(10);
        if (error) throw error;
        return json({ operations: await Promise.all((data as PurchaseOperation[] ?? []).map((item) => operationResponse(admin, item))) });
      }
      default:
        return json({ error: 'Unknown purchase-operation action.' }, 400);
    }
  } catch (error) {
    console.error('[purchase-operation]', error instanceof Error ? error.message : error);
    return json({
      error: error instanceof Error ? error.message : 'Purchase operation failed.',
    }, 400);
  }
});
