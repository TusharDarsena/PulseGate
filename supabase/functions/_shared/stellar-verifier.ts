import {
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from 'npm:@stellar/stellar-sdk@16.1.0';

export interface AuthoritativeEvent {
  organizer: string;
  name: string;
  date_unix: bigint | number;
  end_unix: bigint | number;
  capacity: bigint | number;
  price_per_ticket: bigint | number;
  current_supply: bigint | number;
  status: { tag: string } | string;
}

export interface AuthoritativeTicket {
  owner: string;
  event_id: string;
  status: { tag: string } | string;
}

export interface AuthoritativeListing {
  seller: string;
  ticket_id: string;
  event_id: string;
  ask_price: bigint | number;
  status: { tag: string } | string;
}

export interface VerifiedContractEvent {
  topic: 'ev_create' | 'ev_cancel' | 'ev_rel';
  eventId: string;
  organizer: string;
  releasedAmount: bigint | null;
  transactionHash: string;
  ledgerSequence: number;
  ledgerClosedAt: string;
}

export interface VerifiedTicketUsedEvent {
  topic: 'tk_used';
  ticketId: string;
  transactionHash: string;
  ledgerSequence: number;
  ledgerClosedAt: string;
}

export type TicketOperationEventTopic =
  | 'tk_refund'
  | 'mk_list'
  | 'mk_cancel'
  | 'mk_sold';

export interface VerifiedTicketOperationEvent {
  topic: TicketOperationEventTopic;
  entityId: string;
  actor: string;
  amount: bigint | null;
  transactionHash: string;
  ledgerSequence: number;
  ledgerClosedAt: string;
}

export type TransactionEventResolution =
  | { status: 'not_found' }
  | { status: 'failed' }
  | { status: 'success_without_event' }
  | { status: 'verified'; proof: VerifiedContractEvent };

export type TicketUsedEventResolution =
  | { status: 'not_found' }
  | { status: 'failed' }
  | { status: 'success_without_event' }
  | { status: 'verified'; proof: VerifiedTicketUsedEvent };

export type TicketOperationEventResolution =
  | { status: 'not_found' }
  | { status: 'failed' }
  | { status: 'success_without_event' }
  | { status: 'verified'; proof: VerifiedTicketOperationEvent };

function unwrapResult(value: unknown, missingMessage: string): unknown {
  const result = value as {
    isErr?: () => boolean;
    unwrap?: () => unknown;
    tag?: string;
    values?: unknown[];
    Ok?: unknown;
  };
  if (typeof result?.isErr === 'function' && result.isErr()) {
    throw new Error(missingMessage);
  }
  if (typeof result?.unwrap === 'function') return result.unwrap();
  if (result?.tag === 'Ok') return result.values?.[0];
  if (result && typeof result === 'object' && 'Ok' in result) return result.Ok;
  return value;
}

export function asSafeNumber(
  value: bigint | number,
  field: string,
): number {
  const converted = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(converted)) {
    throw new Error(`Authoritative ${field} exceeds the supported range.`);
  }
  return converted;
}

export function eventStatus(
  value: AuthoritativeEvent['status'],
): 'Active' | 'Cancelled' | 'Completed' {
  const tag = typeof value === 'string' ? value : value?.tag;
  if (tag !== 'Active' && tag !== 'Cancelled' && tag !== 'Completed') {
    throw new Error('The TicketContract returned an unsupported event status.');
  }
  return tag;
}

export function ticketStatus(
  value: AuthoritativeTicket['status'],
): 'Active' | 'Used' | 'Refunded' {
  const tag = typeof value === 'string' ? value : value?.tag;
  if (tag !== 'Active' && tag !== 'Used' && tag !== 'Refunded') {
    throw new Error('The TicketContract returned an unsupported ticket status.');
  }
  return tag;
}

export function listingStatus(
  value: AuthoritativeListing['status'],
): 'Open' | 'Sold' | 'Cancelled' {
  const tag = typeof value === 'string' ? value : value?.tag;
  if (tag !== 'Open' && tag !== 'Sold' && tag !== 'Cancelled') {
    throw new Error('The MarketplaceContract returned an unsupported listing status.');
  }
  return tag;
}

export async function readAuthoritativeEvent(
  server: rpc.Server,
  contractId: string,
  eventId: string,
): Promise<AuthoritativeEvent> {
  const queried = await server.queryContract<unknown>(
    contractId,
    'get_event',
    { event_id: eventId },
  );
  const event = unwrapResult(
    queried.result,
    'The event does not exist on the configured TicketContract.',
  );
  if (!event || typeof event !== 'object') {
    throw new Error('The TicketContract returned an invalid event record.');
  }
  const record = event as Partial<AuthoritativeEvent>;
  if (
    typeof record.organizer !== 'string' ||
    typeof record.name !== 'string' ||
    record.date_unix === undefined ||
    record.end_unix === undefined ||
    record.capacity === undefined ||
    record.price_per_ticket === undefined ||
    record.current_supply === undefined ||
    record.status === undefined
  ) {
    throw new Error('The TicketContract returned an incomplete event record.');
  }
  return record as AuthoritativeEvent;
}

export async function readAuthoritativeTicket(
  server: rpc.Server,
  contractId: string,
  ticketId: string,
): Promise<AuthoritativeTicket> {
  const queried = await server.queryContract<unknown>(
    contractId,
    'get_ticket',
    { ticket_id: ticketId },
  );
  const ticket = unwrapResult(
    queried.result,
    'The ticket does not exist on the configured TicketContract.',
  );
  if (!ticket || typeof ticket !== 'object') {
    throw new Error('The TicketContract returned an invalid ticket record.');
  }
  const record = ticket as Partial<AuthoritativeTicket>;
  if (
    typeof record.owner !== 'string' ||
    typeof record.event_id !== 'string' ||
    record.status === undefined
  ) {
    throw new Error('The TicketContract returned an incomplete ticket record.');
  }
  return record as AuthoritativeTicket;
}

export async function readAuthoritativeListing(
  server: rpc.Server,
  contractId: string,
  seller: string,
  listingId: string,
): Promise<AuthoritativeListing> {
  const queried = await server.queryContract<unknown>(
    contractId,
    'get_listing',
    { seller, listing_id: listingId },
  );
  const listing = unwrapResult(
    queried.result,
    'The listing does not exist on the configured MarketplaceContract.',
  );
  if (!listing || typeof listing !== 'object') {
    throw new Error('The MarketplaceContract returned an invalid listing record.');
  }
  const record = listing as Partial<AuthoritativeListing>;
  if (
    typeof record.seller !== 'string' ||
    typeof record.ticket_id !== 'string' ||
    typeof record.event_id !== 'string' ||
    record.ask_price === undefined ||
    record.status === undefined
  ) {
    throw new Error('The MarketplaceContract returned an incomplete listing record.');
  }
  return record as AuthoritativeListing;
}

export async function readAuthoritativeEscrow(
  server: rpc.Server,
  contractId: string,
  eventId: string,
): Promise<bigint> {
  const queried = await server.queryContract<unknown>(
    contractId,
    'get_escrow_balance',
    { event_id: eventId },
  );
  const value = unwrapResult(
    queried.result,
    'The event escrow does not exist on the configured TicketContract.',
  );
  const amount = BigInt(String(value));
  if (amount < 0n) {
    throw new Error('The TicketContract returned an invalid escrow balance.');
  }
  return amount;
}

function transactionSource(
  envelopeXdr: unknown,
  networkPassphrase: string,
): string {
  const envelope = typeof envelopeXdr === 'string'
    ? envelopeXdr
    : envelopeXdr &&
        typeof envelopeXdr === 'object' &&
        'toXDR' in envelopeXdr &&
        typeof envelopeXdr.toXDR === 'function'
      ? envelopeXdr as xdr.TransactionEnvelope
      : null;
  if (!envelope) {
    throw new Error('The transaction envelope is unavailable.');
  }
  const transaction = TransactionBuilder.fromXDR(
    envelope,
    networkPassphrase,
  );
  return transaction.source;
}

function decodeProofValue(
  topic: VerifiedContractEvent['topic'],
  value: unknown,
): { organizer: string; releasedAmount: bigint | null } | null {
  const native = scValToNative(value as Parameters<typeof scValToNative>[0]) as unknown;
  if (topic === 'ev_rel') {
    if (!Array.isArray(native) || native.length !== 2) return null;
    const releasedAmount = BigInt(String(native[1]));
    if (releasedAmount < 0n) return null;
    return { organizer: String(native[0]), releasedAmount };
  }
  if (typeof native !== 'string') return null;
  return { organizer: native, releasedAmount: null };
}

function eventContractId(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (
    value &&
    typeof value === 'object' &&
    'contractId' in value &&
    typeof value.contractId === 'function'
  ) {
    const id = value.contractId();
    return typeof id === 'string' ? id : null;
  }
  return null;
}

export async function resolveExactContractEvent(
  server: rpc.Server,
  networkPassphrase: string,
  contractId: string,
  transactionHash: string,
  expectedSource: string,
  topic: VerifiedContractEvent['topic'],
  eventId: string,
): Promise<TransactionEventResolution> {
  const transaction = await server.getTransaction(transactionHash);
  if (transaction.status === 'NOT_FOUND') return { status: 'not_found' };
  if (transaction.status === 'FAILED') return { status: 'failed' };

  if (
    transactionSource(
      'envelopeXdr' in transaction ? transaction.envelopeXdr : undefined,
      networkPassphrase,
    ) !== expectedSource
  ) {
    throw new Error('The transaction source does not match the organizer wallet.');
  }

  const response = await server.getEvents({
    startLedger: Math.max(1, transaction.ledger),
    filters: [{
      type: 'contract',
      contractIds: [contractId],
      topics: [[
        nativeToScVal(topic, { type: 'symbol' }).toXDR('base64'),
        nativeToScVal(eventId, { type: 'string' }).toXDR('base64'),
      ]],
    }],
    limit: 100,
  });

  for (const event of response.events) {
    if (
      eventContractId(event.contractId) !== contractId ||
      event.txHash.toLowerCase() !== transactionHash.toLowerCase() ||
      !event.inSuccessfulContractCall
    ) {
      continue;
    }
    const decoded = decodeProofValue(topic, event.value);
    if (!decoded || decoded.organizer !== expectedSource) continue;
    return {
      status: 'verified',
      proof: {
        topic,
        eventId,
        organizer: decoded.organizer,
        releasedAmount: decoded.releasedAmount,
        transactionHash: event.txHash.toLowerCase(),
        ledgerSequence: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
      },
    };
  }
  return { status: 'success_without_event' };
}

export async function resolveExactTicketUsedEvent(
  server: rpc.Server,
  networkPassphrase: string,
  contractId: string,
  transactionHash: string,
  expectedSource: string,
  ticketId: string,
): Promise<TicketUsedEventResolution> {
  const transaction = await server.getTransaction(transactionHash);
  if (transaction.status === 'NOT_FOUND') return { status: 'not_found' };
  if (transaction.status === 'FAILED') return { status: 'failed' };

  if (
    transactionSource(
      'envelopeXdr' in transaction ? transaction.envelopeXdr : undefined,
      networkPassphrase,
    ) !== expectedSource
  ) {
    throw new Error('The transaction source does not match the organizer wallet.');
  }

  const response = await server.getEvents({
    startLedger: Math.max(1, transaction.ledger),
    filters: [{
      type: 'contract',
      contractIds: [contractId],
      topics: [[
        nativeToScVal('tk_used', { type: 'symbol' }).toXDR('base64'),
        nativeToScVal(ticketId, { type: 'string' }).toXDR('base64'),
      ]],
    }],
    limit: 100,
  });

  for (const event of response.events) {
    if (
      eventContractId(event.contractId) !== contractId ||
      event.txHash.toLowerCase() !== transactionHash.toLowerCase() ||
      !event.inSuccessfulContractCall
    ) {
      continue;
    }
    return {
      status: 'verified',
      proof: {
        topic: 'tk_used',
        ticketId,
        transactionHash: event.txHash.toLowerCase(),
        ledgerSequence: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
      },
    };
  }
  return { status: 'success_without_event' };
}

function decodeTicketOperationEventValue(
  topic: TicketOperationEventTopic,
  value: unknown,
): { actor: string; amount: bigint | null } | null {
  const native = scValToNative(
    value as Parameters<typeof scValToNative>[0],
  ) as unknown;
  if (topic === 'mk_cancel') {
    return typeof native === 'string'
      ? { actor: native, amount: null }
      : null;
  }
  if (!Array.isArray(native) || native.length !== 2) return null;
  const amount = BigInt(String(native[1]));
  if (amount <= 0n) return null;
  return { actor: String(native[0]), amount };
}

export async function resolveExactTicketOperationEvent(
  server: rpc.Server,
  networkPassphrase: string,
  contractId: string,
  transactionHash: string,
  expectedSource: string,
  topic: TicketOperationEventTopic,
  entityId: string,
): Promise<TicketOperationEventResolution> {
  const transaction = await server.getTransaction(transactionHash);
  if (transaction.status === 'NOT_FOUND') return { status: 'not_found' };
  if (transaction.status === 'FAILED') return { status: 'failed' };

  if (
    transactionSource(
      'envelopeXdr' in transaction ? transaction.envelopeXdr : undefined,
      networkPassphrase,
    ) !== expectedSource
  ) {
    throw new Error('The transaction source does not match the authenticated actor.');
  }

  const response = await server.getEvents({
    startLedger: Math.max(1, transaction.ledger),
    filters: [{
      type: 'contract',
      contractIds: [contractId],
      topics: [[
        nativeToScVal(topic, { type: 'symbol' }).toXDR('base64'),
        nativeToScVal(entityId, { type: 'string' }).toXDR('base64'),
      ]],
    }],
    limit: 100,
  });

  for (const event of response.events) {
    if (
      eventContractId(event.contractId) !== contractId ||
      event.txHash.toLowerCase() !== transactionHash.toLowerCase() ||
      !event.inSuccessfulContractCall
    ) {
      continue;
    }
    const decoded = decodeTicketOperationEventValue(topic, event.value);
    if (!decoded || decoded.actor !== expectedSource) continue;
    return {
      status: 'verified',
      proof: {
        topic,
        entityId,
        actor: decoded.actor,
        amount: decoded.amount,
        transactionHash: event.txHash.toLowerCase(),
        ledgerSequence: event.ledger,
        ledgerClosedAt: event.ledgerClosedAt,
      },
    };
  }
  return { status: 'success_without_event' };
}

export async function isProvablyExpiredWithoutSubmission(
  server: rpc.Server,
  organizer: string,
  sourceSequence: string | null,
  transactionMaxTime: number | null,
): Promise<boolean> {
  if (
    !sourceSequence ||
    !transactionMaxTime ||
    Math.floor(Date.now() / 1000) <= transactionMaxTime
  ) {
    return false;
  }
  const account = await server.getAccount(organizer);
  return BigInt(account.sequenceNumber()) < BigInt(sourceSequence);
}
