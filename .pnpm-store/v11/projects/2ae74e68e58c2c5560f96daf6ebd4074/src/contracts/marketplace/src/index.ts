import { Buffer } from "buffer";
import { Address } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
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
  Typepoint,
  Duration,
} from '@stellar/stellar-sdk/contract';
// export * from '@stellar/stellar-sdk'  // removed — breaks Vite ESM interop
export * as contract from '@stellar/stellar-sdk/contract'
export * as rpc from '@stellar/stellar-sdk/rpc'

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





/**
 * Mirror of ticket::types::Event — field order must match exactly.
 */
export interface Event {
  capacity: i128;
  current_supply: i128;
  date_unix: u64;
  name: string;
  organizer: string;
  price_per_ticket: i128;
  status: EventStatus;
}


/**
 * Mirror of ticket::types::Ticket — field order must match exactly.
 */
export interface Ticket {
  event_id: string;
  owner: string;
  status: TicketStatus;
}

export type EventStatus = {tag: "Active", values: void} | {tag: "Cancelled", values: void} | {tag: "Completed", values: void};

export type TicketStatus = {tag: "Active", values: void} | {tag: "Used", values: void} | {tag: "Refunded", values: void};

export const ContractError = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"ListingNotFound"},
  4: {message:"ListingNotOpen"},
  5: {message:"ListingAlreadyExists"},
  6: {message:"InvalidPrice"},
  7: {message:"NotListingSeller"},
  8: {message:"BuyerIsSeller"},
  9: {message:"Overflow"},
  10: {message:"Underflow"},
  11: {message:"DivisionByZero"},
  12: {message:"TicketOwnerMismatch"},
  13: {message:"EventCancelled"}
}

/**
 * Storage keys for all data in MarketplaceContract.
 */
export type DataKey = {tag: "Listing", values: readonly [string, string]} | {tag: "TicketContract", values: void} | {tag: "RoyaltyRate", values: void} | {tag: "Admin", values: void};


/**
 * A secondary-market listing record stored on-chain.
 */
export interface Listing {
  ask_price: i128;
  /**
 * Stored for informational / frontend purposes only.
 * buy_listing derives the authoritative event_id from the on-chain
 * ticket record to prevent seller-supplied event_id forgery.
 */
event_id: string;
  seller: string;
  status: ListingStatus;
  ticket_id: string;
}

/**
 * Listing lifecycle.
 */
export type ListingStatus = {tag: "Open", values: void} | {tag: "Sold", values: void} | {tag: "Cancelled", values: void};

export interface Client {
  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the TicketContract address and the royalty rate (integer percentage).
   * Rate is clamped to [0, 100]. Can only be called once.
   * Admin is authenticated to prevent front-running.
   */
  initialize: ({admin, ticket_contract_address, royalty_rate}: {admin: string, ticket_contract_address: string, royalty_rate: i128}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a buy_listing transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Purchase a listing. Pays royalty to the event organizer (derived from
   * the on-chain ticket record — never from the seller-supplied event_id),
   * remainder to seller, then calls restricted_transfer to move the ticket.
   * 
   * CEI order: all reads → compute → state write → token interactions → restricted_transfer.
   */
  buy_listing: ({seller, listing_id, buyer}: {seller: string, listing_id: string, buyer: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_listing transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_listing: ({seller, listing_id}: {seller: string, listing_id: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<Listing>>>

  /**
   * Construct and simulate a list_ticket transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Create a listing. `listing_id` is seller-namespaced in storage so no
   * third party can block a seller's chosen ID by front-running.
   * No on-chain ticket lock — see D-009. Stale listings fail fast in buy_listing.
   */
  list_ticket: ({seller, listing_id, ticket_id, event_id, ask_price}: {seller: string, listing_id: string, ticket_id: string, event_id: string, ask_price: i128}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a cancel_listing transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Cancel an Open listing. Only the original seller can cancel.
   */
  cancel_listing: ({seller, listing_id}: {seller: string, listing_id: string}, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

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
      new ContractSpec([ "AAAAAQAAAEJNaXJyb3Igb2YgdGlja2V0Ojp0eXBlczo6RXZlbnQg4oCUIGZpZWxkIG9yZGVyIG11c3QgbWF0Y2ggZXhhY3RseS4AAAAAAAAAAAAFRXZlbnQAAAAAAAAHAAAAAAAAAAhjYXBhY2l0eQAAAAsAAAAAAAAADmN1cnJlbnRfc3VwcGx5AAAAAAALAAAAAAAAAAlkYXRlX3VuaXgAAAAAAAAGAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAJb3JnYW5pemVyAAAAAAAAEwAAAAAAAAAQcHJpY2VfcGVyX3RpY2tldAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAAtFdmVudFN0YXR1cwA=",
        "AAAAAQAAAENNaXJyb3Igb2YgdGlja2V0Ojp0eXBlczo6VGlja2V0IOKAlCBmaWVsZCBvcmRlciBtdXN0IG1hdGNoIGV4YWN0bHkuAAAAAAAAAAAGVGlja2V0AAAAAAADAAAAAAAAAAhldmVudF9pZAAAABAAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAADFRpY2tldFN0YXR1cw==",
        "AAAAAgAAAAAAAAAAAAAAC0V2ZW50U3RhdHVzAAAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAACUNhbmNlbGxlZAAAAAAAAAAAAAAAAAAACUNvbXBsZXRlZAAAAA==",
        "AAAAAgAAAAAAAAAAAAAADFRpY2tldFN0YXR1cwAAAAMAAAAAAAAAAAAAAAZBY3RpdmUAAAAAAAAAAAAAAAAABFVzZWQAAAAAAAAAAAAAAAhSZWZ1bmRlZA==",
        "AAAAAAAAALBTZXQgdGhlIFRpY2tldENvbnRyYWN0IGFkZHJlc3MgYW5kIHRoZSByb3lhbHR5IHJhdGUgKGludGVnZXIgcGVyY2VudGFnZSkuClJhdGUgaXMgY2xhbXBlZCB0byBbMCwgMTAwXS4gQ2FuIG9ubHkgYmUgY2FsbGVkIG9uY2UuCkFkbWluIGlzIGF1dGhlbnRpY2F0ZWQgdG8gcHJldmVudCBmcm9udC1ydW5uaW5nLgAAAAppbml0aWFsaXplAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAF3RpY2tldF9jb250cmFjdF9hZGRyZXNzAAAAABMAAAAAAAAADHJveWFsdHlfcmF0ZQAAAAsAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAThQdXJjaGFzZSBhIGxpc3RpbmcuIFBheXMgcm95YWx0eSB0byB0aGUgZXZlbnQgb3JnYW5pemVyIChkZXJpdmVkIGZyb20KdGhlIG9uLWNoYWluIHRpY2tldCByZWNvcmQg4oCUIG5ldmVyIGZyb20gdGhlIHNlbGxlci1zdXBwbGllZCBldmVudF9pZCksCnJlbWFpbmRlciB0byBzZWxsZXIsIHRoZW4gY2FsbHMgcmVzdHJpY3RlZF90cmFuc2ZlciB0byBtb3ZlIHRoZSB0aWNrZXQuCgpDRUkgb3JkZXI6IGFsbCByZWFkcyDihpIgY29tcHV0ZSDihpIgc3RhdGUgd3JpdGUg4oaSIHRva2VuIGludGVyYWN0aW9ucyDihpIgcmVzdHJpY3RlZF90cmFuc2Zlci4AAAALYnV5X2xpc3RpbmcAAAAAAwAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAApsaXN0aW5nX2lkAAAAAAAQAAAAAAAAAAVidXllcgAAAAAAABMAAAABAAAD6QAAAAIAAAfQAAAADUNvbnRyYWN0RXJyb3IAAAA=",
        "AAAAAAAAAAAAAAALZ2V0X2xpc3RpbmcAAAAAAgAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAApsaXN0aW5nX2lkAAAAAAAQAAAAAQAAA+kAAAfQAAAAB0xpc3RpbmcAAAAH0AAAAA1Db250cmFjdEVycm9yAAAA",
        "AAAAAAAAANFDcmVhdGUgYSBsaXN0aW5nLiBgbGlzdGluZ19pZGAgaXMgc2VsbGVyLW5hbWVzcGFjZWQgaW4gc3RvcmFnZSBzbyBubwp0aGlyZCBwYXJ0eSBjYW4gYmxvY2sgYSBzZWxsZXIncyBjaG9zZW4gSUQgYnkgZnJvbnQtcnVubmluZy4KTm8gb24tY2hhaW4gdGlja2V0IGxvY2sg4oCUIHNlZSBELTAwOS4gU3RhbGUgbGlzdGluZ3MgZmFpbCBmYXN0IGluIGJ1eV9saXN0aW5nLgAAAAAAAAtsaXN0X3RpY2tldAAAAAAFAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAACmxpc3RpbmdfaWQAAAAAABAAAAAAAAAACXRpY2tldF9pZAAAAAAAABAAAAAAAAAACGV2ZW50X2lkAAAAEAAAAAAAAAAJYXNrX3ByaWNlAAAAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAAAAAAADxDYW5jZWwgYW4gT3BlbiBsaXN0aW5nLiBPbmx5IHRoZSBvcmlnaW5hbCBzZWxsZXIgY2FuIGNhbmNlbC4AAAAOY2FuY2VsX2xpc3RpbmcAAAAAAAIAAAAAAAAABnNlbGxlcgAAAAAAEwAAAAAAAAAKbGlzdGluZ19pZAAAAAAAEAAAAAEAAAPpAAAAAgAAB9AAAAANQ29udHJhY3RFcnJvcgAAAA==",
        "AAAABAAAAAAAAAAAAAAADUNvbnRyYWN0RXJyb3IAAAAAAAANAAAAAAAAABJBbHJlYWR5SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAACAAAAAAAAAA9MaXN0aW5nTm90Rm91bmQAAAAAAwAAAAAAAAAOTGlzdGluZ05vdE9wZW4AAAAAAAQAAAAAAAAAFExpc3RpbmdBbHJlYWR5RXhpc3RzAAAABQAAAAAAAAAMSW52YWxpZFByaWNlAAAABgAAAAAAAAAQTm90TGlzdGluZ1NlbGxlcgAAAAcAAAAAAAAADUJ1eWVySXNTZWxsZXIAAAAAAAAIAAAAAAAAAAhPdmVyZmxvdwAAAAkAAAAAAAAACVVuZGVyZmxvdwAAAAAAAAoAAAAAAAAADkRpdmlzaW9uQnlaZXJvAAAAAAALAAAAAAAAABNUaWNrZXRPd25lck1pc21hdGNoAAAAAAwAAAAAAAAADkV2ZW50Q2FuY2VsbGVkAAAAAAAN",
        "AAAAAgAAADFTdG9yYWdlIGtleXMgZm9yIGFsbCBkYXRhIGluIE1hcmtldHBsYWNlQ29udHJhY3QuAAAAAAAAAAAAAAdEYXRhS2V5AAAAAAQAAAABAAAAn0xpc3RpbmcgcmVjb3JkLCBrZXllZCBieSAoc2VsbGVyLCBsaXN0aW5nX2lkKS4KTmFtZXNwYWNlZCB0byBzZWxsZXIgc28gbm8gdGhpcmQgcGFydHkgY2FuIGJsb2NrIGEgc2VsbGVyJ3MgY2hvc2VuIElECmJ5IGZyb250LXJ1bm5pbmcgd2l0aCB0aGUgc2FtZSBsaXN0aW5nX2lkLgAAAAAHTGlzdGluZwAAAAACAAAAEwAAABAAAAAAAAAASFRpY2tldENvbnRyYWN0IGFkZHJlc3Mg4oCUIHNldCBvbmNlIGF0IGluaXRpYWxpemUsIHN0b3JlZCBpbiBpbnN0YW5jZSgpLgAAAA5UaWNrZXRDb250cmFjdAAAAAAAAAAAAHVSb3lhbHR5IHJhdGUgYXMgaW50ZWdlciBwZXJjZW50YWdlIFswLCAxMDBdIOKAlCBzZXQgb25jZSBhdCBpbml0aWFsaXplLApzdG9yZWQgaW4gaW5zdGFuY2UoKS4gU2VlIGRlY2lzaW9ucy5tZCBELTAxMC4AAAAAAAALUm95YWx0eVJhdGUAAAAAAAAAAFNBZG1pbiBhZGRyZXNzIOKAlCBzZXQgb25jZSBhdCBpbml0aWFsaXplLCBjYW4gcmUtaW5pdGlhbGl6ZSBhZnRlciBjb250cmFjdCB1cGdyYWRlLgAAAAAFQWRtaW4AAAA=",
        "AAAAAQAAADJBIHNlY29uZGFyeS1tYXJrZXQgbGlzdGluZyByZWNvcmQgc3RvcmVkIG9uLWNoYWluLgAAAAAAAAAAAAdMaXN0aW5nAAAAAAUAAAAAAAAACWFza19wcmljZQAAAAAAAAsAAACuU3RvcmVkIGZvciBpbmZvcm1hdGlvbmFsIC8gZnJvbnRlbmQgcHVycG9zZXMgb25seS4KYnV5X2xpc3RpbmcgZGVyaXZlcyB0aGUgYXV0aG9yaXRhdGl2ZSBldmVudF9pZCBmcm9tIHRoZSBvbi1jaGFpbgp0aWNrZXQgcmVjb3JkIHRvIHByZXZlbnQgc2VsbGVyLXN1cHBsaWVkIGV2ZW50X2lkIGZvcmdlcnkuAAAAAAAIZXZlbnRfaWQAAAAQAAAAAAAAAAZzZWxsZXIAAAAAABMAAAAAAAAABnN0YXR1cwAAAAAH0AAAAA1MaXN0aW5nU3RhdHVzAAAAAAAAAAAAAAl0aWNrZXRfaWQAAAAAAAAQ",
        "AAAAAgAAAE1FdmVudCBzdGF0dXMg4oCUIG1pcnJvcnMgdGlja2V0Ojp0eXBlczo6RXZlbnRTdGF0dXMgZm9yIGNyb3NzLWNvbnRyYWN0IGNhbGxzLgAAAAAAAAAAAAALRXZlbnRTdGF0dXMAAAAAAwAAAAAAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAAAAAAAJQ2FuY2VsbGVkAAAAAAAAAAAAAAAAAAAJQ29tcGxldGVkAAAA",
        "AAAAAgAAABJMaXN0aW5nIGxpZmVjeWNsZS4AAAAAAAAAAAANTGlzdGluZ1N0YXR1cwAAAAAAAAMAAAAAAAAAAAAAAARPcGVuAAAAAAAAAAAAAAAEU29sZAAAAAAAAAAAAAAACUNhbmNlbGxlZAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    initialize: this.txFromJSON<Result<void>>,
        buy_listing: this.txFromJSON<Result<void>>,
        get_listing: this.txFromJSON<Result<Listing>>,
        list_ticket: this.txFromJSON<Result<void>>,
        cancel_listing: this.txFromJSON<Result<void>>
  }
}