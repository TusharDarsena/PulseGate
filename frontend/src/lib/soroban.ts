// soroban.ts — the only file that imports from the generated contract bindings.
// All components call these wrappers; nothing imports @stellar/stellar-sdk directly. (AGENTS.md)
// Transaction pattern: AssembledTransaction.signAndSend() — D-007 revised.

import { Client as TicketClient } from 'ticket';
import { Client as MarketplaceClient } from 'marketplace';
import { TransactionBuilder } from '@stellar/stellar-sdk';

import {
  TICKET_CONTRACT_ID,
  MARKETPLACE_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from './constants';
import type { AuthoritativeEventSnapshot, Ticket, SignFn } from '../types';

export interface PreparedTransactionIdentity {
  unsignedEnvelopeHash: string;
  sourceSequence: string;
  transactionMaxTime: number;
}

export interface SignedTransactionIdentity {
  signedTransactionHash: string;
}

function parseTransactionIdentity(xdr: string): PreparedTransactionIdentity {
  const transaction = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  if (!('sequence' in transaction)) {
    throw new Error('Fee-bump organizer transactions are not supported.');
  }
  const maxTime = transaction.timeBounds?.maxTime;
  const transactionMaxTime = maxTime === undefined ? 0 : Number(maxTime);
  if (!Number.isSafeInteger(transactionMaxTime) || transactionMaxTime <= 0) {
    throw new Error('The organizer transaction must have a valid expiration time.');
  }
  return {
    unsignedEnvelopeHash: transaction.hash().toString('hex'),
    sourceSequence: transaction.sequence,
    transactionMaxTime,
  };
}

export function inspectPreparedTransaction(xdr: string): PreparedTransactionIdentity {
  return parseTransactionIdentity(xdr);
}

/**
 * Freighter returns signed XDR to this wrapper first. Persisting its hash must
 * succeed before the generated SDK receives the XDR and can submit it.
 */
export function recordSignedTransactionBeforeSubmission(
  signFn: SignFn,
  record: (identity: SignedTransactionIdentity) => Promise<void>,
): SignFn {
  return async (xdr, options) => {
    const signed = await signFn(xdr, options);
    const identity = parseTransactionIdentity(signed.signedTxXdr);
    await record({ signedTransactionHash: identity.unsignedEnvelopeHash });
    return signed;
  };
}

// ─── Contract error maps ──────────────────────────────────────────────────────
// Maps on-chain error codes to user-readable messages.

const TICKET_ERRORS: Record<number, string> = {
  1:  'This contract is already initialized.',
  2:  'Contract not initialized — contact support.',
  3:  'Event not found.',
  4:  'This event is no longer active.',
  5:  'This event is sold out.',
  6:  'Event has not been cancelled — refund not available.',
  7:  'Funds cannot be released yet (event date not passed).',
  8:  'Funds have already been released for this event.',
  9:  'Ticket not found.',
  10: 'This ticket has already been used.',
  11: 'You do not own this ticket.',
  12: 'Only the event organizer can perform this action.',
  13: 'Only the marketplace contract can perform this action.',
  14: 'Insufficient escrow balance.',
  15: 'Arithmetic overflow — contact support.',
  16: 'Arithmetic underflow — contact support.',
  17: 'Division by zero — contact support.',
  18: 'An event with this ID already exists.',
  19: 'Event capacity must be greater than zero.',
  20: 'Ticket price must be greater than zero.',
  21: 'Event date must be in the future.',
  22: 'A ticket with this ID already exists.',
  23: 'Primary sales closed when this event started.',
  24: 'Event end time must be after its start time.',
  25: 'This ticket was refunded.',
  26: 'This ticket belongs to another event.',
  27: 'Check-in is not open yet.',
  28: 'Check-in is closed.',
};

const MARKETPLACE_ERRORS: Record<number, string> = {
  1:  'Marketplace already initialized.',
  2:  'Marketplace not initialized.',
  3:  'Listing not found.',
  4:  'This listing is no longer open.',
  5:  'A listing with this ID already exists.',
  6:  'Ask price must be greater than zero.',
  7:  'Only the original seller can perform this action.',
  8:  'You cannot buy your own listing.',
  9:  'Arithmetic overflow — contact support.',
  10: 'Arithmetic underflow — contact support.',
  11: 'Division by zero — contact support.',
  12: 'Ticket ownership changed — listing is stale.',
  14: 'Resale is available only while the event is active.',
};

// ─── Client factories ─────────────────────────────────────────────────────────

function getTicketClient(publicKey: string, contractId = TICKET_CONTRACT_ID): TicketClient {
  return new TicketClient({
    contractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey,
  });
}

export async function purchaseProofTicket(
  contractId: string,
  eventId: string,
  buyerPublicKey: string,
  ticketId: string,
  signFn: SignFn,
): Promise<string> {
  if (!import.meta.env.DEV || import.meta.env.VITE_ENABLE_DFNS_PROOF !== 'true') {
    throw new Error('The isolated Dfns proof is disabled.');
  }
  if (!contractId || contractId === TICKET_CONTRACT_ID) {
    throw new Error('The proof must use a disposable TicketContract, not the application contract.');
  }
  const client = getTicketClient(buyerPublicKey, contractId);
  const tx = await client.purchase({
    event_id: eventId,
    buyer: buyerPublicKey,
    ticket_id: ticketId,
  });
  const sent = await tx.signAndSend({ signTransaction: signFn });
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) throw new Error('The isolated proof transaction did not return a hash.');
  return hash;
}

function getMarketplaceClient(publicKey: string): MarketplaceClient {
  return new MarketplaceClient({
    contractId: MARKETPLACE_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey,
  });
}

// ─── Error extraction ─────────────────────────────────────────────────────────

function extractErrorMessage(err: unknown, errorMap: Record<number, string>): string {
  if (err instanceof Error) {
    // The SDK surfaces contract errors as messages containing the error code
    const match = err.message.match(/Error\(Contract, #(\d+)\)/);
    if (match) {
      const code = parseInt(match[1], 10);
      return errorMap[code] ?? `Contract error #${code}.`;
    }
    return err.message;
  }
  return 'An unexpected error occurred.';
}

// ─── Write functions (require signing) ───────────────────────────────────────

export interface CreateEventParams {
  eventId: string;
  name: string;
  dateUnix: number;
  endUnix: number;
  capacityXlm: number;     // raw capacity (ticket count)
  priceStroops: bigint;    // price in stroops — use xlmToStroops() from types
}

export interface PreparedOrganizerTransaction {
  identity: PreparedTransactionIdentity;
  estimatedFeeStroops: bigint;
  submit: (
    signFn: SignFn,
    recordSigned: (identity: SignedTransactionIdentity) => Promise<void>,
  ) => Promise<{ transactionHash: string }>;
}

interface OrganizerAssembledTransaction {
  built?: { fee: string | number };
  toXDR(): string;
  signAndSend(options: { signTransaction: SignFn }): Promise<{
    sendTransactionResponse?: { hash?: string };
  }>;
}

function preparedOrganizerTransaction(
  transaction: OrganizerAssembledTransaction,
  errorMap: Record<number, string>,
  missingHashMessage: string,
): PreparedOrganizerTransaction {
  const identity = inspectPreparedTransaction(transaction.toXDR());
  const estimatedFeeStroops = BigInt(transaction.built?.fee ?? 0);
  return {
    identity,
    estimatedFeeStroops,
    submit: async (signFn, recordSigned) => {
      try {
        const sent = await transaction.signAndSend({
          signTransaction: recordSignedTransactionBeforeSubmission(signFn, recordSigned),
        });
        const hash = sent.sendTransactionResponse?.hash;
        if (!hash) throw new Error(missingHashMessage);
        return { transactionHash: hash };
      } catch (error) {
        throw new Error(extractErrorMessage(error, errorMap), { cause: error });
      }
    },
  };
}

export interface PreparedTicketPurchase {
  estimatedFeeStroops: bigint;
  submit: (signFn: SignFn) => Promise<{ transactionHash: string }>;
}

/**
 * Assemble and simulate one reserved ticket purchase. The returned controller
 * remains purchase-specific and keeps generated binding types inside this file.
 */
export async function prepareTicketPurchase(
  eventId: string,
  buyerPublicKey: string,
  ticketId: string,
): Promise<PreparedTicketPurchase> {
  const client = getTicketClient(buyerPublicKey);
  try {
    const tx = await client.purchase({ event_id: eventId, buyer: buyerPublicKey, ticket_id: ticketId });
    const estimatedFeeStroops = BigInt(tx.built?.fee ?? 0);
    return {
      estimatedFeeStroops,
      submit: async (signFn) => {
        try {
          const sent = await tx.signAndSend({ signTransaction: signFn });
          const hash = sent.sendTransactionResponse?.hash;
          if (!hash) {
            throw new Error('The purchase transaction completed without exposing its hash.');
          }
          return { transactionHash: hash };
        } catch (error) {
          throw new Error(extractErrorMessage(error, TICKET_ERRORS), { cause: error });
        }
      },
    };
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}

/** Assemble and simulate a recoverable event publication transaction. */
export async function prepareCreateEvent(
  params: CreateEventParams,
  organizerPublicKey: string,
): Promise<PreparedOrganizerTransaction> {
  const client = getTicketClient(organizerPublicKey);
  try {
    const tx = await client.create_event({
      organizer: organizerPublicKey,
      event_id: params.eventId,
      name: params.name,
      date_unix: BigInt(params.dateUnix),
      end_unix: BigInt(params.endUnix),
      capacity: BigInt(params.capacityXlm),
      price_per_ticket: params.priceStroops,
    });
    return preparedOrganizerTransaction(
      tx,
      TICKET_ERRORS,
      'The event transaction confirmed without returning a hash.',
    );
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}

/**
 * Assemble and simulate an event completion and escrow release transaction.
 */
export async function prepareReleaseFunds(
  eventId: string,
  organizerPublicKey: string,
): Promise<PreparedOrganizerTransaction> {
  const client = getTicketClient(organizerPublicKey);
  try {
    const tx = await client.release_funds({ event_id: eventId, organizer: organizerPublicKey });
    return preparedOrganizerTransaction(
      tx,
      TICKET_ERRORS,
      'The release transaction confirmed without returning a hash.',
    );
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}

/**
 * Cancel an event. Pull-based refunds — attendees call refundTicket() individually. (D-002)
 */
export async function prepareCancelEvent(
  eventId: string,
  organizerPublicKey: string,
): Promise<PreparedOrganizerTransaction> {
  const client = getTicketClient(organizerPublicKey);
  try {
    const tx = await client.cancel_event({ event_id: eventId, organizer: organizerPublicKey });
    return preparedOrganizerTransaction(
      tx,
      TICKET_ERRORS,
      'The cancellation transaction confirmed without returning a hash.',
    );
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}

/**
 * Mark a ticket as used at the venue door. Only callable by the event organizer.
 * Called AFTER the QR signature has been verified locally. (D-005)
 */
export async function prepareMarkUsed(
  eventId: string,
  ticketId: string,
  expectedOwnerPublicKey: string,
  organizerPublicKey: string,
): Promise<PreparedOrganizerTransaction> {
  const client = getTicketClient(organizerPublicKey);
  try {
    const tx = await client.mark_used({
      event_id: eventId,
      ticket_id: ticketId,
      expected_owner: expectedOwnerPublicKey,
      organizer: organizerPublicKey,
    });
    return preparedOrganizerTransaction(
      tx,
      TICKET_ERRORS,
      'The check-in transaction confirmed without returning a hash.',
    );
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}

export async function markUsed(
  eventId: string,
  ticketId: string,
  expectedOwnerPublicKey: string,
  organizerPublicKey: string,
  signFn: SignFn,
): Promise<void> {
  const transaction = await prepareMarkUsed(
    eventId,
    ticketId,
    expectedOwnerPublicKey,
    organizerPublicKey,
  );
  await transaction.submit(signFn, async () => undefined);
}

/**
 * Refund a ticket after an event cancellation. Pull-based — attendee calls this. (D-002)
 */
export async function refundTicket(
  ticketId: string,
  attendeePublicKey: string,
  signFn: SignFn
): Promise<void> {
  const client = getTicketClient(attendeePublicKey);
  try {
    const tx = await client.refund({ ticket_id: ticketId, attendee: attendeePublicKey });
    await tx.signAndSend({ signTransaction: signFn });
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}

// ─── Marketplace write functions ──────────────────────────────────────────────

/**
 * Create a secondary-market listing for a ticket.
 * listingId is generated by the caller (generateID()).
 */
export async function listTicket(
  sellerPublicKey: string,
  listingId: string,
  ticketId: string,
  eventId: string,
  askPriceStroops: bigint,
  signFn: SignFn
): Promise<void> {
  const client = getMarketplaceClient(sellerPublicKey);
  try {
    const tx = await client.list_ticket({
      seller: sellerPublicKey,
      listing_id: listingId,
      ticket_id: ticketId,
      event_id: eventId,
      ask_price: askPriceStroops,
    });
    await tx.signAndSend({ signTransaction: signFn });
  } catch (err) {
    throw new Error(extractErrorMessage(err, MARKETPLACE_ERRORS), { cause: err });
  }
}

/**
 * Purchase a secondary-market listing.
 */
export async function buyListing(
  sellerPublicKey: string,
  listingId: string,
  buyerPublicKey: string,
  signFn: SignFn
): Promise<void> {
  const client = getMarketplaceClient(buyerPublicKey);
  try {
    const tx = await client.buy_listing({
      seller: sellerPublicKey,
      listing_id: listingId,
      buyer: buyerPublicKey,
    });
    await tx.signAndSend({ signTransaction: signFn });
  } catch (err) {
    throw new Error(extractErrorMessage(err, MARKETPLACE_ERRORS), { cause: err });
  }
}

/**
 * Cancel a secondary-market listing. Only the original seller can cancel.
 */
export async function cancelListing(
  sellerPublicKey: string,
  listingId: string,
  signFn: SignFn
): Promise<void> {
  const client = getMarketplaceClient(sellerPublicKey);
  try {
    const tx = await client.cancel_listing({ seller: sellerPublicKey, listing_id: listingId });
    await tx.signAndSend({ signTransaction: signFn });
  } catch (err) {
    throw new Error(extractErrorMessage(err, MARKETPLACE_ERRORS), { cause: err });
  }
}

// ─── Read-only functions (no signing required) ────────────────────────────────

// Uses a dummy public key for read-only calls — the SDK requires one for the
// client constructor, but simulation-only calls don't submit a transaction.
const READ_ONLY_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

/**
 * Fetch a single ticket's current on-chain state by ID.
 * Returns null if the ticket does not exist.
 */
export async function getTicket(ticketId: string): Promise<Ticket | null> {
  const client = getTicketClient(READ_ONLY_KEY);
  try {
    const tx = await client.get_ticket({ ticket_id: ticketId });
    const result = tx.result;
    if (!result || result.isErr()) return null;

    const t = result.unwrap();
    return {
      ticketId,
      eventId: t.event_id,
      owner: t.owner,
      status: t.status.tag as Ticket['status'],
    };
  } catch {
    return null;
  }
}

export async function getAuthoritativeTicket(ticketId: string): Promise<
  | { kind: 'found'; ticket: Ticket }
  | { kind: 'not_found' }
> {
  const client = getTicketClient(READ_ONLY_KEY);
  try {
    const tx = await client.get_ticket({ ticket_id: ticketId });
    const result = tx.result;
    if (!result || result.isErr()) return { kind: 'not_found' };

    const t = result.unwrap();
    return {
      kind: 'found',
      ticket: {
        ticketId,
        eventId: t.event_id,
        owner: t.owner,
        status: t.status.tag as Ticket['status'],
      },
    };
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}

/**
 * Fetch a single event's current authoritative on-chain state.
 * Transport failures are deliberately surfaced so callers can distinguish
 * Unavailable from Event not found.
 */
export async function getEvent(eventId: string): Promise<AuthoritativeEventSnapshot> {
  const client = getTicketClient(READ_ONLY_KEY);
  try {
    const [eventTx, escrowTx] = await Promise.all([
      client.get_event({ event_id: eventId }),
      client.get_escrow_balance({ event_id: eventId }),
    ]);
    const result = eventTx.result;
    const escrowResult = escrowTx.result;
    if (!result || result.isErr() || !escrowResult || escrowResult.isErr()) {
      throw new Error('The event does not exist on the configured TicketContract.');
    }
    const event = result.unwrap();
    const escrow = escrowResult.unwrap();
    const dateUnix = Number(event.date_unix);
    const endUnix = Number(event.end_unix);
    const capacity = Number(event.capacity);
    const pricePerTicket = Number(event.price_per_ticket);
    const currentSupply = Number(event.current_supply);
    const escrowBalance = Number(escrow);
    for (const [field, value] of Object.entries({
      dateUnix,
      endUnix,
      capacity,
      pricePerTicket,
      currentSupply,
      escrowBalance,
    })) {
      if (!Number.isSafeInteger(value)) {
        throw new Error(`On-chain ${field} exceeds the supported testnet range.`);
      }
    }
    return {
      eventId,
      organizer: event.organizer,
      name: event.name,
      dateUnix,
      endUnix,
      capacity,
      pricePerTicket,
      currentSupply,
      escrowBalance,
      status: event.status.tag,
    };
  } catch (err) {
    throw new Error(extractErrorMessage(err, TICKET_ERRORS), { cause: err });
  }
}
