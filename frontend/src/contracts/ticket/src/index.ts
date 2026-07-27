import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




export const ContractError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"EventNotFound"},
  4: {message:"EventNotActive"},
  5: {message:"EventCapacityExceeded"},
  6: {message:"EventNotCancelled"},
  7: {message:"EventNotEligibleForRelease"},
  8: {message:"EventAlreadyCompleted"},
  18: {message:"EventAlreadyExists"},
  19: {message:"InvalidCapacity"},
  20: {message:"InvalidPrice"},
  21: {message:"EventDateInPast"},
  23: {message:"EventSalesClosed"},
  24: {message:"InvalidEventEndTime"},
  9: {message:"TicketNotFound"},
  10: {message:"TicketAlreadyUsed"},
  11: {message:"TicketNotOwnedByCaller"},
  22: {message:"TicketAlreadyExists"},
  12: {message:"OnlyOrganizerAllowed"},
  13: {message:"OnlyMarketplaceAllowed"},
  14: {message:"InsufficientEscrowBalance"},
  15: {message:"Overflow"},
  16: {message:"Underflow"},
  17: {message:"DivisionByZero"}
}


/**
 * Full event record stored on-chain.
 */
export interface Event {
  /**
 * Maximum number of tickets that can be sold
 */
capacity: i128;
  /**
 * How many tickets have been sold so far
 */
current_supply: i128;
  /**
 * Unix timestamp when primary sales close and the event starts
 */
date_unix: u64;
  /**
 * Unix timestamp when the event ends and completion becomes eligible
 */
end_unix: u64;
  /**
 * Short display name (stored as String to handle spaces and length > 32)
 */
name: string;
  /**
 * Address that created the event and will receive funds after release
 */
organizer: string;
  /**
 * Price per ticket in stroops (1 XLM = 10_000_000 stroops)
 */
price_per_ticket: i128;
  status: EventStatus;
}


/**
 * Individual ticket record stored on-chain.
 */
export interface Ticket {
  /**
 * Which event this ticket belongs to
 */
event_id: string;
  /**
 * Current owner of this ticket
 */
owner: string;
  /**
 * Lifecycle state: Active → Used (scanned) or Refunded (event cancelled).
 * Never use a bool here — on-chain data is permanent and analytics must
 * distinguish the two terminal states. See D-018.
 */
status: TicketStatus;
}

/**
 * Storage keys for all persistent data in TicketContract.
 * Keyed by event_id or ticket_id (both Strings).
 */
export type DataKey = {tag: "Event", values: readonly [string]} | {tag: "Ticket", values: readonly [string]} | {tag: "Escrow", values: readonly [string]} | {tag: "MarketplaceAddress", values: void} | {tag: "XlmToken", values: void} | {tag: "Admin", values: void};

/**
 * Event status lifecycle.
 */
export type EventStatus = {tag: "Active", values: void} | {tag: "Cancelled", values: void} | {tag: "Completed", values: void};

/**
 * Ticket status lifecycle.
 * Kept as a three-variant enum rather than a bool so on-chain history can
 * distinguish a scanned ticket (Used) from a refunded one (Refunded).
 * Changing this after data lands on-chain requires a storage migration — do it now.
 */
export type TicketStatus = {tag: "Active", values: void} | {tag: "Used", values: void} | {tag: "Refunded", values: void};

export interface Client {
  /**
   * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  refund: ({ticket_id, attendee}: {ticket_id: string, attendee: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a purchase transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Purchase a ticket. Pulls price_per_ticket XLM from buyer into escrow.
   * Token address is read from contract storage — never trusted from caller (S-001).
   */
  purchase: ({event_id, buyer, ticket_id}: {event_id: string, buyer: string, ticket_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_event transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_event: ({event_id}: {event_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Event>>>

  /**
   * Construct and simulate a mark_used transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  mark_used: ({ticket_id, organizer}: {ticket_id: string, organizer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_ticket transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_ticket: ({ticket_id}: {ticket_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Ticket>>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the one marketplace address allowed to call restricted_transfer,
   * and the trusted XLM SAC token address.
   * Can only be called once. Admin is authenticated to prevent front-running.
   */
  initialize: ({admin, marketplace_address, xlm_token}: {admin: string, marketplace_address: string, xlm_token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_event transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel event. Only organizer. Does not auto-refund — pull-based per D-002.
   */
  cancel_event: ({event_id, organizer}: {event_id: string, organizer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a create_event transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a new event. Does NOT mint tickets — lazy minting at purchase time.
   */
  create_event: ({organizer, event_id, name, date_unix, end_unix, capacity, price_per_ticket}: {organizer: string, event_id: string, name: string, date_unix: u64, end_unix: u64, capacity: i128, price_per_ticket: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_xlm_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the trusted XLM SAC token address stored at initialize.
   * Useful for frontend transparency and test assertions.
   */
  get_xlm_token: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a release_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Complete the event and release escrowed funds to organizer.
   * Only callable at or after the authoritative event end time.
   * Token address is read from contract storage — never trusted from caller (S-001).
   */
  release_funds: ({event_id, organizer}: {event_id: string, organizer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_marketplace transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_marketplace: (options?: MethodOptions) => Promise<AssembledTransaction<Result<string>>>

  /**
   * Construct and simulate a get_escrow_balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Return the actual XLM escrow held for an existing event.
   */
  get_escrow_balance: ({event_id}: {event_id: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<i128>>>

  /**
   * Construct and simulate a restricted_transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer ticket ownership. ONLY the stored marketplace address can call this.
   */
  restricted_transfer: ({ticket_id, new_owner}: {ticket_id: string, new_owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAGcmVmdW5kAAAAAAACAAAAAAAAAAl0aWNrZXRfaWQAAAAAAAAQAAAAAAAAAAhhdHRlbmRlZQAAABMAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAJhQdXJjaGFzZSBhIHRpY2tldC4gUHVsbHMgcHJpY2VfcGVyX3RpY2tldCBYTE0gZnJvbSBidXllciBpbnRvIGVzY3Jvdy4KVG9rZW4gYWRkcmVzcyBpcyByZWFkIGZyb20gY29udHJhY3Qgc3RvcmFnZSDigJQgbmV2ZXIgdHJ1c3RlZCBmcm9tIGNhbGxlciAoUy0wMDEpLgAAAAhwdXJjaGFzZQAAAAMAAAAAAAAACGV2ZW50X2lkAAAAEAAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAAAAAAl0aWNrZXRfaWQAAAAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAJZ2V0X2V2ZW50AAAAAAAAAQAAAAAAAAAIZXZlbnRfaWQAAAAQAAAAAQAAA+kAAAfQAAAABUV2ZW50AAAAAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAAAAAAAJbWFya191c2VkAAAAAAAAAgAAAAAAAAAJdGlja2V0X2lkAAAAAAAAEAAAAAAAAAAJb3JnYW5pemVyAAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAKZ2V0X3RpY2tldAAAAAAAAQAAAAAAAAAJdGlja2V0X2lkAAAAAAAAEAAAAAEAAAPpAAAH0AAAAAZUaWNrZXQAAAAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAALVTZXQgdGhlIG9uZSBtYXJrZXRwbGFjZSBhZGRyZXNzIGFsbG93ZWQgdG8gY2FsbCByZXN0cmljdGVkX3RyYW5zZmVyLAphbmQgdGhlIHRydXN0ZWQgWExNIFNBQyB0b2tlbiBhZGRyZXNzLgpDYW4gb25seSBiZSBjYWxsZWQgb25jZS4gQWRtaW4gaXMgYXV0aGVudGljYXRlZCB0byBwcmV2ZW50IGZyb250LXJ1bm5pbmcuAAAAAAAACmluaXRpYWxpemUAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAATbWFya2V0cGxhY2VfYWRkcmVzcwAAAAATAAAAAAAAAAl4bG1fdG9rZW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAAExDYW5jZWwgZXZlbnQuIE9ubHkgb3JnYW5pemVyLiBEb2VzIG5vdCBhdXRvLXJlZnVuZCDigJQgcHVsbC1iYXNlZCBwZXIgRC0wMDIuAAAADGNhbmNlbF9ldmVudAAAAAIAAAAAAAAACGV2ZW50X2lkAAAAEAAAAAAAAAAJb3JnYW5pemVyAAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAExDcmVhdGUgYSBuZXcgZXZlbnQuIERvZXMgTk9UIG1pbnQgdGlja2V0cyDigJQgbGF6eSBtaW50aW5nIGF0IHB1cmNoYXNlIHRpbWUuAAAADGNyZWF0ZV9ldmVudAAAAAcAAAAAAAAACW9yZ2FuaXplcgAAAAAAABMAAAAAAAAACGV2ZW50X2lkAAAAEAAAAAAAAAAEbmFtZQAAABAAAAAAAAAACWRhdGVfdW5peAAAAAAAAAYAAAAAAAAACGVuZF91bml4AAAABgAAAAAAAAAIY2FwYWNpdHkAAAALAAAAAAAAABBwcmljZV9wZXJfdGlja2V0AAAACwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAHRSZXR1cm4gdGhlIHRydXN0ZWQgWExNIFNBQyB0b2tlbiBhZGRyZXNzIHN0b3JlZCBhdCBpbml0aWFsaXplLgpVc2VmdWwgZm9yIGZyb250ZW5kIHRyYW5zcGFyZW5jeSBhbmQgdGVzdCBhc3NlcnRpb25zLgAAAA1nZXRfeGxtX3Rva2VuAAAAAAAAAAAAAAEAAAPpAAAAEwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAMpDb21wbGV0ZSB0aGUgZXZlbnQgYW5kIHJlbGVhc2UgZXNjcm93ZWQgZnVuZHMgdG8gb3JnYW5pemVyLgpPbmx5IGNhbGxhYmxlIGF0IG9yIGFmdGVyIHRoZSBhdXRob3JpdGF0aXZlIGV2ZW50IGVuZCB0aW1lLgpUb2tlbiBhZGRyZXNzIGlzIHJlYWQgZnJvbSBjb250cmFjdCBzdG9yYWdlIOKAlCBuZXZlciB0cnVzdGVkIGZyb20gY2FsbGVyIChTLTAwMSkuAAAAAAANcmVsZWFzZV9mdW5kcwAAAAAAAAIAAAAAAAAACGV2ZW50X2lkAAAAEAAAAAAAAAAJb3JnYW5pemVyAAAAAAAAEwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAAAAAAAPZ2V0X21hcmtldHBsYWNlAAAAAAAAAAABAAAD6QAAABMAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAADhSZXR1cm4gdGhlIGFjdHVhbCBYTE0gZXNjcm93IGhlbGQgZm9yIGFuIGV4aXN0aW5nIGV2ZW50LgAAABJnZXRfZXNjcm93X2JhbGFuY2UAAAAAAAEAAAAAAAAACGV2ZW50X2lkAAAAEAAAAAEAAAPpAAAACwAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAAE1UcmFuc2ZlciB0aWNrZXQgb3duZXJzaGlwLiBPTkxZIHRoZSBzdG9yZWQgbWFya2V0cGxhY2UgYWRkcmVzcyBjYW4gY2FsbCB0aGlzLgAAAAAAABNyZXN0cmljdGVkX3RyYW5zZmVyAAAAAAIAAAAAAAAACXRpY2tldF9pZAAAAAAAABAAAAAAAAAACW5ld19vd25lcgAAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAABAAAAAAAAAAAAAAADUNvbnRyYWN0RXJyb3IAAAAAAAAYAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAACAAAAAAAAAA1FdmVudE5vdEZvdW5kAAAAAAAAAwAAAAAAAAAORXZlbnROb3RBY3RpdmUAAAAAAAQAAAAAAAAAFUV2ZW50Q2FwYWNpdHlFeGNlZWRlZAAAAAAAAAUAAAAAAAAAEUV2ZW50Tm90Q2FuY2VsbGVkAAAAAAAABgAAAAAAAAAaRXZlbnROb3RFbGlnaWJsZUZvclJlbGVhc2UAAAAAAAcAAAAAAAAAFUV2ZW50QWxyZWFkeUNvbXBsZXRlZAAAAAAAAAgAAAAAAAAAEkV2ZW50QWxyZWFkeUV4aXN0cwAAAAAAEgAAAAAAAAAPSW52YWxpZENhcGFjaXR5AAAAABMAAAAAAAAADEludmFsaWRQcmljZQAAABQAAAAAAAAAD0V2ZW50RGF0ZUluUGFzdAAAAAAVAAAAAAAAABBFdmVudFNhbGVzQ2xvc2VkAAAAFwAAAAAAAAATSW52YWxpZEV2ZW50RW5kVGltZQAAAAAYAAAAAAAAAA5UaWNrZXROb3RGb3VuZAAAAAAACQAAAAAAAAARVGlja2V0QWxyZWFkeVVzZWQAAAAAAAAKAAAAAAAAABZUaWNrZXROb3RPd25lZEJ5Q2FsbGVyAAAAAAALAAAAAAAAABNUaWNrZXRBbHJlYWR5RXhpc3RzAAAAABYAAAAAAAAAFE9ubHlPcmdhbml6ZXJBbGxvd2VkAAAADAAAAAAAAAAWT25seU1hcmtldHBsYWNlQWxsb3dlZAAAAAAADQAAAAAAAAAZSW5zdWZmaWNpZW50RXNjcm93QmFsYW5jZQAAAAAAAA4AAAAAAAAACE92ZXJmbG93AAAADwAAAAAAAAAJVW5kZXJmbG93AAAAAAAAEAAAAAAAAAAORGl2aXNpb25CeVplcm8AAAAAABE=",
        "AAAAAQAAACJGdWxsIGV2ZW50IHJlY29yZCBzdG9yZWQgb24tY2hhaW4uAAAAAAAAAAAABUV2ZW50AAAAAAAACAAAACpNYXhpbXVtIG51bWJlciBvZiB0aWNrZXRzIHRoYXQgY2FuIGJlIHNvbGQAAAAAAAhjYXBhY2l0eQAAAAsAAAAmSG93IG1hbnkgdGlja2V0cyBoYXZlIGJlZW4gc29sZCBzbyBmYXIAAAAAAA5jdXJyZW50X3N1cHBseQAAAAAACwAAADxVbml4IHRpbWVzdGFtcCB3aGVuIHByaW1hcnkgc2FsZXMgY2xvc2UgYW5kIHRoZSBldmVudCBzdGFydHMAAAAJZGF0ZV91bml4AAAAAAAABgAAAEJVbml4IHRpbWVzdGFtcCB3aGVuIHRoZSBldmVudCBlbmRzIGFuZCBjb21wbGV0aW9uIGJlY29tZXMgZWxpZ2libGUAAAAAAAhlbmRfdW5peAAAAAYAAABGU2hvcnQgZGlzcGxheSBuYW1lIChzdG9yZWQgYXMgU3RyaW5nIHRvIGhhbmRsZSBzcGFjZXMgYW5kIGxlbmd0aCA+IDMyKQAAAAAABG5hbWUAAAAQAAAAQ0FkZHJlc3MgdGhhdCBjcmVhdGVkIHRoZSBldmVudCBhbmQgd2lsbCByZWNlaXZlIGZ1bmRzIGFmdGVyIHJlbGVhc2UAAAAACW9yZ2FuaXplcgAAAAAAABMAAAA4UHJpY2UgcGVyIHRpY2tldCBpbiBzdHJvb3BzICgxIFhMTSA9IDEwXzAwMF8wMDAgc3Ryb29wcykAAAAQcHJpY2VfcGVyX3RpY2tldAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAAtFdmVudFN0YXR1cwA=",
        "AAAAAQAAAClJbmRpdmlkdWFsIHRpY2tldCByZWNvcmQgc3RvcmVkIG9uLWNoYWluLgAAAAAAAAAAAAAGVGlja2V0AAAAAAADAAAAIldoaWNoIGV2ZW50IHRoaXMgdGlja2V0IGJlbG9uZ3MgdG8AAAAAAAhldmVudF9pZAAAABAAAAAcQ3VycmVudCBvd25lciBvZiB0aGlzIHRpY2tldAAAAAVvd25lcgAAAAAAABMAAADBTGlmZWN5Y2xlIHN0YXRlOiBBY3RpdmUg4oaSIFVzZWQgKHNjYW5uZWQpIG9yIFJlZnVuZGVkIChldmVudCBjYW5jZWxsZWQpLgpOZXZlciB1c2UgYSBib29sIGhlcmUg4oCUIG9uLWNoYWluIGRhdGEgaXMgcGVybWFuZW50IGFuZCBhbmFseXRpY3MgbXVzdApkaXN0aW5ndWlzaCB0aGUgdHdvIHRlcm1pbmFsIHN0YXRlcy4gU2VlIEQtMDE4LgAAAAAAAAZzdGF0dXMAAAAAB9AAAAAMVGlja2V0U3RhdHVz",
        "AAAAAgAAAGZTdG9yYWdlIGtleXMgZm9yIGFsbCBwZXJzaXN0ZW50IGRhdGEgaW4gVGlja2V0Q29udHJhY3QuCktleWVkIGJ5IGV2ZW50X2lkIG9yIHRpY2tldF9pZCAoYm90aCBTdHJpbmdzKS4AAAAAAAAAAAAHRGF0YUtleQAAAAAGAAAAAQAAAClTdG9yZXMgYW4gRXZlbnQgcmVjb3JkLCBrZXllZCBieSBldmVudF9pZAAAAAAAAAVFdmVudAAAAAAAAAEAAAAQAAAAAQAAACpTdG9yZXMgYSBUaWNrZXQgcmVjb3JkLCBrZXllZCBieSB0aWNrZXRfaWQAAAAAAAZUaWNrZXQAAAAAAAEAAAAQAAAAAQAAAEJTdG9yZXMgZXNjcm93IGJhbGFuY2UgKGluIHN0cm9vcHMpIGZvciBhbiBldmVudCwga2V5ZWQgYnkgZXZlbnRfaWQAAAAAAAZFc2Nyb3cAAAAAAAEAAAAQAAAAAAAAAOFUaGUgb25lIGFkZHJlc3MgYWxsb3dlZCB0byBjYWxsIHJlc3RyaWN0ZWRfdHJhbnNmZXIuClNldCBvbmNlIGF0IGluaXRpYWxpemUoKSwgbmV2ZXIgY2hhbmdlcy4KTk9URTogU3RvcmVkIGluIGluc3RhbmNlKCkgc3RvcmFnZSDigJQgbm90IHBlcnNpc3RlbnQoKSDigJQgYmVjYXVzZSB0aGlzIElTCmNvbnRyYWN0LWxpZmV0aW1lIGRhdGEuIFNlZSBkb2NzL2FyY2hpdGVjdHVyZS5tZCBELTAxMi4AAAAAAAASTWFya2V0cGxhY2VBZGRyZXNzAAAAAAAAAAAAflRoZSB0cnVzdGVkIFhMTSBTQUMgYWRkcmVzcy4gU2V0IG9uY2UgYXQgaW5pdGlhbGl6ZSgpLgpOZXZlciBzdXBwbGllZCBieSBjYWxsZXJzIOKAlCBwcmV2ZW50cyBmYWtlLXRva2VuIGVzY3JvdyBkcmFpbiAoUy0wMDEpLgAAAAAACFhsbVRva2VuAAAAAAAAAIRBZG1pbiBhZGRyZXNzIOKAlCBzZXQgb25jZSBhdCBpbml0aWFsaXplLCBjYW4gcmUtaW5pdGlhbGl6ZSBhZnRlciBjb250cmFjdCB1cGdyYWRlLgpTdG9yZWQgaW4gaW5zdGFuY2UoKSDigJQgY29udHJhY3QtbGlmZXRpbWUgZGF0YS4AAAAFQWRtaW4AAAA=",
        "AAAAAgAAABdFdmVudCBzdGF0dXMgbGlmZWN5Y2xlLgAAAAAAAAAAC0V2ZW50U3RhdHVzAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACUNhbmNlbGxlZAAAAAAAAAAAAAAAAAAACUNvbXBsZXRlZAAAAA==",
        "AAAAAgAAAPhUaWNrZXQgc3RhdHVzIGxpZmVjeWNsZS4KS2VwdCBhcyBhIHRocmVlLXZhcmlhbnQgZW51bSByYXRoZXIgdGhhbiBhIGJvb2wgc28gb24tY2hhaW4gaGlzdG9yeSBjYW4KZGlzdGluZ3Vpc2ggYSBzY2FubmVkIHRpY2tldCAoVXNlZCkgZnJvbSBhIHJlZnVuZGVkIG9uZSAoUmVmdW5kZWQpLgpDaGFuZ2luZyB0aGlzIGFmdGVyIGRhdGEgbGFuZHMgb24tY2hhaW4gcmVxdWlyZXMgYSBzdG9yYWdlIG1pZ3JhdGlvbiDigJQgZG8gaXQgbm93LgAAAAAAAAAMVGlja2V0U3RhdHVzAAAAAwAAAAAAAAAyVGlja2V0IGlzIHZhbGlkIGFuZCBoYXMgbm90IGJlZW4gdXNlZCBvciByZWZ1bmRlZC4AAAAAAAZBY3RpdmUAAAAAAAAAAAAzVGlja2V0IHdhcyBzY2FubmVkIGF0IHRoZSB2ZW51ZSBkb29yIHZpYSBtYXJrX3VzZWQuAAAAAARVc2VkAAAAAAAAADRUaWNrZXQgd2FzIHJlZnVuZGVkIGJlY2F1c2UgdGhlIGV2ZW50IHdhcyBjYW5jZWxsZWQuAAAACFJlZnVuZGVk" ]),
      options
    )
  }
  public readonly fromJSON = {
    refund: this.txFromJSON<Result<void>>,
        purchase: this.txFromJSON<Result<void>>,
        get_event: this.txFromJSON<Result<Event>>,
        mark_used: this.txFromJSON<Result<void>>,
        get_ticket: this.txFromJSON<Result<Ticket>>,
        initialize: this.txFromJSON<Result<void>>,
        cancel_event: this.txFromJSON<Result<void>>,
        create_event: this.txFromJSON<Result<void>>,
        get_xlm_token: this.txFromJSON<Result<string>>,
        release_funds: this.txFromJSON<Result<void>>,
        get_marketplace: this.txFromJSON<Result<string>>,
        get_escrow_balance: this.txFromJSON<Result<i128>>,
        restricted_transfer: this.txFromJSON<Result<void>>
  }
}