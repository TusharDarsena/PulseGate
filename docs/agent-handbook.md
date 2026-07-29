# AGENTS.md

Project intelligence for **PulseGate**. Read this before editing the repository.

This file defines where behavior lives, which boundaries are security-critical, and which downstream files must change together. It is not a generic coding guide and does not replace reading the code being modified.

---

## 1. System model

PulseGate is a Stellar testnet ticketing application with five layers:

1. **TicketContract (Soroban/Rust)** — authoritative event, ticket, escrow, refund, cancellation, and check-in state.
2. **MarketplaceContract (Soroban/Rust)** — authoritative resale listing state, royalty payout, and the only permitted resale transfer path.
3. **Generated TypeScript bindings** — ABI bridge from deployed contracts to the frontend.
4. **React/Vite frontend** — wallet connection, transaction orchestration, QR flows, navigation, and UI state.
5. **Supabase** — searchable read model for events, tickets, listings, profiles, and cached price data.

> **Soroban owns truth. Supabase makes that truth discoverable.**

Supabase can decide what appears in a list. It must never authorize a purchase, transfer, refund, fund release, or venue entry.

---

## 2. How project documentation is used

- **Code and tests** show current behavior.
- **`docs/architecture.md`** defines intended boundaries, storage models, public contract surface, wallet flow, QR flow, deployment sequence, rationale, and accepted limitations.
- **`AGENTS.md`** defines navigation, invariants, coupling, and completion rules.

If code and `architecture.md` disagree, do not silently choose one. Reconcile them in the same change.

Update the relevant decision section in `architecture.md` only when introducing or reversing a significant architectural choice. Do not add entries for routine refactors, bug fixes, formatting, or implementation details.

---

## 3. Critical end-to-end flows

### Event creation

`CreateEventPage` → `lib/soroban.ts#createEvent()` → TicketContract `create_event()` → Supabase event metadata upsert.

The chain owns organizer, status, supply, capacity, date, and price. Supabase adds display metadata such as image, description, venue, city, and category.

### Primary purchase

`PurchasePage` allocates a durable purchase operation and stable ticket ID, prepares the generated TicketContract transaction, and binds the delegated-wallet signing request to a server-issued attempt ID. The signed transaction hash is recorded before submission. TicketContract then validates event/capacity, creates the ticket, increments supply, updates escrow, and transfers XLM.

The purchase-operation service resolves uncertain results from the configured RPC and accepts success only after verifying the expected `tk_buy` event for the operation's ticket, buyer, and event. It stores an immutable receipt snapshot at `/purchases/:operationId`, then reads current Soroban ticket/event state and atomically finalizes the owner-derived ticket projection. A `sync_warning` is retryable and never submits another financial transaction.

### QR check-in

QR format:

`{wallet_address}:{ticket_id}:{timestamp}:{base64Signature}`

The scanner must:

1. verify payload shape, absolute age `< 45s`, and Ed25519 signature locally;
2. read the ticket on-chain and verify owner plus `Active` status;
3. call `mark_used()` with the organizer signer;
4. mirror `Used` only after on-chain success.

A Supabase ticket row alone never permits entry.

### Cancellation, refund, and release

- Cancellation marks the event `Cancelled`; there is no attendee loop.
- Each attendee individually calls `refund()`.
- Refund eligibility and amount come from on-chain state.
- `release_funds()` clears escrow and marks the event `Completed` before transferring XLM.
- Supabase status updates happen only after the corresponding contract call succeeds.

### Secondary market

A listing is created on-chain, then mirrored for discovery. `buy_listing()` must continue to:

- load by `(seller, listing_id)`;
- reject closed listings and self-purchases;
- fail before transfers if the seller no longer owns the ticket;
- derive the authoritative event and royalty recipient from the on-chain ticket/event records;
- reject cancelled events;
- mark the listing sold before token/cross-contract interactions;
- pay organizer royalty and seller proceeds;
- call TicketContract `restricted_transfer()`;
- mirror both the sold listing and new owner after success.

---

## 4. Repository ownership

### Contracts

| Path | Responsibility |
| --- | --- |
| `contracts/Cargo.toml` | Workspace configuration and the single Soroban SDK version pin. |
| `contracts/ticket/src/lib.rs` | TicketContract public entrypoints **and business-flow orchestration**. Uses storage/escrow/event helpers and token client. |
| `contracts/ticket/src/types.rs` | `#[contracttype]` storage keys, Event, Ticket, and lifecycle enums. Serialized compatibility boundary. |
| `contracts/ticket/src/storage.rs` | All raw TicketContract storage access and TTL extension. |
| `contracts/ticket/src/escrow.rs` | Checked per-event escrow accounting only. No auth or token transfers. |
| `contracts/ticket/src/events.rs` | All TicketContract event publication. |
| `contracts/ticket/src/error.rs` | Stable TicketContract error codes consumed by generated bindings and frontend error mapping. |
| `contracts/marketplace/src/lib.rs` | Listing, buy, cancel, royalty, token-transfer, and cross-contract orchestration. |
| `contracts/marketplace/src/ticket_interface.rs` | Minimal `#[contractclient]` TicketContract interface plus XDR-compatible mirrored types. |
| `contracts/marketplace/src/types.rs` | Listing storage key, record, and lifecycle enum. |
| `contracts/marketplace/src/storage.rs` | Marketplace raw storage access and TTL extension. |
| `contracts/marketplace/src/events.rs` | Marketplace event publication. |
| `contracts/marketplace/src/error.rs` | Stable marketplace error codes consumed by frontend error mapping. |
| Contract `test.rs` files | Auth, state, token-balance, lifecycle, error, rollback, and cross-contract behavior. Use reusable fixtures. |

Important corrections to the old AGENTS file:

- Contract `lib.rs` files are not interface-only; they contain the actual transaction workflows.
- `storage.rs` owns raw storage, but `lib.rs` legitimately coordinates business logic.
- Marketplace production code uses a minimal generated client interface; the `ticket` crate is only a test dependency.

### Frontend integration

| Path | Responsibility |
| --- | --- |
| `frontend/src/contracts/ticket/` | Generated TicketContract TypeScript binding. Do not hand-edit. |
| `frontend/src/contracts/marketplace/` | Generated MarketplaceContract TypeScript binding. Do not hand-edit. |
| `frontend/src/lib/constants.ts` | Contract IDs, network passphrase, RPC URL, and Supabase environment values. |
| `frontend/src/lib/soroban.ts` | Only handwritten module importing generated bindings. Client creation, all contract wrappers, keyed reads, and error translation. |
| `frontend/src/lib/stellar.ts` | Public Horizon balance reads only. Attendee provisioning and signing use the delegated-wallet boundary. |
| `frontend/src/lib/purchaseOperations.ts` | Authenticated purchase-operation, attempt-binding, recovery, and explicit test-funding client. |
| `frontend/src/lib/ticketOperations.ts` | Authenticated refund/resale operation allocation, signed-hash persistence, resolution, and mirror-only recovery. |
| `frontend/src/lib/safeStorage.ts` | Fail-soft browser-storage reads, writes, and removal used only for navigation intent and purchase-operation recovery. |
| `frontend/src/lib/qr.ts` | QR payload building and local signature verification. No network calls. |
| `frontend/src/lib/supabase.ts` | Supabase client, row types, shared queries, and metadata upserts. Read-model adapter only. |
| `frontend/src/hooks/useWallet.ts` | Organizer Freighter connection and verified restoration only. Persisted state is an untrusted address hint; signer capability is reconstructed only after live Freighter verification. |
| `frontend/src/hooks/useOrganizerUnsavedWorkGuard.tsx` | Shared organizer SPA and beforeunload protection with the supported React Router blocker. |
| `frontend/src/store/useAppStore.ts` | Independent attendee-wallet, organizer-wallet, global transaction state, hydration gate, and organizer signer reconstruction. |
| `frontend/src/hooks/useEvents.ts` | Event read-model polling, mapping, race suppression, and invalidation. |
| `frontend/src/hooks/useTickets.ts` | Current-wallet ticket polling, mapping, race suppression, and invalidation. |
| `frontend/src/hooks/useListings.ts` | Open-listing polling, joined event display data, race suppression, and invalidation. |
| `frontend/src/types/index.ts` | App-facing models, separate attendee/organizer wallet types, transaction types, and conversion helpers. |
| `frontend/src/App.tsx` | Durable React Router route tree, protected-route gates, and page orchestration. |
| `frontend/src/pages/PurchaseReceiptPage.tsx` | Durable operation receipt and unresolved-transaction recovery route. |
| Pages | User-flow orchestration: adapters, transaction state, post-chain synchronization, and hook invalidation. |
| Components | Presentation and callbacks. UI primitives must not gain contract, wallet, or Supabase knowledge. |

Existing SDK boundaries are intentional:

- generated contract bindings are imported only by `lib/soroban.ts`;
- QR crypto stays in `lib/qr.ts`;
- public Horizon reads stay in `lib/stellar.ts`;
- delegated attendee signing stays in `lib/dfns.ts` plus the authenticated Edge Function;
- Freighter connection/signing stays in `useWallet.ts` and organizer signer rehydration in `useAppStore.ts`.

Do not introduce new SDK imports across pages/components to bypass these adapters.

### Data and deployment

| Path | Responsibility |
| --- | --- |
| `supabase_schema.sql` | Phase 0/1 bootstrap read-model tables; later ordered migrations progressively harden the legacy policies. |
| `supabase/migrations/202607270001_phase_3_purchase_operations.sql` | Private purchase operations, attempts, funding requests, idempotent allocators, and owner-read/service-write RLS. |
| `supabase/migrations/202607270002_phase_4_recoverable_owned_ticket.sql` | Owner-derived ticket RPCs, service-only verified finalization, provenance, and synchronization RLS. |
| `supabase/migrations/202607290002_phase_5_ticket_operations.sql` | Private refund/resale operations, seller-namespaced listing identity, service-only economic projection writes, and atomic reconciliation. |
| `supabase/migrations/202607290003_part_3_organizer_editor_correctness.sql` | One-time organizer binding for prepared drafts and revision-safe organizer metadata updates. |
| `supabase/migrations/202607290004_part_6_listing_truth_and_ticket_visibility.sql` | Batch open-listing reads and owner-derived ticket rows that tolerate missing event projections. |
| `supabase/functions/purchase-operation/` | Trusted operation allocation and transaction/event resolution. It never builds, signs, or submits XDR. |
| `supabase/functions/ticket-operation/` | Trusted refund and marketplace operation resolution. It verifies exact configured-contract proof and never builds, signs, or submits XDR. |
| `supabase/functions/test-funding/` | Explicit testnet activation and rate-limited demo-account top-ups. |
| `scripts/fund.sh` | Creates/funds expected Stellar testnet CLI identities. |
| `scripts/deploy.sh` | Builds, deploys Ticket then Marketplace, initializes both mutually, and writes frontend contract/network env values. |
| `scripts/deploy.ps1` | Windows deployment path using `C:\tmp\stellar.exe` with `C:\Users\asus\.config\stellar`; can also update linked Supabase Stellar secrets. |

Deploying or replacing only one contract without updating the other contract’s stored address breaks resale transfers.

---

## 5. Contract invariants

### Authorization

- Call `require_auth()` for every externally supplied actor that authorizes an action.
- Organizer-only actions also compare against the organizer stored on-chain.
- `restricted_transfer()` authenticates the stored MarketplaceContract address; it is not an owner-callable transfer function.
- Do not use obsolete `soroban-auth`, `Signature`, or `Identifier` APIs.

### Storage and serialization

- Raw `env.storage()` access stays in `storage.rs`.
- Event, Ticket, Escrow, and Listing records use persistent storage.
- Admin and trusted contract/token addresses use instance storage.
- Preserve TTL extension on every write path.
- Struct field order, enum variants, and storage keys are ABI/on-chain compatibility concerns.
- A storage-shape change requires migration analysis; do not treat it as a harmless model refactor.

### Money and arithmetic

- On-chain XLM values are stroops (`i128`).
- Use checked arithmetic for economic and supply operations.
- Preserve royalty ceiling division: `(ask_price * royalty_rate + 99) / 100`.
- Skip zero-value SAC transfers.
- Purchase, refund, and release must read the trusted XLM SAC address from contract storage, never from the caller.

### Lifecycles and interaction order

- Ticket: `Active → Used` or `Active → Refunded`.
- Event: `Active → Cancelled` or `Active → Completed`.
- Listing: `Open → Sold` or `Open → Cancelled`.
- Preserve checks/effects/interactions ordering around token and cross-contract calls.
- Do not add bulk auto-refunds.
- Do not add an ad hoc listing lock; stale listings are rejected during purchase.

### IDs and authority

- Event, ticket, and listing IDs are client-generated and collision-checked on-chain.
- Listing storage remains keyed by `(seller, listing_id)`.
- Listing `event_id` is informational. Royalty routing derives the event from the on-chain ticket.
- Supabase ownership/status/organizer/listing fields never authorize contract actions.

---

## 6. Frontend and synchronization invariants

### Transactions

- Use generated `AssembledTransaction` objects and `signAndSend()`.
- Keep simulation enabled; do not bypass the generated transaction lifecycle.
- No backend XDR builder/submission service exists for this MVP.
- Pages call `lib/soroban.ts`; they do not instantiate contract clients or import generated bindings.

### Wallets and hydration

- Human identity: Supabase Auth.
- Organizer wallet: Freighter, held separately from the human account.
- Attendee wallet: one recoverable Dfns delegated Stellar Testnet wallet per user.
- Freighter private keys are never available to the app.
- Raw attendee wallet secrets must never enter browser storage, Zustand, Supabase rows, logs, or application code.
- Attendee and organizer signing functions are not persisted.
- Attendee restoration follows Supabase auth-state changes. A restoration result
  is accepted only when its request ID and user ID are still current;
  authoritative sign-out immediately invalidates pending work and clears the
  attendee wallet.
- `walletRestoring` blocks only attendee-wallet routes. Authenticated receipt,
  ticket-list, account, and organizer routes do not wait for it.
- Restoration failure must enter `recovery_required`; never silently create another wallet.
- Human sign-out and organizer-wallet disconnect are separate actions.
- An organizer address stored locally is only a hint. Freighter connection and
  address must be verified before restoring a signer or balance, and the signer
  rechecks the current address immediately before signing.

### On-chain first, mirror second

For each state-changing flow:

1. validate local prerequisites;
2. submit and confirm the Soroban transaction;
3. update the matching Supabase rows through the flow's trusted synchronization boundary;
4. invalidate every affected hook;
5. report the correct result to the user.

Never pre-write Supabase for optimistic authorization. A failed chain call must not leave a successful-looking read-model row.

A mirror failure after chain success is a synchronization failure, not a failed blockchain transaction. Do not retry the financial transaction blindly.

Primary purchases use the private purchase-operation service. Refunds and
secondary-market actions use the private ticket-operation service. Neither path
lets the browser mutate ticket or listing projections. A signed operation with
unknown status must be resolved, while `sync_warning` retries only trusted
reconciliation.

### Polling and models

- `useEvents`, `useTickets`, and `useListings` poll every 30 seconds; this is polling, not a cache TTL. Ticket and listing hooks are route-scoped to My Tickets and Marketplace, respectively.
- Never fetch inside a render body.
- Clear intervals and ignore superseded responses.
- My Tickets uses one batch open-listing read for its displayed ticket IDs and
  disables resale actions until that result is ready. A missing event projection
  must not hide an owned ticket.
- Convert generated `bigint`/tagged-union values at adapter boundaries, not in UI components.
- Keep status values aligned across Rust enums, generated bindings, app types, Supabase rows, and UI conditions.
- The current `i128 → Number` conversion is an accepted testnet limitation; changing it requires an end-to-end `bigint` migration.

### QR

- `lib/qr.ts`, `QRDisplayPage`, and `ScannerPage` must agree on payload order and expiry.
- Signature verification is local; ownership/status verification is on-chain.
- The QR page rechecks authoritative owner and `Active` status before every
  initial, focus, manual, and 30-second signing attempt; a failed check clears
  the QR. The scanner verifies Freighter and event authority before camera
  start, allocation, and resume, and pauses on an invalid visible gate.
- Do not replace the absolute 45-second age check with `floor(unix / 30)` windowing.

### Navigation

Adding or renaming a route usually requires coordinated changes in:

- `App.tsx` route definitions and protection;
- validated auth-intent route patterns;
- `AppHeader` and `BottomNav`;
- hosting SPA fallback behavior;
- direct-link, refresh, and Back/Forward tests.

Organizer editors use the shared unsaved-work guard. Preserve its supported
React Router blocker and `beforeunload` behavior rather than adding custom
history or `popstate` code. Ordinary draft saves must omit organizer binding;
only an unbound prepared draft may deliberately bind its verified Freighter
wallet, and a bound draft is never reassigned.

---

## 7. Change-coupling matrix

| Change | Required follow-through |
| --- | --- |
| Contract function signature/return | Rust tests, generated binding, `lib/soroban.ts`, callers, `architecture.md` |
| Rust `#[contracttype]` struct/enum | `ticket_interface.rs` mirror if cross-contract, generated binding, app conversion, storage migration analysis, Supabase mirror if relevant |
| Contract error variant/code | Generated binding and matching error map in `lib/soroban.ts`; do not casually renumber deployed codes |
| Contract event topic/payload | Tests and any indexing/event-consumer assumptions |
| Ticket/event lifecycle | Contract guards/tests, scanner/refund/release UI, Supabase status mapping, architecture |
| Marketplace buy logic | Ownership/cancellation guards, royalty math, token balances, cross-contract tests, listing/owner mirrors |
| Supabase table/column/RPC | Schema, RLS, `lib/supabase.ts` types/helpers, hooks, page writes, row mapping |
| Transaction wrapper | Every caller, error translation, tx overlay behavior, mirror writes, invalidations |
| Wallet/signing flow | `AuthProvider.tsx`, `lib/dfns.ts`, attendee-wallet Edge Function, store separation, QR signing eligibility |
| QR format/expiry | `lib/qr.ts`, QR display, scanner, architecture |
| Durable route | `App.tsx`, validated auth-intent patterns, header, bottom nav, SPA fallback, direct-link tests |
| Environment value | `constants.ts`, deploy/env generation, example env/documentation |
| Contract ABI/deployment | Regenerate bindings; ensure both stored contract addresses and frontend env match |

Generated bindings are downstream artifacts. Never patch them to hide a Rust/frontend mismatch.

---

## 8. Accepted MVP constraints

Do not silently redesign these during an unrelated fix:

- attendee signing is delegated to Dfns; provider identifiers, recovery records, and audit data remain server-only;
- Supabase RLS is permissive and fake rows can be cosmetically harmful;
- list discovery uses 30-second Supabase polling, not on-chain enumeration;
- listings do not lock tickets;
- cancellation refunds return the original mint price, not resale markup;
- escrow release depends on event time, not attendance threshold;
- some `i128` values are downcast to JavaScript `Number`.

A task may intentionally replace one of these. That is an architectural change: update every affected layer and revise the relevant architecture and rationale in `architecture.md`.

---

## 9. Verification

### Verification timing

- During implementation, do not repeatedly run full test suites, production
  builds, dependency reinstalls, or other expensive verification commands.
- Use focused source inspection and the smallest relevant check while coding.
- Defer time-consuming contract suites, full frontend builds, and broad
  verification until the requested phase or task implementation is complete,
  unless a focused run is necessary to unblock the code change.
- When the user explicitly asks to postpone tests, make implementation changes
  first and run no test suite until the user requests the final verification.

### Contract changes

From `contracts/`:

```bash
cargo fmt --check
cargo test
cargo build --target wasm32v1-none --release
```

On Windows, `cargo test` is a native host build and needs the MSVC linker in the
active shell. The deployable WASM build can use
`cargo +stable-x86_64-pc-windows-gnu build --target wasm32v1-none --release`,
which is what the Windows deploy script does, but that is not a replacement for
the full native test suite.

Tests must cover applicable auth failures, state transitions, token balances, duplicate IDs, stable errors, rollback-sensitive paths, TTL-preserving writes, and cross-contract compatibility.

Use a reusable fixture/setup struct. Do not repeat environment, address, token, auth, deployment, and initialization boilerplate in every test.

### ABI changes

- Regenerate affected TypeScript bindings; never hand-edit them.
- Build the binding packages.
- Build/type-check the frontend.
- Fix mismatches at the Rust/interface boundary rather than hiding them with casts.

### Frontend changes

Run the repository’s frontend lint/type-check/build scripts, at minimum the production build. Exercise the affected role and refresh path:

- organizer/Freighter;
- attendee/Dfns passkey signing and recovery on another browser;
- store hydration after reload;
- transaction overlay success/error;
- Supabase mirror plus immediate invalidation;
- mobile and desktop navigation when views change.

### QR changes

Test valid, expired, future-skewed, malformed, wrong-key, wrong-owner, used, and refunded payloads. A locally valid signature with invalid on-chain state must fail.

### Schema changes

Verify clean setup and upgrade behavior, joins, bigint handling, RPC names, row mappings, and the exact RLS behavior used by the frontend.

---

## 10. Completion rule

A change is complete only when:

- the authoritative on-chain behavior is correct;
- downstream bindings, wrappers, models, and mirrors are synchronized;
- generated files were regenerated rather than hand-edited;
- tests cover the corrected behavior;
- no flow trusts Supabase for authorization;
- affected hooks are invalidated after successful writes;
- `architecture.md` reflects changed boundaries, storage, public functions, lifecycles, QR/wallet flows, or deployment sequence;
- `architecture.md` changes when the architectural boundary or its rationale changes.
