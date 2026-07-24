import { refreshPublishedEventFromChain, supabase } from './supabase';

export interface ReadModelSyncResult {
  ok: boolean;
  error?: ReadModelSyncError;
}

export class ReadModelSyncError extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to ${operation}: ${detail}`, { cause });
    this.name = 'ReadModelSyncError';
    this.operation = operation;
  }
}

type SupabaseResult = {
  error: { message: string } | null;
  data?: unknown;
};

async function requireWrite(request: PromiseLike<unknown>, requireMatchingRow = false): Promise<void> {
  const { data, error } = await request as SupabaseResult;
  if (error) throw new Error(error.message);
  if (requireMatchingRow && (!Array.isArray(data) || data.length === 0)) {
    throw new Error('the matching read-model row was not found');
  }
}

async function synchronize(operation: string, write: () => Promise<void>): Promise<ReadModelSyncResult> {
  try {
    await write();
    return { ok: true };
  } catch (cause) {
    const error = new ReadModelSyncError(operation, cause);
    console.error('[read-model-sync]', error);
    return { ok: false, error };
  }
}

export function synchronizationWarning(result: ReadModelSyncResult): string {
  const detail = result.error?.message ?? 'The read-model update failed.';
  return `The blockchain transaction succeeded, but the app data did not synchronize. Do not retry the blockchain action. Refresh later or contact support. ${detail}`;
}

export function mirrorPurchasedTicket(input: {
  ticketId: string;
  eventId: string;
  ownerAddress: string;
}): Promise<ReadModelSyncResult> {
  return synchronize('mirror the ticket purchase', async () => {
    await requireWrite(supabase.from('tickets').insert({
      ticket_id: input.ticketId,
      event_id: input.eventId,
      owner_address: input.ownerAddress,
      status: 'Active',
    }));
  });
}

export function refreshPurchasedEvent(
  eventId: string,
  transactionHash: string,
): Promise<ReadModelSyncResult> {
  return mirrorEventState(eventId, transactionHash, 'refresh the event sale preview');
}

function mirrorEventState(
  eventId: string,
  transactionHash: string,
  operation: string,
) {
  return synchronize(operation, async () => {
    await refreshPublishedEventFromChain(eventId, transactionHash);
  });
}

export function mirrorCancelledEvent(
  eventId: string,
  transactionHash: string,
): Promise<ReadModelSyncResult> {
  return mirrorEventState(eventId, transactionHash, 'refresh the cancelled event');
}

export function mirrorCompletedEvent(
  eventId: string,
  transactionHash: string,
): Promise<ReadModelSyncResult> {
  return mirrorEventState(eventId, transactionHash, 'refresh the completed event');
}

function mirrorTicketStatus(ticketId: string, status: 'Refunded' | 'Used', operation: string) {
  return synchronize(operation, async () => {
    await requireWrite(
      supabase.from('tickets').update({ status }).eq('ticket_id', ticketId).select('ticket_id'),
      true,
    );
  });
}

export function mirrorRefundedTicket(ticketId: string): Promise<ReadModelSyncResult> {
  return mirrorTicketStatus(ticketId, 'Refunded', 'mirror the refunded ticket');
}

export function mirrorUsedTicket(ticketId: string): Promise<ReadModelSyncResult> {
  return mirrorTicketStatus(ticketId, 'Used', 'mirror the used ticket');
}

export function mirrorCreatedListing(input: {
  listingId: string;
  sellerAddress: string;
  ticketId: string;
  eventId: string;
  askPriceStroops: bigint;
}): Promise<ReadModelSyncResult> {
  return synchronize('mirror the created listing', async () => {
    await requireWrite(supabase.from('listings').insert({
      listing_id: input.listingId,
      seller_address: input.sellerAddress,
      ticket_id: input.ticketId,
      event_id: input.eventId,
      ask_price_stroops: input.askPriceStroops.toString(),
      status: 'Open',
    }));
  });
}

export function mirrorCancelledListing(listingId: string): Promise<ReadModelSyncResult> {
  return synchronize('mirror the cancelled listing', async () => {
    await requireWrite(
      supabase.from('listings').update({ status: 'Cancelled' }).eq('listing_id', listingId).select('listing_id'),
      true,
    );
  });
}

export function mirrorListingSale(input: {
  listingId: string;
  ticketId: string;
  buyerAddress: string;
}): Promise<ReadModelSyncResult> {
  return synchronize('mirror the listing sale', async () => {
    await requireWrite(
      supabase.from('listings').update({ status: 'Sold' }).eq('listing_id', input.listingId).select('listing_id'),
      true,
    );
    await requireWrite(
      supabase.from('tickets').update({ owner_address: input.buyerAddress }).eq('ticket_id', input.ticketId).select('ticket_id'),
      true,
    );
  });
}
