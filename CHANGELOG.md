# Changelog

## 2026-07-27

- Phase 4: recoverable owned-ticket synchronization after confirmed purchases,
  owner-checked ticket RPCs, retryable sync warnings, and QR ownership/status
  validation.

This changelog records significant product milestones, architectural changes, security corrections, and verified outcomes. Routine refactors and detailed decision rationale belong in commit history and the relevant sections of `docs/architecture.md`.

## 2026-07-21 — Documentation, schema, and deployment alignment

A repository-wide audit reconciled documentation and setup files with the implemented system. No contract or frontend business logic changed.

### Key changes

* Corrected architecture and README descriptions for client-generated ticket IDs, the 45-second QR validity rule, contract initialization arguments, `mark_used`, and pull-based refunds.
* Documented the actual transaction model: client-side `AssembledTransaction.signAndSend()` with Soroban as the financial authority and Supabase as the discoverable read model.
* Updated contract and repository documentation to reflect the completed marketplace, the correct `wasm32v1-none` build target, real component paths, and current event symbols.
* Expanded the Supabase event schema with display metadata and changed capacity and supply fields to `bigint`.
* Removed the hardcoded Testnet XLM token address from `scripts/deploy.sh`; deployment now requires `XLM_TESTNET_TOKEN` from the environment.
* Recorded accepted MVP limitations, including JavaScript `Number` precision for some `i128` values and permissive Testnet RLS.

---

## 2026-04-28 — Production build hardening

The frontend was hardened after the production build exposed SDK typing and Vite interoperability issues that were not caught by the earlier type-check.

### Key changes

* Fixed Stellar SDK binding exports that broke Vite ESM interoperability and hot reload.
* Corrected transaction signer types to return `{ signedTxXdr }` and aligned Freighter and attendee signing wrappers with the generated contract client.
* Fixed wallet connection dispatch for attendee and organizer flows.
* Corrected Soroban RPC event topic filters to use Base64-encoded XDR values.
* Documented two economic constraints of the MVP:

  * cancelled tickets refund the original mint price, not any resale markup;
  * escrow can be released after the event timestamp without an attendance threshold.

### Verification

* `npm run build` — 115 modules, 0 errors.
* `npm run dev` — development server started successfully.

---

## 2026-04-27 — Frontend and live Soroban integration

A React, Vite, and Tailwind frontend was built and then connected to the deployed Testnet contracts.

### Key changes

* Added the attendee and organizer application flows, shared UI components, transaction feedback, responsive navigation, and centralized Zustand state.
* Replaced the core mock transaction handlers with generated Soroban contract clients for event creation, ticket purchase, and check-in.
* Added Freighter support for organizer actions and a local Testnet attendee burner wallet for transaction and QR signing.
* Standardized client-side transaction submission through `AssembledTransaction.signAndSend()`; no backend XDR builder was introduced.
* Added signed Ed25519 QR payload generation, local signature verification, rotating QR display, and on-chain `mark_used` submission.
* Added event and ticket discovery through RPC event polling, XDR decoding with `scValToNative()`, contract error translation, and XLM/stroop conversions.
* Generated all network and contract configuration from environment files rather than hardcoding frontend addresses.

### Verification

* `npx tsc --noEmit` — 0 errors.

---

## 2026-04-26 — Smart contracts, security hardening, and Testnet deployment

The repository progressed from documentation only to a working Soroban ticketing system with primary sales, escrow, refunds, check-in, and a secondary marketplace.

### Smart contracts

* Created the Rust workspace using `soroban-sdk` 25.3.1.
* Implemented `TicketContract` with:

  * event creation and cancellation;
  * lazy ticket minting during purchase;
  * per-event XLM escrow;
  * pull-based refunds;
  * organizer fund release;
  * organizer-authorized check-in;
  * marketplace-restricted ownership transfer.
* Implemented `MarketplaceContract` with seller-namespaced listings, cancellation, resale purchase, organizer royalties, and cross-contract ticket transfer.

### Security and correctness

* Stored the trusted XLM token and contract addresses in instance storage and extended TTLs to prevent expiry-based reinitialization.
* Applied checks-effects-interactions ordering before token and cross-contract calls.
* Added validation for event capacity, price, date, duplicate IDs, authorization, and ticket lifecycle.
* Replaced the ambiguous `used` flag with `TicketStatus::{Active, Used, Refunded}`.
* Derived resale event and organizer data from authoritative on-chain ticket records instead of seller input.
* Added stale-listing ownership checks, cancelled-event protection, checked arithmetic, and ceiling-rounded royalty calculations.

### Deployment and verification

* Added scripts for Testnet identity funding, contract build, deployment, mutual initialization, and frontend environment generation.
* Deployed both contracts to Stellar Testnet and generated TypeScript bindings.
* Completed live CLI smoke tests for event creation and ticket purchase.
* Ticket contract tests: 6 passed, 0 failed.
* Marketplace contract tests: 17 passed, 0 failed.
* Marketplace WASM release build completed successfully.
