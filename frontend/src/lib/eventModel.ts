import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type {
  AuthoritativeEventSnapshot,
  Event,
  EventSalesState,
  RefundPolicyCode,
  ResalePolicyCode,
} from '../types';
import type { EventMetadata } from './supabase';

export const REFUND_POLICY: Record<RefundPolicyCode, string> = {
  cancelled_event_original_price:
    'If the organizer cancels the event, the current ticket owner can claim the original primary ticket price.',
};

export const RESALE_POLICY: Record<ResalePolicyCode, string> = {
  stellar_marketplace_unlocked:
    'Eligible tickets may be listed through the StellarTickets marketplace. Listings do not reserve or lock a ticket.',
};

export function normalizeEvent(row: EventMetadata): Event {
  return {
    eventId: row.event_id,
    organizer: row.organizer_address,
    organizerDisplayName: row.organizer_display_name,
    name: row.name,
    summary: row.summary,
    description: row.description,
    imageUrl: row.image_url,
    category: row.category,
    dateUnix: row.date_unix,
    endUnix: row.end_unix,
    timezone: row.timezone,
    venue: row.venue,
    address: row.address,
    city: row.city,
    supportContact: row.support_contact,
    refundPolicyCode: row.refund_policy_code,
    resalePolicyCode: row.resale_policy_code,
    entryInstructions: row.entry_instructions,
    capacity: row.capacity,
    pricePerTicket: row.price_per_ticket,
    currentSupply: row.current_supply,
    status: row.status,
    network: row.network,
    ticketContractId: row.ticket_contract_id,
    creationTxHash: row.creation_tx_hash,
    chainVerifiedAt: row.chain_verified_at,
    authority: 'preview',
  };
}

export function mergeAuthoritativeEvent(
  event: Event,
  snapshot: AuthoritativeEventSnapshot,
): Event {
  return {
    ...event,
    organizer: snapshot.organizer,
    name: snapshot.name,
    dateUnix: snapshot.dateUnix,
    capacity: snapshot.capacity,
    pricePerTicket: snapshot.pricePerTicket,
    currentSupply: snapshot.currentSupply,
    status: snapshot.status,
    authority: 'confirmed',
    authorityError: undefined,
  };
}

export function unavailableEvent(event: Event, message: string): Event {
  return { ...event, authority: 'unavailable', authorityError: message };
}

export function authoritativeIdentityMismatch(
  event: Event,
  snapshot: AuthoritativeEventSnapshot,
): string | null {
  if (event.ticketContractId !== import.meta.env.VITE_TICKET_CONTRACT_ID) {
    return 'This event belongs to a different TicketContract deployment.';
  }
  if (event.network !== 'StellarTestnet') {
    return 'This event belongs to a different Stellar network.';
  }
  if (event.organizer !== snapshot.organizer) return 'Organizer does not match the chain record.';
  if (event.name !== snapshot.name) return 'Event name does not match the chain record.';
  if (event.dateUnix !== snapshot.dateUnix) return 'Event start does not match the chain record.';
  if (event.capacity !== snapshot.capacity) return 'Capacity does not match the chain record.';
  if (event.pricePerTicket !== snapshot.pricePerTicket) {
    return 'Ticket price does not match the chain record.';
  }
  return null;
}

export function deriveEventSalesState(
  event: Event,
  nowUnix = Math.floor(Date.now() / 1000),
  requireAuthority = false,
): EventSalesState {
  if (event.authority === 'unavailable' || (requireAuthority && event.authority !== 'confirmed')) {
    return 'unavailable';
  }
  if (event.status === 'Cancelled') return 'cancelled';
  if (event.status === 'Completed') return 'completed';
  if (nowUnix >= event.dateUnix) return 'sales_closed';
  if (event.currentSupply >= event.capacity) return 'sold_out';
  return 'on_sale';
}

export const EVENT_SALES_LABELS: Record<EventSalesState, string> = {
  on_sale: 'On sale',
  sold_out: 'Sold out',
  sales_closed: 'Sales closed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  unavailable: 'Unavailable',
};

export function remainingTickets(event: Event): number {
  return Math.max(0, event.capacity - event.currentSupply);
}

export function authoritativeFingerprint(event: Event): string {
  return [
    event.organizer,
    event.dateUnix,
    event.capacity,
    event.currentSupply,
    event.pricePerTicket,
    event.status,
  ].join(':');
}

export function formatEventStart(event: Event): string {
  return formatInTimeZone(
    new Date(event.dateUnix * 1000),
    event.timezone,
    "EEEE, MMMM d, yyyy 'at' h:mm a zzz",
  );
}

export function formatEventRange(event: Event): string {
  const start = formatInTimeZone(
    new Date(event.dateUnix * 1000),
    event.timezone,
    "EEE, MMM d · h:mm a",
  );
  const end = formatInTimeZone(
    new Date(event.endUnix * 1000),
    event.timezone,
    "EEE, MMM d · h:mm a zzz",
  );
  return `${start} – ${end}`;
}

export function zonedDateTimeToUnix(
  date: string,
  time: string,
  timeZone: string,
): number {
  if (!date || !time || !timeZone) throw new Error('Date, time, and timezone are required.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new Error('Choose a valid IANA timezone.');
  }
  const instant = fromZonedTime(`${date}T${time}:00`, timeZone);
  if (Number.isNaN(instant.getTime())) throw new Error('The selected local time is invalid.');

  // Reject DST-normalized wall times rather than silently shifting the event.
  const roundTrip = formatInTimeZone(instant, timeZone, 'yyyy-MM-dd HH:mm');
  if (roundTrip !== `${date} ${time}`) {
    throw new Error('The selected local time does not exist in this timezone.');
  }
  return Math.floor(instant.getTime() / 1000);
}
