import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TICKET_CONTRACT_ID,
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
  | 'creation_submitting'
  | 'chain_created'
  | 'publication_failed'
  | 'published';

export interface EventPublicationDraft {
  draft_id: string;
  user_id: string;
  event_id: string;
  intended_organizer_address: string;
  expected_name: string;
  expected_date_unix: number;
  expected_capacity: number;
  expected_price_per_ticket: number;
  network: 'StellarTestnet';
  ticket_contract_id: string;
  summary: string;
  description: string;
  image_url: string;
  category: string;
  timezone: string;
  end_unix: number;
  venue: string;
  address: string;
  city: string;
  organizer_display_name: string;
  support_contact: string;
  refund_policy_code: RefundPolicyCode;
  resale_policy_code: ResalePolicyCode;
  entry_instructions: string;
  state: EventPublicationState;
  creation_tx_hash: string | null;
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

export async function fetchPublishedEventsByOrganizer(
  organizerAddress: string,
): Promise<EventMetadata[]> {
  if (!organizerAddress) return [];
  const { data, error } = await supabase
    .from('published_events')
    .select('*')
    .eq('organizer_address', organizerAddress)
    .order('date_unix', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as EventMetadata[];
}

export interface CreateEventPublicationDraftInput {
  userId: string;
  eventId: string;
  organizerAddress: string;
  name: string;
  dateUnix: number;
  endUnix: number;
  timezone: string;
  capacity: number;
  pricePerTicket: number;
  summary: string;
  description: string;
  imageUrl: string;
  category: string;
  venue: string;
  address: string;
  city: string;
  organizerDisplayName: string;
  supportContact: string;
  entryInstructions: string;
}

export async function createEventPublicationDraft(
  input: CreateEventPublicationDraftInput,
): Promise<EventPublicationDraft> {
  const { data, error } = await supabase
    .from('event_publication_drafts')
    .insert({
      user_id: input.userId,
      event_id: input.eventId,
      intended_organizer_address: input.organizerAddress,
      expected_name: input.name,
      expected_date_unix: input.dateUnix,
      expected_capacity: input.capacity,
      expected_price_per_ticket: input.pricePerTicket,
      network: 'StellarTestnet',
      ticket_contract_id: TICKET_CONTRACT_ID,
      summary: input.summary,
      description: input.description,
      image_url: input.imageUrl,
      category: input.category,
      timezone: input.timezone,
      end_unix: input.endUnix,
      venue: input.venue,
      address: input.address,
      city: input.city,
      organizer_display_name: input.organizerDisplayName,
      support_contact: input.supportContact,
      refund_policy_code: 'cancelled_event_original_price',
      resale_policy_code: 'stellar_marketplace_unlocked',
      entry_instructions: input.entryInstructions,
      state: 'prepared',
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not reserve the event draft.');
  return data as EventPublicationDraft;
}

export async function updatePreparedEventPublicationDraft(
  draftId: string,
  input: Omit<CreateEventPublicationDraftInput, 'userId' | 'eventId' | 'organizerAddress'>,
): Promise<EventPublicationDraft> {
  const { data, error } = await supabase
    .from('event_publication_drafts')
    .update({
      expected_name: input.name,
      expected_date_unix: input.dateUnix,
      expected_capacity: input.capacity,
      expected_price_per_ticket: input.pricePerTicket,
      summary: input.summary,
      description: input.description,
      image_url: input.imageUrl,
      category: input.category,
      timezone: input.timezone,
      end_unix: input.endUnix,
      venue: input.venue,
      address: input.address,
      city: input.city,
      organizer_display_name: input.organizerDisplayName,
      support_contact: input.supportContact,
      entry_instructions: input.entryInstructions,
      updated_at: new Date().toISOString(),
    })
    .eq('draft_id', draftId)
    .eq('state', 'prepared')
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not update the reserved draft.');
  return data as EventPublicationDraft;
}

export async function fetchOpenEventPublicationDraft(): Promise<EventPublicationDraft | null> {
  const { data, error } = await supabase
    .from('event_publication_drafts')
    .select('*')
    .neq('state', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as EventPublicationDraft | null;
}

export async function invokeEventPublication(
  action: 'begin-creation' | 'publish' | 'retry-publication' | 'recover-submission',
  draftId: string,
  transactionHash?: string,
): Promise<{ state: EventPublicationState; eventId?: string; transactionHash?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/event-publication`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, draftId, transactionHash }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Event publication service unavailable.');
  return payload;
}

export async function refreshPublishedEventFromChain(
  eventId: string,
  transactionHash: string,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');
  const response = await fetch(`${SUPABASE_URL}/functions/v1/event-publication`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'refresh-event', eventId, transactionHash }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Event state refresh failed.');
}

/**
 * Fetch tickets for a specific wallet directly from Supabase.
 */
export async function fetchTicketsByOwner(walletAddress: string): Promise<TicketRow[]> {
  if (!walletAddress) return [];
  
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('owner_address', walletAddress)
    .order('purchased_at', { ascending: false });

  if (error) {
    console.error('[supabase] fetchTicketsByOwner failed:', error.message);
    throw new Error('Service Unavailable / Database unreachable');
  }

  return data ?? [];
}

/**
 * Fetch open listing for a specific ticket to determine "Cancel Listing" UI state.
 */
export async function fetchOpenListingByTicket(ticketId: string): Promise<ListingRow | null> {
  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('ticket_id', ticketId)
    .eq('status', 'Open')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[supabase] fetchOpenListingByTicket failed:', error.message);
    return null;
  }

  return data;
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
