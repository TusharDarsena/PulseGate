import {
  TransactionBuilder,
  nativeToScVal,
  rpc,
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

type DraftState =
  | 'prepared'
  | 'creation_submitting'
  | 'chain_created'
  | 'publication_failed'
  | 'published';

interface PublicationDraft {
  draft_id: string;
  user_id: string;
  event_id: string;
  intended_organizer_address: string;
  expected_name: string;
  expected_date_unix: number;
  expected_capacity: number;
  expected_price_per_ticket: number;
  network: string;
  ticket_contract_id: string;
  state: DraftState;
  creation_tx_hash: string | null;
}

interface ChainEvent {
  organizer: string;
  name: string;
  date_unix: bigint | number;
  capacity: bigint | number;
  price_per_ticket: bigint | number;
  current_supply: bigint | number;
  status: { tag: string } | string;
}

function asSafeNumber(value: bigint | number, field: string): number {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Authoritative ${field} exceeds the supported testnet range.`);
  }
  return number;
}

function unwrapEventResult(value: unknown): ChainEvent {
  const result = value as {
    isErr?: () => boolean;
    unwrap?: () => unknown;
    tag?: string;
    values?: unknown[];
  };
  if (typeof result?.isErr === 'function' && result.isErr()) {
    throw new Error('The reserved event does not exist on the configured TicketContract.');
  }
  const unwrapped = typeof result?.unwrap === 'function'
    ? result.unwrap()
    : result?.tag === 'Ok'
      ? result.values?.[0]
      : value;
  if (!unwrapped || typeof unwrapped !== 'object') {
    throw new Error('The TicketContract returned an invalid event record.');
  }
  return unwrapped as ChainEvent;
}

function statusTag(value: ChainEvent['status']): 'Active' | 'Cancelled' | 'Completed' {
  const tag = typeof value === 'string' ? value : value?.tag;
  if (tag !== 'Active' && tag !== 'Cancelled' && tag !== 'Completed') {
    throw new Error('The TicketContract returned an unsupported event status.');
  }
  return tag;
}

async function loadDraft(
  admin: ReturnType<typeof createClient>,
  userId: string,
  draftId: unknown,
): Promise<PublicationDraft> {
  if (typeof draftId !== 'string' || !draftId) throw new Error('Missing publication draft ID.');
  const { data, error } = await admin
    .from('event_publication_drafts')
    .select(`
      draft_id,
      user_id,
      event_id,
      intended_organizer_address,
      expected_name,
      expected_date_unix,
      expected_capacity,
      expected_price_per_ticket,
      network,
      ticket_contract_id,
      state,
      creation_tx_hash
    `)
    .eq('draft_id', draftId)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('Publication draft not found.');
  return data as PublicationDraft;
}

function assertConfiguredDraft(draft: PublicationDraft) {
  if (draft.network !== required('STELLAR_NETWORK')) {
    throw new Error('The draft belongs to a different Stellar network.');
  }
  if (draft.ticket_contract_id !== required('TICKET_CONTRACT_ID')) {
    throw new Error('The draft belongs to a different TicketContract.');
  }
}

async function markFailure(
  admin: ReturnType<typeof createClient>,
  draft: PublicationDraft,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : 'Publication failed.';
  await admin
    .from('event_publication_drafts')
    .update({
      state: 'publication_failed',
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq('draft_id', draft.draft_id)
    .neq('state', 'published');
}

async function verifyTransaction(
  server: rpc.Server,
  draft: PublicationDraft,
  transactionHash: string,
) {
  const response = await server.getTransaction(transactionHash);
  if (response.status === 'NOT_FOUND') {
    throw new Error('The creation transaction is not visible yet. Retry publication shortly.');
  }
  if (response.status !== 'SUCCESS') {
    throw new Error('The recorded creation transaction was not successful.');
  }

  const envelopeXdr = 'envelopeXdr' in response ? response.envelopeXdr : undefined;
  if (typeof envelopeXdr !== 'string') {
    throw new Error('The creation transaction envelope is unavailable.');
  }
  const transaction = TransactionBuilder.fromXDR(
    envelopeXdr,
    required('STELLAR_NETWORK_PASSPHRASE'),
  );
  if (transaction.source !== draft.intended_organizer_address) {
    throw new Error('The creation transaction source does not match the intended organizer.');
  }
}

async function verifySuccessfulTransaction(server: rpc.Server, transactionHash: string) {
  const response = await server.getTransaction(transactionHash);
  if (response.status === 'NOT_FOUND') {
    throw new Error('The transaction is not visible yet. Retry synchronization shortly.');
  }
  if (response.status !== 'SUCCESS') {
    throw new Error('The recorded transaction was not successful.');
  }
}

async function refreshPublishedEvent(
  admin: ReturnType<typeof createClient>,
  eventId: unknown,
  transactionHash: unknown,
) {
  if (typeof eventId !== 'string' || !eventId) throw new Error('Missing event ID.');
  if (typeof transactionHash !== 'string' || !transactionHash) {
    throw new Error('Missing confirmed transaction hash.');
  }
  const { data: published, error: publishedError } = await admin
    .from('events')
    .select('event_id, network, ticket_contract_id, chain_verified_at')
    .eq('event_id', eventId)
    .not('chain_verified_at', 'is', null)
    .single();
  if (publishedError || !published) throw new Error('Trusted published event not found.');
  if (published.network !== required('STELLAR_NETWORK') ||
      published.ticket_contract_id !== required('TICKET_CONTRACT_ID')) {
    throw new Error('The published event belongs to a different Stellar deployment.');
  }

  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  await verifySuccessfulTransaction(server, transactionHash);
  const queried = await server.queryContract<unknown>(
    published.ticket_contract_id,
    'get_event',
    { event_id: eventId },
  );
  const event = unwrapEventResult(queried.result);
  if (event.organizer === undefined || event.name === undefined) {
    throw new Error('The TicketContract returned an invalid event record.');
  }
  const { error } = await admin.rpc('refresh_verified_event_state', {
    refreshed_event_id: eventId,
    verified_current_supply: asSafeNumber(event.current_supply, 'supply'),
    verified_status: statusTag(event.status),
    verified_at: new Date().toISOString(),
  });
  if (error) throw error;
  return { state: 'refreshed', eventId, transactionHash };
}

async function findCreationTransactionHash(
  server: rpc.Server,
  draft: PublicationDraft,
): Promise<string | null> {
  const latest = await server.getLatestLedger();
  const response = await server.getEvents({
    startLedger: Math.max(1, latest.sequence - 120_000),
    filters: [{
      type: 'contract',
      contractIds: [draft.ticket_contract_id],
      topics: [[
        nativeToScVal('ev_create', { type: 'symbol' }).toXDR('base64'),
        nativeToScVal(draft.event_id, { type: 'string' }).toXDR('base64'),
      ]],
    }],
    limit: 100,
  });
  const match = response.events.find((event) => event.contractId === draft.ticket_contract_id);
  return match?.txHash ?? null;
}

async function verifyAndPublish(
  admin: ReturnType<typeof createClient>,
  draft: PublicationDraft,
  transactionHash: string,
) {
  assertConfiguredDraft(draft);
  const server = new rpc.Server(required('STELLAR_RPC_URL'));

  await verifyTransaction(server, draft, transactionHash);

  const queried = await server.queryContract<unknown>(
    draft.ticket_contract_id,
    'get_event',
    { event_id: draft.event_id },
  );
  const event = unwrapEventResult(queried.result);
  const verifiedAt = new Date().toISOString();

  const { error } = await admin.rpc('publish_verified_event', {
    draft_owner_id: draft.user_id,
    reserved_event_id: draft.event_id,
    verified_organizer_address: event.organizer,
    verified_name: event.name,
    verified_date_unix: asSafeNumber(event.date_unix, 'start time'),
    verified_capacity: asSafeNumber(event.capacity, 'capacity'),
    verified_price_per_ticket: asSafeNumber(event.price_per_ticket, 'price'),
    verified_current_supply: asSafeNumber(event.current_supply, 'supply'),
    verified_status: statusTag(event.status),
    verified_transaction_hash: transactionHash,
    verified_at: verifiedAt,
  });
  if (error) throw error;

  return {
    eventId: draft.event_id,
    transactionHash,
    state: 'published' as const,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let draft: PublicationDraft | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = required('SUPABASE_URL');
    const authHeader = request.headers.get('Authorization') ?? '';
    const authClient = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return json({ error: 'Authentication required.' }, 401);

    admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'));
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'refresh-event') {
      return json(await refreshPublishedEvent(
        admin,
        body.eventId,
        body.transactionHash,
      ));
    }
    draft = await loadDraft(admin, user.id, body.draftId);
    const action = body.action;

    if (action === 'begin-creation') {
      if (draft.state !== 'prepared') {
        throw new Error('This draft is not ready for a new creation submission.');
      }
      const { error } = await admin
        .from('event_publication_drafts')
        .update({
          state: 'creation_submitting',
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('draft_id', draft.draft_id)
        .eq('state', 'prepared');
      if (error) throw error;
      return json({ state: 'creation_submitting' });
    }

    if (action === 'recover-submission') {
      if (draft.state !== 'creation_submitting') {
        throw new Error('Only an interrupted creation submission can be recovered.');
      }
      const server = new rpc.Server(required('STELLAR_RPC_URL'));
      try {
        const queried = await server.queryContract<unknown>(
          draft.ticket_contract_id,
          'get_event',
          { event_id: draft.event_id },
        );
        unwrapEventResult(queried.result);
        const recoveredHash = await findCreationTransactionHash(server, draft);
        if (!recoveredHash) {
          throw new Error(
            'The event exists on-chain, but its creation transaction could not be recovered automatically.',
          );
        }
        await admin
          .from('event_publication_drafts')
          .update({
            state: 'chain_created',
            creation_tx_hash: recoveredHash,
            last_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('draft_id', draft.draft_id);
        return json(await verifyAndPublish(admin, draft, recoveredHash));
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const eventMissing =
          message.includes('EventNotFound') ||
          message.includes('Contract, #3') ||
          message.includes('reserved event does not exist');
        if (!eventMissing) {
          throw error;
        }
      }
      const { error } = await admin
        .from('event_publication_drafts')
        .update({
          state: 'prepared',
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('draft_id', draft.draft_id)
        .eq('state', 'creation_submitting');
      if (error) throw error;
      return json({ state: 'prepared' });
    }

    if (action === 'publish' || action === 'retry-publication') {
      const suppliedHash = typeof body.transactionHash === 'string'
        ? body.transactionHash
        : draft.creation_tx_hash;
      if (!suppliedHash) {
        throw new Error('The creation transaction hash is required for publication.');
      }
      await admin
        .from('event_publication_drafts')
        .update({
          state: 'chain_created',
          creation_tx_hash: suppliedHash,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('draft_id', draft.draft_id)
        .neq('state', 'published');
      return json(await verifyAndPublish(admin, draft, suppliedHash));
    }

    return json({ error: 'Unknown event publication action.' }, 400);
  } catch (error) {
    if (admin && draft) await markFailure(admin, draft, error);
    console.error('[event-publication]', error instanceof Error ? error.message : error);
    return json({
      error: error instanceof Error ? error.message : 'Event publication failed.',
    }, 400);
  }
});
