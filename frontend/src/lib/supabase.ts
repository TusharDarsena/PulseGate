import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
} from './constants';
import type {
  EventStatus,
  RefundPolicyCode,
  ResalePolicyCode,
} from '../types';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
});

// Types matching our Supabase schema
export interface EventMetadata {
  event_id: string;
  organizer_address: string;
  name: string;
  summary: string;
  description: string;
  image_url: string;
  category: string;
  date_unix: number;
  end_unix: number;
  timezone: string;
  venue: string;
  address: string;
  city: string;
  organizer_display_name: string;
  support_contact: string;
  refund_policy_code: RefundPolicyCode;
  resale_policy_code: ResalePolicyCode;
  entry_instructions: string;
  accessibility_notes?: string;
  age_restriction?: string;
  prohibited_items?: string;
  map_url?: string;
  public_links?: string[];
  metadata_revision?: number;
  metadata_updated_at?: string | null;
  metadata_updated_by?: string | null;
  status: EventStatus;
  current_supply: number;
  capacity: number;
  price_per_ticket: number;
  network: 'StellarTestnet';
  ticket_contract_id: string;
  creation_tx_hash: string;
  chain_verified_at: string;
  created_at: string;
  updated_at: string;
}

export type EventPublicationState =
  | 'prepared'
  | 'approval_required'
  | 'signed_submission_pending'
  | 'confirmation_pending'
  | 'status_unknown'
  | 'chain_confirmed'
  | 'sync_warning'
  | 'creation_submitting'
  | 'chain_created'
  | 'publication_failed'
  | 'published';

export interface EventPublicationDraft {
  draft_id: string;
  user_id: string;
  event_id: string;
  intended_organizer_address: string | null;
  expected_name: string | null;
  expected_date_unix: number | null;
  expected_capacity: number | null;
  expected_price_per_ticket: number | null;
  network: 'StellarTestnet';
  ticket_contract_id: string;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  category: string | null;
  timezone: string | null;
  end_unix: number | null;
  venue: string | null;
  address: string | null;
  city: string | null;
  organizer_display_name: string | null;
  support_contact: string | null;
  refund_policy_code: RefundPolicyCode;
  resale_policy_code: ResalePolicyCode;
  entry_instructions: string | null;
  accessibility_notes: string | null;
  age_restriction: string | null;
  prohibited_items: string | null;
  map_url: string | null;
  public_links: string[];
  revision: number;
  state: EventPublicationState;
  creation_tx_hash: string | null;
  chain_verified_at?: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveryFilters {
  search?: string;
  category?: string;
  city?: string;
  startUnix?: number;
  endUnix?: number;
}

export interface TicketRow {
  ticket_id: string;
  event_id: string;
  owner_address: string;
  status: string; // 'Active' | 'Used' | 'Refunded'
  purchased_at: string;
  event_name?: string;
  event_summary?: string;
  event_description?: string;
  event_image_url?: string;
  event_category?: string;
  event_date_unix?: number;
  event_end_unix?: number;
  event_timezone?: string;
  event_venue?: string;
  event_address?: string;
  event_city?: string;
  event_status?: string;
  event_capacity?: number;
  event_price_per_ticket?: number;
  receipt_operation_id?: string | null;
}

export interface ListingRow {
  listing_id: string;
  seller_address: string;
  ticket_id: string;
  event_id: string;
  ask_price_stroops: string; // Using string or numeric string due to bigint in Postgres
  status: string; // 'Open' | 'Sold' | 'Cancelled'
  listed_at: string;
}

export interface UserProfileRow {
  wallet_address: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  created_at: string;
}

/**
 * Public discovery is intentionally narrower than direct event access.
 * It returns only trusted, published, upcoming Active events.
 */
export async function fetchDiscoverableEvents(
  filters: DiscoveryFilters = {},
): Promise<EventMetadata[]> {
  let query = supabase
    .from('discoverable_events')
    .select('*')
    .order('date_unix', { ascending: true });

  if (filters.category && filters.category !== 'All') {
    query = query.eq('category', filters.category);
  }
  if (filters.city && filters.city !== 'All') {
    const city = filters.city.trim().replaceAll('%', '').replaceAll('_', '');
    if (city) query = query.ilike('city', `%${city}%`);
  }
  if (filters.startUnix) query = query.gte('date_unix', filters.startUnix);
  if (filters.endUnix) query = query.lte('date_unix', filters.endUnix);
  if (filters.search?.trim()) {
    const escaped = filters.search.trim().replaceAll(',', ' ');
    query = query.or(
      `name.ilike.%${escaped}%,venue.ilike.%${escaped}%,city.ilike.%${escaped}%`,
    );
  }

  const { data, error } = await query;

  if (error) {
    console.error('[supabase] fetchDiscoverableEvents failed:', error.message);
    throw new Error('Service Unavailable / Database unreachable');
  }

  return (data ?? []) as EventMetadata[];
}

/**
 * Direct public access resolves every trusted published event, regardless of
 * lifecycle or whether it still belongs in discovery.
 */
export async function fetchPublishedEventById(eventId: string): Promise<EventMetadata | null> {
  const { data, error } = await supabase
    .from('published_events')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as EventMetadata | null;
}

export async function fetchPublishedEventsByIds(eventIds: string[]): Promise<EventMetadata[]> {
  const unique = [...new Set(eventIds.filter(Boolean))];
  if (unique.length === 0) return [];
  const { data, error } = await supabase
    .from('published_events')
    .select('*')
    .in('event_id', unique);
  if (error) throw new Error(error.message);
  return (data ?? []) as EventMetadata[];
}

/**
 * Fetch tickets for the attendee wallet derived server-side from auth.uid().
 */
export async function fetchMyTickets(): Promise<TicketRow[]> {
  const { data, error } = await supabase.rpc('get_my_tickets');

  if (error) {
    console.error('[supabase] fetchMyTickets failed:', error.message);
    throw new Error('Service Unavailable / Database unreachable');
  }

  return (data ?? []) as TicketRow[];
}

export interface EventDraftPatch {
  /** Present only for the one-time initial organizer wallet binding. */
  intended_organizer_address?: string;
  expected_name: string | null;
  expected_date_unix: number | null;
  expected_capacity: number | null;
  expected_price_per_ticket: number | null;
  summary: string | null;
  description: string | null;
  image_url: string | null;
  category: string | null;
  timezone: string | null;
  end_unix: number | null;
  venue: string | null;
  address: string | null;
  city: string | null;
  organizer_display_name: string | null;
  support_contact: string | null;
  entry_instructions: string | null;
  accessibility_notes: string | null;
  age_restriction: string | null;
  prohibited_items: string | null;
  map_url: string | null;
  public_links: string[];
}

export type EventDraftSavePatch =
  | EventDraftPatch
  | Required<Pick<EventDraftPatch, 'intended_organizer_address'>>;

export class DraftConflictError extends Error {
  constructor() {
    super('This draft changed in another tab or device. Your unsaved edits were preserved.');
    this.name = 'DraftConflictError';
  }
}

async function callEventPublication<T>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/event-publication`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...input }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (
      response.status === 409 ||
      /revision|conflict|stale/i.test(String(payload.error ?? ''))
    ) {
      throw new DraftConflictError();
    }
    throw new Error(payload.error || 'Event publication service unavailable.');
  }
  return payload as T;
}

export async function createEventDraft(): Promise<EventPublicationDraft> {
  const payload = await callEventPublication<{ draft: EventPublicationDraft }>('create-draft');
  return payload.draft;
}

export async function listMyEventDrafts(): Promise<EventPublicationDraft[]> {
  const payload = await callEventPublication<{ drafts: EventPublicationDraft[] }>('list-drafts');
  return payload.drafts;
}

export async function getMyEventDraft(draftId: string): Promise<EventPublicationDraft | null> {
  try {
    const payload = await callEventPublication<{ draft: EventPublicationDraft }>(
      'get-draft',
      { draftId },
    );
    return payload.draft;
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export async function saveEventDraft(
  draftId: string,
  expectedRevision: number,
  patch: EventDraftSavePatch,
): Promise<EventPublicationDraft> {
  const payload = await callEventPublication<{ draft: EventPublicationDraft }>('save-draft', {
    draftId,
    expectedRevision,
    patch,
  });
  return payload.draft;
}

export async function deleteEventDraft(draftId: string): Promise<void> {
  await callEventPublication('delete-draft', { draftId });
}

export interface PublicationPreflight {
  eventId: string;
  organizerAddress: string;
  network: 'StellarTestnet';
  ticketContractId: string;
}

export async function preflightEventPublication(draftId: string): Promise<{
  draft: EventPublicationDraft;
  preflight: PublicationPreflight;
}> {
  return callEventPublication('preflight-publication', { draftId });
}

export async function beginEventPublication(
  draftId: string,
  prepared: {
    unsignedEnvelopeHash: string;
    sourceSequence: string;
    transactionMaxTime: number;
  },
): Promise<EventPublicationDraft> {
  const payload = await callEventPublication<{ draft: EventPublicationDraft }>(
    'begin-publication',
    { draftId, ...prepared },
  );
  return payload.draft;
}

export async function recordSignedEventPublication(
  draftId: string,
  signedTransactionHash: string,
): Promise<EventPublicationDraft> {
  const payload = await callEventPublication<{ draft: EventPublicationDraft }>(
    'record-signed-publication',
    { draftId, signedTransactionHash },
  );
  return payload.draft;
}

export async function recordPublicationPreSubmissionFailure(
  draftId: string,
  category:
    | 'approval_rejected'
    | 'approval_expired'
    | 'preparation_failed'
    | 'signing_provider_failed',
  detail?: string,
): Promise<EventPublicationDraft> {
  const payload = await callEventPublication<{ draft: EventPublicationDraft }>(
    'pre-submission-failed',
    { draftId, category, detail },
  );
  return payload.draft;
}

export async function resolveEventPublication(draftId: string): Promise<EventPublicationDraft> {
  const payload = await callEventPublication<{ draft: EventPublicationDraft }>(
    'resolve-publication',
    { draftId },
  );
  return payload.draft;
}

export async function retryEventPublicationSync(draftId: string): Promise<EventPublicationDraft> {
  const payload = await callEventPublication<{ draft: EventPublicationDraft }>(
    'retry-publication-sync',
    { draftId },
  );
  return payload.draft;
}

export interface OwnedOrganizerEvent extends EventMetadata {
  draft_id: string;
  publication_state: EventPublicationState;
  publication_updated_at: string;
}

export async function getMyOrganizerEvents(): Promise<OwnedOrganizerEvent[]> {
  const payload = await callEventPublication<{ events: OwnedOrganizerEvent[] }>(
    'list-owned-events',
  );
  return payload.events;
}

export async function getMyOrganizerEvent(eventId: string): Promise<OwnedOrganizerEvent | null> {
  try {
    const payload = await callEventPublication<{ event: OwnedOrganizerEvent }>(
      'get-owned-event',
      { eventId },
    );
    return payload.event;
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) return null;
    throw error;
  }
}

export interface EventMetadataPatch {
  summary?: string;
  description?: string;
  image_url?: string;
  organizer_display_name?: string;
  support_contact?: string;
  entry_instructions?: string;
  accessibility_notes?: string;
  age_restriction?: string;
  prohibited_items?: string;
  map_url?: string;
  public_links?: string[];
  venue?: string;
  address?: string;
  city?: string;
}

export async function updateOrganizerEventMetadata(
  eventId: string,
  expectedMetadataRevision: number,
  patch: EventMetadataPatch,
): Promise<OwnedOrganizerEvent> {
  const payload = await callEventPublication<{ event: OwnedOrganizerEvent }>('update-metadata', {
    eventId,
    expectedMetadataRevision,
    patch,
  });
  return payload.event;
}

export type OrganizerEventOperationType = 'cancel_event' | 'complete_event';
export type OrganizerEventOperationState =
  | 'review'
  | 'approval_required'
  | 'signed_submission_pending'
  | 'confirmation_pending'
  | 'status_unknown'
  | 'pre_submission_failed'
  | 'chain_failed'
  | 'chain_confirmed'
  | 'mirror_syncing'
  | 'sync_warning'
  | 'complete';

export interface OrganizerEventOperation {
  operation_id: string;
  event_id: string;
  operation_type: OrganizerEventOperationType;
  expected_organizer_address: string;
  cancellation_reason: string | null;
  state: OrganizerEventOperationState;
  transaction_hash: string | null;
  released_amount: string | null;
  chain_confirmed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function invokeOrganizerEventOperation(
  action:
    | 'allocate'
    | 'get'
    | 'list'
    | 'begin-attempt'
    | 'record-signed-attempt'
    | 'pre-submission-failed'
    | 'resolve'
    | 'retry-sync',
  input: Record<string, unknown>,
): Promise<{
  operation?: OrganizerEventOperation;
  operations?: OrganizerEventOperation[];
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/organizer-event-operation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...input }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Organizer operation service unavailable.');
  return payload;
}

export type CheckInOperationState =
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

export interface CheckInOperation {
  operation_id: string;
  event_id: string;
  ticket_id: string;
  expected_owner_address: string;
  expected_organizer_address: string;
  state: CheckInOperationState;
  transaction_hash: string | null;
  chain_confirmed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckInStats {
  sold: number;
  checkedIn: number;
  remaining: number;
  unresolved: number;
}

export async function invokeCheckInOperation(
  action:
    | 'allocate'
    | 'get'
    | 'list'
    | 'stats'
    | 'begin-attempt'
    | 'record-signed-attempt'
    | 'pre-submission-failed'
    | 'resolve'
    | 'retry-sync',
  input: Record<string, unknown>,
): Promise<{
  operation?: CheckInOperation;
  operations?: CheckInOperation[];
  stats?: CheckInStats;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/check-in-operation`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...input }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Check-in service unavailable.');
  return payload;
}

export async function fetchMyTicket(ticketId: string): Promise<TicketRow | null> {
  const { data, error } = await supabase.rpc('get_my_ticket', { requested_ticket_id: ticketId });
  if (error) throw new Error(error.message);
  return ((data ?? []) as TicketRow[])[0] ?? null;
}

/**
 * Fetch all open listings for a ticket collection in one request. Resale UI must
 * not infer a ticket's listing state until this trusted read-model result arrives.
 */
export async function fetchOpenListingsByTicketIds(ticketIds: string[]): Promise<ListingRow[]> {
  const uniqueTicketIds = [...new Set(ticketIds.filter(Boolean))];
  if (uniqueTicketIds.length === 0) return [];

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .in('ticket_id', uniqueTicketIds)
    .eq('status', 'Open')
    .order('listed_at', { ascending: false });

  if (error) {
    console.warn('[supabase] fetchOpenListingsByTicketIds failed:', error.message);
    throw new Error('Unable to load resale status.');
  }

  return (data ?? []) as ListingRow[];
}

export async function fetchUserProfile(walletAddress: string): Promise<UserProfileRow | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error) {
    console.warn('[supabase] fetchUserProfile failed:', error.message);
    return null;
  }

  return data;
}
