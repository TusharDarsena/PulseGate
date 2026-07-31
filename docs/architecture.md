# PulseGate architecture and decisions

This is the single source of truth for the intended system architecture and
the significant decisions that constrain it. It describes current behavior,
security boundaries, public contract surfaces, and accepted MVP limitations.

- Repository rules and verification requirements live in [`AGENTS.md`](../AGENTS.md).
- The historical project map and change-coupling tables live in [`agent-handbook.md`](./agent-handbook.md).
- Source code, schema, and generated bindings remain authoritative for implemented behavior and ABI details.

When this document and the implementation disagree, reconcile them in the
same change. Revise an existing decision when its choice changes. Add a new
decision only when the change affects security, authority, contract ABI or
storage, cross-layer data flow, wallet custody, or deployment.

## Contents

- System model
- Contract architecture
  - TicketContract
  - MarketplaceContract
  - Contract invariants
- Application architecture
  - Identity and wallets
  - Routing and state
  - Transaction submission and purchase flow
  - Data layer
  - QR entry
- Deployment sequence
- Accepted MVP limitations
- Decision index
- Change checklist

## System model

Soroban owns truth. Supabase is a searchable read model. Supabase must never
authorize a purchase, transfer, refund, fund release, or venue entry.

For every state-changing flow:

1. Confirm the successful chain transaction.
2. Update the mirror.
3. Invalidate affected reads.

The two authoritative contracts are `TicketContract` and
`MarketplaceContract`. The frontend uses generated bindings through the
handwritten adapter in [`frontend/src/lib/soroban.ts`](../frontend/src/lib/soroban.ts);
pages and components do not instantiate contract clients directly.

## Contract architecture

### TicketContract

`TicketContract` owns events, ticket ownership and lifecycle, and purchase
escrow. Tickets are custom contract records rather than SAC assets (D-001):
the project needs ticket-specific states and a marketplace-gated resale path.
See [`contracts/ticket/src/lib.rs`](../contracts/ticket/src/lib.rs) and
[`contracts/ticket/src/types.rs`](../contracts/ticket/src/types.rs).

#### Storage

- **Instance:** admin, `marketplace_address`, and `xlm_token` configuration.
- **Persistent, keyed by `event_id`:** `Event` with `organizer`, `name`,
  authoritative start (`date_unix`) and end (`end_unix`), `capacity`,
  `price_per_ticket`, `current_supply`, and status (`Active`, `Cancelled`,
  `Completed`).
- **Persistent, keyed by `ticket_id`:** `Ticket` with `owner`, `event_id`, and
  status (`Active`, `Used`, `Refunded`). `Used` and `Refunded` are distinct
  terminal states (D-018).
- **Persistent, keyed by `event_id`:** escrow with `xlm_held`.

Trusted configuration is stored once in instance storage, not accepted from
callers (D-012). Persistent and instance TTLs are extended on every write path
(D-014, D-015). See
[`contracts/ticket/src/storage.rs`](../contracts/ticket/src/storage.rs).

#### Public functions

- **`initialize(admin, marketplace_address, xlm_token)`** — stores
  configuration and prevents re-initialization.
- **`create_event(organizer, event_id, name, date_unix, end_unix, capacity, price_per_ticket)`**
  — rejects an existing event ID and validates capacity, price, a future
  start, and an end strictly after the start before writing the event
  (D-017).
- **`purchase(event_id, buyer, ticket_id)`** — requires a client-generated
  unique ticket ID, rejects collisions, inactive or full events, and rejects
  purchases at or after the event time with stable error 23. It mints an
  `Active` ticket, updates state before the token transfer, and adds to
  escrow using checked arithmetic and checks-effects-interactions ordering
  (D-016).
- **`release_funds(event_id, organizer)`** — requires an `Active` event at or
  after its end, marks it `Completed`, clears escrow, and transfers XLM to
  the organizer. Zero-sale events also complete and emit `ev_rel` with amount
  zero.
- **`cancel_event(event_id, organizer)`** — requires an `Active` event and
  marks it `Cancelled`; it does not auto-refund attendees.
- **`refund(ticket_id, attendee)`** — a pull-based refund available after
  cancellation (D-002). Pull-based refunds avoid an unbounded loop over
  attendees.
- **`restricted_transfer(ticket_id, new_owner)`** — authenticates the stored
  Marketplace contract and transfers only an `Active` ticket. It does not
  read or validate a listing; `MarketplaceContract.buy_listing()` validates
  the listing, seller, current owner, ticket event, event status, and
  organizer before calling this entrypoint.
- **`mark_used(event_id, ticket_id, expected_owner, organizer)`** — marks an
  eligible ticket `Used` after QR verification, but only when the supplied
  event matches the ticket, the current owner matches the QR owner, the
  event is `Active`, and the ledger timestamp is in the fixed check-in
  window: start minus two hours inclusive through event end exclusive.
- **Read-only functions:** `get_ticket`, `get_event`, `get_marketplace`, and
  `get_xlm_token`, plus the existing-event-keyed `get_escrow_balance`.

### MarketplaceContract

`MarketplaceContract` owns listings and calls the ticket contract's minimal
gated transfer interface. The contracts remain separate in production; the
ticket crate is linked into marketplace tests only (D-003/D-022). This keeps
authority boundaries explicit and avoids linking both contract implementations
into one WASM. See [`contracts/marketplace/src/lib.rs`](../contracts/marketplace/src/lib.rs).

#### Storage

- **Instance:** admin, `ticket_contract_address`, and `royalty_rate`.
- **Persistent, keyed by `(seller, listing_id)`:** `Listing` with `seller`,
  `ticket_id`, `event_id`, `ask_price`, and status (`Open`, `Sold`,
  `Cancelled`). Seller namespacing prevents listing-ID front-running (D-019).

`royalty_rate` is an integer percentage: `10` means 10%. Royalties use checked
ceiling division, `(price * rate + 99) / 100`; zero-value transfers are
skipped (D-010).

#### Public functions

- **`initialize(admin, ticket_contract_address, royalty_rate)`** — stores
  trusted configuration and prevents re-initialization.
- **`list_ticket(seller, listing_id, ticket_id, event_id, ask_price)`** —
  creates an `Open` listing. Tickets are not locked on-chain; the supplied
  `event_id` is informational only (D-009).
- **`buy_listing(seller, listing_id, buyer)`** — rechecks the current
  on-chain owner, ticket event, `Active` event status, and organizer before
  moving funds or ownership. It derives the authoritative event ID from the
  ticket record, pays the organizer and seller, calls `restricted_transfer`,
  and marks the listing `Sold` (D-020/D-021).
- **`cancel_listing(seller, listing_id)`** — marks a listing `Cancelled`.

Unlocked listings can become stale in Supabase, but stale-owner, cancelled-
event, and royalty-redirection attempts must fail safely at the contract
boundary.

### Contract invariants

- Authorization is enforced by the contracts, not by Supabase or UI state.
- Economic arithmetic is checked; malformed capacity, price, and dates are
  rejected at creation.
- State effects complete before token or cross-contract interactions.
- Contract-held token and peer addresses come from trusted stored
  configuration.
- Contract, ABI, lifecycle, or error changes require coordinated updates to
  Rust types/tests, cross-contract mirrors, generated bindings, frontend
  models, Supabase status values, and UI guards. Never hand-edit generated
  bindings.

## Application architecture

This layer is organized around the attendee/organizer journey: who is
signed in and holding a wallet, which routes they can reach, how their
actions reach the chain, how the results are mirrored into Supabase, and
how a ticket is redeemed at the door.

### Identity and wallets (D-008/D-028)

- Supabase Auth provides the stable human identity through Google or
  six-digit email OTP; `auth.uid()` is the person identifier.
- Each user has one Dfns delegated `StellarTestnet` attendee wallet. A
  passkey authorizes signing, and a user-held encrypted recovery credential
  is registered during provisioning.
- The browser may read only attendee address, network, and readiness.
  Provider user IDs, wallet IDs, signing-key IDs, recovery records,
  challenges, and audit records are service-role-only.
- Freighter is a separate organizer connection. It never replaces the
  attendee wallet or human session.
- Attendee restoration is driven by Supabase auth-state changes. The captured
  session is passed into restoration, and a monotonically increasing request
  ID plus user-ID comparison discards stale results. `walletRestoring` is
  separate from authentication readiness: only attendee-wallet routes wait
  for it, while receipts, tickets, account, and organizer routes remain
  usable for their own owner-scoped reads.
- Authoritative sign-out invalidates outstanding attendee restoration and
  clears attendee state immediately. Small auth-intent and purchase-operation
  browser-storage conveniences are fail-soft; storage denial must not break
  authentication, signing, transaction resolution, or recovery cleanup.
- Restoration failure becomes `recovery_required`; no browser flow creates a
  replacement wallet. Raw wallet secrets never enter browser storage,
  Zustand, Supabase, logs, or application code.
- A cancelled or interrupted initial passkey prompt remains retryable. The
  wallet service reconciles the provider EndUser using the service-only
  mapping, archives it only when Dfns confirms it is still unregistered, and
  then starts a fresh registration. Any registered provider identity or
  wallet/key record enters `recovery_required`; it is never locally deleted
  to make room for a replacement.
- The wallet service account needs Dfns `Auth:Users:Read` and
  `Auth:Users:Delete` permissions for that reconciliation, in addition to its
  existing registration and wallet permissions.
- The persisted organizer-wallet value is only an untrusted address hint.
  Rehydration begins disconnected and installs an address, balance, and signer
  only after Freighter confirms both connection and the same current address.
  The signer repeats that address check immediately before each signature.
- Recovery challenges are application-bound, expire after five minutes, are
  consumed before Dfns recovery is attempted, and are protected by an atomic
  per-user rate limit (five initiations or ten completions per fifteen-minute
  window). Recovery responses are marked `no-store`.
- Test funding uses the mapped attendee wallet, Friendbot only for initial
  activation, and a separate rate-limited demo top-up account for activated
  but underfunded wallets.

Relevant ownership code is in [`frontend/src/hooks/useWallet.ts`](../frontend/src/hooks/useWallet.ts),
[`frontend/src/store/useAppStore.ts`](../frontend/src/store/useAppStore.ts), and
[`frontend/src/lib/stellar.ts`](../frontend/src/lib/stellar.ts).

### Routing and state (D-013/D-025)

The React/Vite SPA uses durable React Router routes for discovery, event
details, checkout, purchase receipts, tickets, account, organizer events,
event drafts, event management, and event-scoped check-in. `/` redirects to
`/events`; `/auth/callback` handles Google PKCE; purchase receipts, organizer
drafts, and organizer management routes are authenticated but do not require
wallet readiness merely to restore their owner-scoped records.

Protected routes store only a short-lived same-origin intent with an enumerated
action. Invalid, external, or expired destinations are rejected, and consuming
an intent never submits a transaction. Zustand keeps `txState`,
`attendeeWallet`, and `organizerWallet` independent; signing functions are
reconstructed in memory and are not persisted.

The router uses a minimal data-router host (`createBrowserRouter` and
`RouterProvider`) around the existing declarative route tree so organizer
editing can use React Router's supported navigation blocker. The shared
organizer guard blocks SPA navigation, Back/Forward, refresh, and tab close
when work is unsaved, failed, offline, conflicted, or superseded by newer local
edits. Its single dialog offers only **Stay** or **Discard and leave**; it does
not implement custom `popstate` handling.

### Transaction submission and purchase flow (D-007, D-036)

#### Submission mechanics

The MVP uses generated `AssembledTransaction` objects and
`signAndSend()` for build → simulate → sign → submit. A fresh sequence is
fetched for each transaction; simulation is never skipped. There is no backend
XDR builder or shared transaction signer.

#### Purchase durability

Primary checkout adds durability without changing that client-side submission
boundary:

1. The server atomically reserves one live `purchase_operation` and ticket ID
   for the authenticated user, attendee wallet, event, network, and contract.
2. An operation-bound signer computes the deterministic transaction hash and
   records only hash, sequence, fee, and envelope expiration before submission.
   Signed XDR is never persisted.
3. The trusted purchase service resolves interruptions through configured RPC
   and the immutable successful `(tk_buy, ticket_id)` contract event.
4. The event must contain the server-derived attendee wallet and event ID.
   That proof remains valid after later use, refund, or resale; current owner
   and current `Active` status are not receipt-validity conditions.

Primary purchase continues from durable `chain_confirmed` into a trusted
`mirror_syncing`/`complete` ticket projection in Phase 4. The service reads
current Soroban state and atomically finalizes ticket provenance and event
supply; `sync_warning` is retryable and never submits another payment.
See [`frontend/src/lib/purchaseOperations.ts`](../frontend/src/lib/purchaseOperations.ts)
and [`supabase/functions/purchase-operation/index.ts`](../supabase/functions/purchase-operation/index.ts).

### Data layer (D-004/D-029)

Supabase is a read model for searchable discovery and mirrored metadata. It
must never authorize chain actions. The subsections below cover, in order:
the private tables behind event publication and purchase records, the
publication and cancellation/completion flows that write to them, what the
public-facing tables expose, ticket access for the signed-in owner, and
finally the check-in table that leads into the QR entry flow described next.

#### Event publication drafts

Published event rows are trusted; editable preparation, human ownership, and
interrupted-publication recovery use the private `event_publication_drafts`
table. Multiple incomplete drafts are allowed. Atomic expected-revision saves
preserve newer work when two tabs edit the same draft, and published draft
rows remain as the owner-derived link to organizer event management.

Ordinary draft-content saves omit `intended_organizer_address`. A prepared
draft with no organizer exposes an explicit one-time bind action, which first
verifies the connected Freighter wallet; a database guard prevents reassignment
after binding. Both the draft editor and organizer metadata editor retain a
local edit revision while saving. They always accept the returned server
revision, but overwrite visible fields and mark saved only when no edit occurred
since submission; otherwise local fields remain unsaved against that newer
server revision.

#### Purchase-operation privacy

Private `purchase_operations` and `purchase_operation_attempts` are retrievable
by their owner only through the purchase-operation service and are not directly
browser-readable or browser-mutable. Trusted verification stores the immutable
receipt snapshot: event identity, start and timezone, venue, purchaser,
amount, charged fee, transaction hash, ledger, close time, network, and
contract.

#### Refund and resale operation flow

Refunds and secondary-market changes use the private `ticket_operations`
lifecycle. The browser still assembles and simulates generated contract
transactions, while the authenticated service derives the attendee wallet,
records the signed transaction hash before submission, and resolves only exact
`tk_refund`, `mk_list`, `mk_cancel`, or `mk_sold` proof from the configured
contracts. Current TicketContract and MarketplaceContract reads are reconciled
atomically into `tickets` and `listings`; a newer observed ledger cannot be
overwritten by delayed repair. Listings use the same `(seller, listing_id)`
identity as MarketplaceContract.

`status_unknown` never enables a replacement transaction. `sync_warning`
permits only mirror synchronization, so a confirmed refund, listing change, or
resale is never repeated because Supabase was unavailable. Browser insert and
update authority over the economic projections is revoked.

#### Event publication flow

Before `create_event`, the browser completes a draft with stable event ID,
authenticated user, intended organizer, deployment identity, and expected
immutable chain values. The organizer's creation transaction supplies the
binding. Its signed transaction hash is persisted before the generated client
can submit. The authenticated `event-publication` function requires matching
`ev_create` proof and reads `get_event` to verify network, contract, organizer,
name, start, end, capacity, and price before atomically publishing the same
draft. Only this trusted service writes published event rows or
chain-verification fields.

#### Cancellation and completion flow

Cancellation and completion use one private
`organizer_event_operations` owner with a cross-type event lock. The browser
still assembles, signs, and submits through the generated contract client; the
service stores the signed hash first, resolves only matching `ev_cancel` or
`ev_rel` proof, and mirrors confirmed state afterward. Unknown submission and
mirror-sync states remain recoverable, and mirror-only retry never resubmits a
terminal transaction.

#### Event visibility

`discoverable_events` contains complete, verified, active future events.
`published_events` intentionally has no upcoming/lifecycle filter so direct
links, ticket views, organizer views, and calendar actions resolve sold-out,
started, cancelled, and completed events. Discovery sale information is only a
preview: direct event loading and checkout re-read the chain and require
explicit reconfirmation after price, supply, status, or time changes.

#### Ticket access

The authenticated ticket route is owner-checked by `get_my_ticket()`, with a
single current-chain fallback requiring the restored attendee wallet.
`get_my_tickets()` left-joins event projections, so a ticket remains visible
when its event projection is absent. Such tickets are shown in a distinct
fallback group ordered by purchase time then ticket ID, with their ID, status,
purchase date, ticket route, and receipt route when available.

My Tickets resolves resale state with one owner-scoped
`fetchOpenListingsByTicketIds(ticketIds)` request rather than one lookup per
ticket. Listing and cancellation controls fail closed until that batch reaches
`ready`: mapped tickets offer cancellation, confirmed absences can be listed,
and an error exposes one resale-status retry. Refund and resale mutations stay
on the trusted ticket-operation adapter.

#### Check-in flow

Venue check-in uses a separate private `check_in_operations` owner keyed by
network, TicketContract, and ticket ID. It does not use the event-level terminal
operation lock, so unrelated door scans are not serialized. The browser
prepares and signs the generated `mark_used` transaction, but the signed hash is
persisted before submission and a possibly submitted operation can only be
resolved or synchronized. A trusted finalizer verifies the exact `tk_used`
transaction source, ticket ID, expected event, expected owner, current `Used`
ticket state, and event organizer before updating the ticket mirror. The
runtime scan that produces this submission is described next, in QR entry.

### QR entry (D-005/D-006/D-027)

The QR page reads authoritative ticket ownership and `Active` status before
every initial, manual, focus, or 30-second signing attempt. It then signs
`{wallet_address}:{ticket_id}:{timestamp}` and encodes the message and Ed25519
signature as a QR payload. A failed validation or signing attempt clears the
displayed QR; development screenshot data does not bypass this lifecycle. The
organizer scanner:

1. Validates the payload format and rejects `|now - timestamp| >= 45s`.
2. Verifies the signature locally with the wallet address.
3. Reads `get_ticket(ticket_id)` and requires matching event, owner, and
   `Active` status.
4. Submits organizer-signed `mark_used(event_id, ticket_id, owner, organizer)`
   on-chain through the recoverable check-in operation described above.
5. Mirrors `Used` only after the chain call succeeds, then displays entry as
   valid. A mirror failure produces a synchronization warning; it does not
   invalidate successful on-chain entry.

Before camera activation, operation allocation, and scan resume, the scanner
rechecks the authoritative event, active check-in window, exact organizer
wallet, and live Freighter signer. It keeps the current gate and processing
handler in refs behind one stable html5-qrcode callback, and pauses the camera
whenever the visible authorization gate becomes invalid. Disconnect or account
mismatch clears event-sensitive scanning authority; there is no global wallet
polling layer.

Local validation is necessary for responsive scanning, but only the
authoritative on-chain owner/status check and successful `mark_used()` call
authorize entry. See [`frontend/src/lib/qr.ts`](../frontend/src/lib/qr.ts) and
[`frontend/src/pages/ScannerPage.tsx`](../frontend/src/pages/ScannerPage.tsx).
Door statistics count only verified check-in operations in chain-success states;
legacy mirror rows with `tickets.status = Used` and no check-in proof are not
trusted attendance counts.

### Route-scoped reads and refresh behavior

`MyTicketsRoute` owns `useTickets()` and `MarketplaceRoute` owns
`useListings()`. They poll only while their routes are mounted; the scanner no
longer maintains an invisible ticket subscription. Resale activity refreshes
the mounted marketplace listing read, while visiting My Tickets starts a fresh
owner-scoped ticket read and its purchase-sync recovery. Event, listing, and
ticket hooks retain request-ID race protection and their 30-second polling
cadence.

Browse free-text search and city input are debounced by roughly 300 ms. Category
and date filters remain immediate. Public event loading starts the Supabase
preview and Soroban read concurrently, but returns no public event when the
published row is absent and discards that chain result; identity mismatches and
unavailable authority remain explicit states.

## Deployment sequence

1. Fund test accounts, including auto-generating the organizer CLI identity.
2. Build both WASM artifacts and regenerate both TypeScript binding packages
   from those exact artifacts.
3. Deploy `TicketContract` and record its address.
4. Deploy `MarketplaceContract` and record its address.
5. Initialize `TicketContract` with admin, marketplace address, and XLM
   token.
6. Initialize `MarketplaceContract` with admin, ticket address, and royalty
   rate.
7. Update the frontend and Supabase deployment configuration together. Trusted
   services require both `TICKET_CONTRACT_ID` and
   `MARKETPLACE_CONTRACT_ID`; `scripts/deploy.ps1 -SetSupabaseSecrets` writes
   both alongside the network and RPC values. Then deploy the compatible
   services before enabling organizer writes.

Contract IDs, network values, generated bindings, and both contracts' stored
peer addresses must remain synchronized. The deployment script is
[`scripts/deploy.sh`](../scripts/deploy.sh) on Unix-like shells and
[`scripts/deploy.ps1`](../scripts/deploy.ps1) on this Windows workspace.
Because `mark_used` is part of the public TicketContract ABI, check-in
changes require regenerated bindings and a coordinated Ticket/Marketplace
deployment or upgrade so Marketplace stores the compatible Ticket address.

## Accepted MVP limitations

These are deliberate testnet compromises, not hidden guarantees:

| ID | Limitation | Revisit when |
| --- | --- | --- |
| D-030 | Cancellation refunds return the original mint price, not a later resale price. | A production resale-refund policy or resale escrow is designed. |
| D-031 | Escrow release depends on organizer authorization and event time, not proof the event occurred or attendance reached a threshold. | Mainnet funds or adversarial organizers are in scope. |
| D-034 | Some Soroban `i128` values become JavaScript `Number` values in the frontend adapter. | Production-scale balances or prices require end-to-end `bigint`. |

The following remain outside the MVP: alternative attendee-wallet custody
architectures, on-chain event images, automated refunds, and marketplace
ticket locks. Off-chain event metadata is used instead.

## Decision index

Every decision ID cited in this document is listed here once, for quick
lookup, alongside the section where it's explained in full.

| ID | Decision | Explained in |
| --- | --- | --- |
| D-001 | Tickets are custom contract records rather than SAC assets, to support ticket-specific states and a marketplace-gated resale path. | TicketContract |
| D-002 | Refunds are pull-based (attendee-initiated after cancellation), avoiding an unbounded loop over attendees. | TicketContract |
| D-003 / D-022 | `TicketContract` and `MarketplaceContract` stay separate contracts in production; the ticket crate is linked into marketplace tests only, keeping authority boundaries explicit. | MarketplaceContract |
| D-004 / D-029 | Supabase is a read-only mirror for discovery and metadata; it must never authorize chain actions. | Data layer |
| D-005 / D-006 / D-027 | QR check-in payloads are short-lived and validated locally for responsive scanning, but only a successful on-chain `mark_used()` call authorizes entry. | QR entry |
| D-007 / D-036 | Transactions are built and signed client-side with no backend signer; purchase adds a durable operation-reservation and mirror-sync pattern on top of that same submission boundary. | Transaction submission and purchase flow |
| D-008 / D-028 | Identity comes from Supabase Auth; each user gets one Dfns-delegated attendee wallet, kept separate from the organizer's own Freighter connection. | Identity and wallets |
| D-009 | Marketplace listings don't lock the ticket on-chain, and a listing's stored `event_id` is informational only, not authoritative. | MarketplaceContract |
| D-010 | Marketplace royalties use checked ceiling division; zero-value royalty transfers are skipped. | MarketplaceContract |
| D-012 | Trusted contract configuration is stored once in instance storage and is never accepted from callers. | TicketContract |
| D-013 / D-025 | Protected routes carry only a short-lived, same-origin navigation intent; wallet and transaction state in Zustand are kept independent and are never persisted. | Routing and state |
| D-014 / D-015 | Persistent and instance storage TTLs are extended on every write path. | TicketContract |
| D-016 | Purchases follow checks-effects-interactions ordering: ticket state updates before the token transfer, with checked escrow arithmetic. | TicketContract |
| D-017 | Event creation validates capacity, price, a future start, and an end strictly after the start before the event is written. | TicketContract |
| D-018 | `Used` and `Refunded` are distinct terminal ticket states. | TicketContract |
| D-019 | Listings are keyed by `(seller, listing_id)`, so seller namespacing prevents listing-ID front-running. | MarketplaceContract |
| D-020 / D-021 | `buy_listing()` rechecks the current on-chain owner, ticket event, event status, and organizer before moving funds or ownership, rather than trusting the stored listing. | MarketplaceContract |
| D-030 | Cancellation refunds return the original mint price, not a later resale price. | Accepted MVP limitations |
| D-031 | Escrow release depends on organizer authorization and event time, not proof the event occurred or that attendance reached a threshold. | Accepted MVP limitations |
| D-034 | Some Soroban `i128` values become JavaScript `Number` values in the frontend adapter. | Accepted MVP limitations |
| D-035 | Economic ticket and listing projections are service-written only after exact transaction/event proof and current authoritative reads; mirror-only retry never repeats the chain action. | Refund and resale operation flow |

## Change checklist

When changing a boundary, update every affected layer in one change:

- Contract ABI, types, errors, or lifecycle: Rust tests, cross-contract
  mirrors, generated bindings, adapter/error mapping, callers, and this
  document.
- Supabase schema: migration/schema, RLS, adapter types/helpers, hooks,
  writes, and row mapping.
- Wallet, QR, or route behavior: all producers/consumers, hydration and
  protection gates, navigation, refresh/direct-link behavior, and this
  document.

For the focused coupling matrix and verification timing, see
[`agent-handbook.md`](./agent-handbook.md#7-change-coupling-matrix).
