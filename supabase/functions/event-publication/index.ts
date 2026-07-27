import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { rpc } from 'npm:@stellar/stellar-sdk@16.1.0';
import {
  asSafeNumber,
  eventStatus,
  isProvablyExpiredWithoutSubmission,
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

interface PublicationDraft {
  draft_id: string;
  user_id: string;
  event_id: string;
  intended_organizer_address: string | null;
  expected_name: string | null;
  expected_date_unix: number | null;
  end_unix: number | null;
  expected_capacity: number | null;
  expected_price_per_ticket: number | null;
  network: string;
  ticket_contract_id: string;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  category: string | null;
  timezone: string | null;
  venue: string | null;
  address: string | null;
  city: string | null;
  organizer_display_name: string | null;
  support_contact: string | null;
  entry_instructions: string | null;
  state: string;
  revision: number;
  unsigned_envelope_hash: string | null;
  signed_transaction_hash: string | null;
  source_sequence: string | null;
  transaction_max_time: number | null;
  submission_replacement_allowed: boolean;
  creation_tx_hash: string | null;
  last_error: string | null;
  updated_at: string;
}

const draftSelect = `
  draft_id,user_id,event_id,intended_organizer_address,expected_name,
  expected_date_unix,end_unix,expected_capacity,expected_price_per_ticket,
  network,ticket_contract_id,summary,description,image_url,category,timezone,
  venue,address,city,organizer_display_name,support_contact,entry_instructions,
  accessibility_notes,age_restriction,prohibited_items,map_url,public_links,
  completeness,state,revision,unsigned_envelope_hash,signed_transaction_hash,
  source_sequence,transaction_max_time,submission_replacement_allowed,
  creation_tx_hash,creation_event_topic,
  creation_event_id,creation_ledger_sequence,creation_ledger_closed_at,
  last_error,chain_verified_at,published_at,created_at,updated_at
`;

function assertConfiguredDraft(draft: PublicationDraft) {
  if (draft.network !== required('STELLAR_NETWORK')) {
    throw new Error('The draft belongs to a different Stellar network.');
  }
  if (draft.ticket_contract_id !== required('TICKET_CONTRACT_ID')) {
    throw new Error('The draft belongs to a different TicketContract.');
  }
}

async function loadDraft(
  admin: AdminClient,
  userId: string,
  draftId: unknown,
): Promise<PublicationDraft> {
  const id = requireString(draftId, 'draft ID');
  const { data, error } = await admin
    .from('event_publication_drafts')
    .select(draftSelect)
    .eq('draft_id', id)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('Event draft not found.');
  return data as PublicationDraft;
}

function publicationCompleteness(draft: PublicationDraft) {
  const missing: string[] = [];
  const requiredText: Array<[keyof PublicationDraft, string]> = [
    ['intended_organizer_address', 'organizer wallet'],
    ['expected_name', 'title'],
    ['summary', 'summary'],
    ['description', 'description'],
    ['image_url', 'poster'],
    ['category', 'category'],
    ['timezone', 'timezone'],
    ['venue', 'venue'],
    ['address', 'address'],
    ['city', 'city'],
    ['organizer_display_name', 'organizer display name'],
    ['support_contact', 'support contact'],
    ['entry_instructions', 'entry instructions'],
  ];
  for (const [key, label] of requiredText) {
    const value = draft[key];
    if (typeof value !== 'string' || !value.trim()) missing.push(label);
  }
  const now = Math.floor(Date.now() / 1000);
  if (!draft.expected_date_unix || draft.expected_date_unix <= now) {
    missing.push('future start time');
  }
  if (
    !draft.end_unix ||
    !draft.expected_date_unix ||
    draft.end_unix <= draft.expected_date_unix
  ) {
    missing.push('valid end time');
  }
  if (!draft.expected_capacity || draft.expected_capacity <= 0) missing.push('capacity');
  if (!draft.expected_price_per_ticket || draft.expected_price_per_ticket <= 0) {
    missing.push('ticket price');
  }
  return { complete: missing.length === 0, missing };
}

async function updateDraftState(
  admin: AdminClient,
  draftId: string,
  states: string[],
  values: Record<string, unknown>,
) {
  const { data, error } = await admin
    .from('event_publication_drafts')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('draft_id', draftId)
    .in('state', states)
    .select(draftSelect)
    .single();
  if (error || !data) {
    throw new Error(error?.message || 'The publication state changed in another request.');
  }
  return data as PublicationDraft;
}

async function createDraft(admin: AdminClient, userId: string) {
  const { data, error } = await admin
    .from('event_publication_drafts')
    .insert({
      user_id: userId,
      event_id: `evt_${crypto.randomUUID().replaceAll('-', '')}`,
      network: required('STELLAR_NETWORK'),
      ticket_contract_id: required('TICKET_CONTRACT_ID'),
      state: 'prepared',
      revision: 1,
    })
    .select(draftSelect)
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not create the event draft.');
  return { draft: data };
}

async function listDrafts(admin: AdminClient, userId: string) {
  const { data, error } = await admin
    .from('event_publication_drafts')
    .select(draftSelect)
    .eq('user_id', userId)
    .neq('state', 'published')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return { drafts: data ?? [] };
}

async function saveDraft(
  authClient: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const expectedRevision = requirePositiveInteger(body.expectedRevision, 'expected revision');
  if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
    throw new Error('Draft patch must be an object.');
  }
  const { data, error } = await authClient.rpc('save_my_event_draft', {
    requested_draft_id: requireString(body.draftId, 'draft ID'),
    expected_revision: expectedRevision,
    draft_patch: body.patch,
  });
  if (error || !data) {
    const conflict = error?.code === '40001' || /revision conflict/i.test(error?.message ?? '');
    const failure = new Error(error?.message || 'Could not save the event draft.');
    (failure as Error & { httpStatus?: number }).httpStatus = conflict ? 409 : 400;
    throw failure;
  }
  return { draft: data };
}

async function deleteDraft(
  authClient: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
) {
  const { data, error } = await authClient.rpc('delete_my_event_draft', {
    requested_draft_id: requireString(body.draftId, 'draft ID'),
  });
  if (error) throw error;
  return { deleted: Boolean(data) };
}

async function ownedEvents(
  admin: AdminClient,
  userId: string,
  eventId?: string,
) : Promise<{ events?: Record<string, unknown>[]; event?: Record<string, unknown> }> {
  let draftQuery = admin
    .from('event_publication_drafts')
    .select('draft_id,event_id,state,updated_at,intended_organizer_address')
    .eq('user_id', userId)
    .eq('state', 'published')
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'));
  if (eventId) draftQuery = draftQuery.eq('event_id', eventId);
  const { data: drafts, error: draftError } = await draftQuery.order(
    'updated_at',
    { ascending: false },
  );
  if (draftError) throw draftError;
  if (!drafts?.length) {
    if (eventId) throw new Error('Owned published event not found.');
    return { events: [] };
  }

  const ids = drafts.map((draft) => draft.event_id);
  const { data: published, error: publishedError } = await admin
    .from('published_events')
    .select('*')
    .in('event_id', ids)
    .eq('network', required('STELLAR_NETWORK'))
    .eq('ticket_contract_id', required('TICKET_CONTRACT_ID'));
  if (publishedError) throw publishedError;
  const byId = new Map((published ?? []).map((event) => [event.event_id, event]));
  const events = drafts.flatMap((row) => {
    const record = byId.get(row.event_id);
    if (!record) return [];
    return {
      ...record,
      draft_id: row.draft_id,
      publication_state: row.state,
      publication_updated_at: row.updated_at,
      intended_organizer_address: row.intended_organizer_address,
    };
  });
  if (eventId && events.length === 0) throw new Error('Owned published event not found.');
  return eventId ? { event: events[0] } : { events };
}

async function preflightPublication(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const draft = await loadDraft(admin, userId, body.draftId);
  assertConfiguredDraft(draft);
  if (
    draft.state !== 'prepared' &&
    !(draft.state === 'publication_failed' && draft.submission_replacement_allowed)
  ) {
    throw new Error('This draft already has a publication submission in progress.');
  }
  const completeness = publicationCompleteness(draft);
  await admin
    .from('event_publication_drafts')
    .update({ completeness, updated_at: new Date().toISOString() })
    .eq('draft_id', draft.draft_id);
  if (!completeness.complete) {
    throw new Error(`Draft is incomplete: ${completeness.missing.join(', ')}.`);
  }
  return {
    draft: { ...draft, completeness },
    preflight: {
      eventId: draft.event_id,
      organizerAddress: draft.intended_organizer_address,
      network: draft.network,
      ticketContractId: draft.ticket_contract_id,
    },
  };
}

async function beginPublication(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const draft = await loadDraft(admin, userId, body.draftId);
  assertConfiguredDraft(draft);
  const completeness = publicationCompleteness(draft);
  if (!completeness.complete) {
    throw new Error(`Draft is incomplete: ${completeness.missing.join(', ')}.`);
  }
  if (
    draft.state !== 'prepared' &&
    !(draft.state === 'publication_failed' && draft.submission_replacement_allowed)
  ) {
    throw new Error('This draft cannot begin another publication attempt.');
  }
  const unsignedHash = requireHash(body.unsignedEnvelopeHash, 'unsigned envelope hash');
  const sourceSequence = requireString(body.sourceSequence, 'source sequence');
  if (!/^[0-9]+$/.test(sourceSequence)) throw new Error('Invalid source sequence.');
  const maxTime = requirePositiveInteger(body.transactionMaxTime, 'transaction maximum time');
  if (maxTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('The prepared transaction has already expired.');
  }
  const updated = await updateDraftState(
    admin,
    draft.draft_id,
    ['prepared', 'publication_failed'],
    {
      state: 'approval_required',
      unsigned_envelope_hash: unsignedHash,
      signed_transaction_hash: null,
      creation_tx_hash: null,
      source_sequence: sourceSequence,
      transaction_max_time: maxTime,
      submission_replacement_allowed: false,
      last_error: null,
      completeness,
    },
  );
  return { draft: updated };
}

async function recordSignedPublication(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const draft = await loadDraft(admin, userId, body.draftId);
  const signedHash = requireHash(body.signedTransactionHash, 'signed transaction hash');
  if (draft.state !== 'approval_required') {
    if (
      ['signed_submission_pending', 'confirmation_pending', 'status_unknown'].includes(draft.state) &&
      draft.signed_transaction_hash === signedHash
    ) {
      return { draft };
    }
    throw new Error('This draft cannot accept a signed publication transaction.');
  }
  if (draft.unsigned_envelope_hash !== signedHash) {
    throw new Error('The signed transaction does not match the prepared publication.');
  }
  const updated = await updateDraftState(admin, draft.draft_id, ['approval_required'], {
    state: 'signed_submission_pending',
    signed_transaction_hash: signedHash,
    creation_tx_hash: signedHash,
    submission_replacement_allowed: false,
    last_error: null,
  });
  return { draft: updated };
}

async function preSubmissionFailed(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const draft = await loadDraft(admin, userId, body.draftId);
  if (
    draft.signed_transaction_hash ||
    !['prepared', 'approval_required', 'publication_failed'].includes(draft.state)
  ) {
    throw new Error('A possibly submitted publication cannot be marked as pre-submission failure.');
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
  const updated = await updateDraftState(
    admin,
    draft.draft_id,
    ['prepared', 'approval_required', 'publication_failed'],
    {
      state: 'publication_failed',
      unsigned_envelope_hash: null,
      source_sequence: null,
      transaction_max_time: null,
      submission_replacement_allowed: true,
      last_error: typeof body.detail === 'string'
        ? body.detail.slice(0, 1000)
        : category,
    },
  );
  return { draft: updated };
}

async function synchronizePublication(
  admin: AdminClient,
  draft: PublicationDraft,
  proof: {
    topic: 'ev_create';
    eventId: string;
    transactionHash: string;
    ledgerSequence: number;
    ledgerClosedAt: string;
  },
) {
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const event = await readAuthoritativeEvent(server, draft.ticket_contract_id, draft.event_id);
  const { data, error } = await admin.rpc('publish_verified_event', {
    draft_owner_id: draft.user_id,
    requested_draft_id: draft.draft_id,
    reserved_event_id: draft.event_id,
    verified_organizer_address: event.organizer,
    verified_name: event.name,
    verified_date_unix: asSafeNumber(event.date_unix, 'start time'),
    verified_end_unix: asSafeNumber(event.end_unix, 'end time'),
    verified_capacity: asSafeNumber(event.capacity, 'capacity'),
    verified_price_per_ticket: asSafeNumber(event.price_per_ticket, 'price'),
    verified_current_supply: asSafeNumber(event.current_supply, 'supply'),
    verified_status: eventStatus(event.status),
    verified_transaction_hash: proof.transactionHash,
    verified_event_topic: proof.topic,
    verified_event_id: proof.eventId,
    verified_ledger_sequence: proof.ledgerSequence,
    verified_ledger_closed_at: proof.ledgerClosedAt,
    verified_at: new Date().toISOString(),
  });
  if (error || !data) {
    await admin.from('event_publication_drafts').update({
      state: 'sync_warning',
      last_error: error?.message?.slice(0, 1000) ?? 'Public event synchronization failed.',
      updated_at: new Date().toISOString(),
    }).eq('draft_id', draft.draft_id).in('state', ['chain_confirmed', 'sync_warning']);
    throw new Error(error?.message || 'Public event synchronization failed.');
  }
  return { draft: data, eventId: draft.event_id, transactionHash: proof.transactionHash };
}

async function resolvePublication(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  let draft = await loadDraft(admin, userId, body.draftId);
  assertConfiguredDraft(draft);
  if (draft.state === 'published') return { draft };
  if (['chain_confirmed', 'sync_warning', 'chain_created'].includes(draft.state)) {
    if (!draft.signed_transaction_hash) {
      throw new Error('Confirmed publication transaction identity is missing.');
    }
  } else if (![
    'signed_submission_pending',
    'confirmation_pending',
    'status_unknown',
  ].includes(draft.state)) {
    throw new Error('This draft has no signed publication to resolve.');
  }

  const hash = requireHash(
    draft.signed_transaction_hash,
    'recorded signed transaction hash',
  );
  const organizer = requireString(draft.intended_organizer_address, 'intended organizer');
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const resolution = await resolveExactContractEvent(
    server,
    required('STELLAR_NETWORK_PASSPHRASE'),
    draft.ticket_contract_id,
    hash,
    organizer,
    'ev_create',
    draft.event_id,
  );
  if (resolution.status === 'failed') {
    draft = await updateDraftState(
      admin,
      draft.draft_id,
      ['signed_submission_pending', 'confirmation_pending', 'status_unknown'],
      {
        state: 'publication_failed',
        last_error: 'Stellar rejected the publication transaction.',
        submission_replacement_allowed: true,
      },
    );
    return { draft };
  }
  if (resolution.status === 'not_found') {
    const expired = await isProvablyExpiredWithoutSubmission(
      server,
      organizer,
      draft.source_sequence,
      draft.transaction_max_time,
    );
    draft = await updateDraftState(
      admin,
      draft.draft_id,
      ['signed_submission_pending', 'confirmation_pending', 'status_unknown'],
      expired
        ? {
          state: 'publication_failed',
          last_error: 'The signed transaction expired before submission.',
          submission_replacement_allowed: true,
        }
        : {
          state: 'status_unknown',
          last_error: 'The signed transaction is not yet visible on Stellar.',
          submission_replacement_allowed: false,
        },
    );
    return { draft };
  }
  if (resolution.status === 'success_without_event') {
    draft = await updateDraftState(
      admin,
      draft.draft_id,
      ['signed_submission_pending', 'confirmation_pending', 'status_unknown'],
      {
        state: 'status_unknown',
        last_error: 'The transaction succeeded, but matching ev_create proof is unavailable.',
        submission_replacement_allowed: false,
      },
    );
    return { draft };
  }

  const event = await readAuthoritativeEvent(server, draft.ticket_contract_id, draft.event_id);
  if (
    event.organizer !== organizer ||
    event.name !== draft.expected_name ||
    asSafeNumber(event.date_unix, 'start time') !== draft.expected_date_unix ||
    asSafeNumber(event.end_unix, 'end time') !== draft.end_unix ||
    asSafeNumber(event.capacity, 'capacity') !== draft.expected_capacity ||
    asSafeNumber(event.price_per_ticket, 'price') !== draft.expected_price_per_ticket ||
    eventStatus(event.status) !== 'Active'
  ) {
    throw new Error('Current contract state does not match the publication draft.');
  }
  draft = await updateDraftState(
    admin,
    draft.draft_id,
    ['signed_submission_pending', 'confirmation_pending', 'status_unknown', 'chain_created'],
    {
      state: 'chain_confirmed',
      creation_event_topic: resolution.proof.topic,
      creation_event_id: resolution.proof.eventId,
      creation_ledger_sequence: resolution.proof.ledgerSequence,
      creation_ledger_closed_at: resolution.proof.ledgerClosedAt,
      chain_verified_at: resolution.proof.ledgerClosedAt,
      submission_replacement_allowed: false,
      last_error: null,
    },
  );
  return synchronizePublication(admin, draft, resolution.proof);
}

async function retryPublicationSync(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const draft = await loadDraft(admin, userId, body.draftId);
  if (!['chain_confirmed', 'sync_warning', 'chain_created'].includes(draft.state)) {
    throw new Error('Only a chain-confirmed publication can retry public synchronization.');
  }
  const hash = requireHash(draft.signed_transaction_hash, 'signed transaction hash');
  const resolution = await resolveExactContractEvent(
    new rpc.Server(required('STELLAR_RPC_URL')),
    required('STELLAR_NETWORK_PASSPHRASE'),
    draft.ticket_contract_id,
    hash,
    requireString(draft.intended_organizer_address, 'intended organizer'),
    'ev_create',
    draft.event_id,
  );
  if (resolution.status !== 'verified') {
    throw new Error('Matching ev_create proof is currently unavailable.');
  }
  return synchronizePublication(admin, draft, resolution.proof);
}

async function updateMetadata(
  admin: AdminClient,
  userId: string,
  body: Record<string, unknown>,
) {
  const eventId = requireString(body.eventId, 'event ID');
  const expectedRevision = requirePositiveInteger(
    body.expectedMetadataRevision,
    'expected metadata revision',
  );
  if (!body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
    throw new Error('Metadata patch must be an object.');
  }
  const owned = await ownedEvents(admin, userId, eventId);
  const event = owned.event as Record<string, unknown>;
  const server = new rpc.Server(required('STELLAR_RPC_URL'));
  const authoritative = await readAuthoritativeEvent(
    server,
    requireString(event.ticket_contract_id, 'TicketContract ID'),
    eventId,
  );
  const { data, error } = await admin.rpc('save_verified_event_metadata', {
    event_owner_id: userId,
    requested_event_id: eventId,
    expected_metadata_revision: expectedRevision,
    verified_current_supply: asSafeNumber(authoritative.current_supply, 'supply'),
    metadata_patch: body.patch,
  });
  if (error || !data) {
    const failure = new Error(error?.message || 'Could not update event metadata.');
    (failure as Error & { httpStatus?: number }).httpStatus =
      error?.code === '40001' || /revision conflict/i.test(error?.message ?? '') ? 409 : 400;
    throw failure;
  }
  return { event: data };
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
      case 'create-draft':
        return json(await createDraft(admin, user.id));
      case 'list-drafts':
        return json(await listDrafts(admin, user.id));
      case 'get-draft':
        return json({ draft: await loadDraft(admin, user.id, body.draftId) });
      case 'save-draft':
        return json(await saveDraft(authClient, body));
      case 'delete-draft':
        return json(await deleteDraft(authClient, body));
      case 'list-owned-events':
        return json(await ownedEvents(admin, user.id));
      case 'get-owned-event':
        return json(await ownedEvents(admin, user.id, requireString(body.eventId, 'event ID')));
      case 'preflight-publication':
        return json(await preflightPublication(admin, user.id, body));
      case 'begin-publication':
        return json(await beginPublication(admin, user.id, body));
      case 'record-signed-publication':
        return json(await recordSignedPublication(admin, user.id, body));
      case 'pre-submission-failed':
        return json(await preSubmissionFailed(admin, user.id, body));
      case 'resolve-publication':
        return json(await resolvePublication(admin, user.id, body));
      case 'retry-publication-sync':
        return json(await retryPublicationSync(admin, user.id, body));
      case 'update-metadata':
        return json(await updateMetadata(admin, user.id, body));
      default:
        return json({ error: 'Unknown event-publication action.' }, 400);
    }
  } catch (error) {
    console.error('[event-publication]', error instanceof Error ? error.message : error);
    const status = error instanceof Error && 'httpStatus' in error
      ? Number((error as Error & { httpStatus: number }).httpStatus)
      : 400;
    return json({
      error: error instanceof Error ? error.message : 'Event publication failed.',
    }, status);
  }
});
