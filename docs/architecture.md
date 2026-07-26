# StellarTickets architecture and decisions

This is the single source of truth for the intended system architecture and
the significant decisions that constrain it. It describes current behavior,
security boundaries, public contract surfaces, and accepted MVP limitations.

Repository rules and verification requirements live in [`AGENTS.md`](../AGENTS.md).
The historical project map and change-coupling tables live in
[`agent-handbook.md`](./agent-handbook.md). Source code, schema, and generated
bindings remain authoritative for implemented behavior and ABI details.

When this document and the implementation disagree, reconcile them in the
same change. Revise an existing decision when its choice changes; add a new
decision only when the change affects security, authority, contract ABI or
storage, cross-layer data flow, wallet custody, or deployment.

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
  `date_unix`, `capacity`, `price_per_ticket`, `current_supply`, and status
  (`Active`, `Cancelled`, `Completed`).
- **Persistent, keyed by `ticket_id`:** `Ticket` with `owner`, `event_id`, and
  status (`Active`, `Used`, `Refunded`). `Used` and `Refunded` are distinct
  terminal states (D-018).
- **Persistent, keyed by `event_id`:** escrow with `xlm_held`.

Trusted configuration is stored once in instance storage, not accepted from
callers (D-012). Persistent and instance TTLs are extended on every write path
(D-014, D-015). See
[`contracts/ticket/src/storage.rs`](../contracts/ticket/src/storage.rs).

#### Public functions

- `initialize(admin, marketplace_address, xlm_token)` stores configuration and
  prevents re-initialization.
- `create_event(organizer, event_id, name, date_unix, capacity,
  price_per_ticket)` rejects an existing event ID and validates capacity, price,
  and date before writing the event (D-017).
- `purchase(event_id, buyer, ticket_id)` requires a client-generated unique
  ticket ID, rejects collisions, inactive or full events, and rejects
  purchases at or after the event time with stable error 23. It mints an
  `Active` ticket, updates state before the token transfer, and adds to escrow
  using checked arithmetic and checks-effects-interactions ordering (D-016).
- `release_funds(event_id, organizer)` checks the event time, marks the event
  `Completed`, clears escrow, and transfers XLM to the organizer.
- `cancel_event(event_id, organizer)` marks the event `Cancelled`; it does not
  auto-refund attendees.
- `refund(ticket_id, attendee)` is a pull-based refund available after
  cancellation (D-002). Pull-based refunds avoid an unbounded loop over
  attendees.
- `restricted_transfer(ticket_id, new_owner)` authenticates the stored
  Marketplace contract and transfers only an `Active` ticket. It does not read
  or validate a listing; `MarketplaceContract.buy_listing()` validates the
  listing, seller, current owner, ticket event, event status, and organizer
  before calling this entrypoint.
- `mark_used(ticket_id, organizer)` marks an eligible ticket `Used` after QR
  verification.
- Read-only functions: `get_ticket`, `get_event`, `get_marketplace`, and
  `get_xlm_token`.

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

- `initialize(admin, ticket_contract_address, royalty_rate)` stores trusted
  configuration and prevents re-initialization.
- `list_ticket(seller, listing_id, ticket_id, event_id, ask_price)` creates an
  `Open` listing. Tickets are not locked on-chain; the supplied `event_id` is
  informational only (D-009).
- `buy_listing(seller, listing_id, buyer)` rechecks the current on-chain owner,
  ticket event, event status, and organizer before moving funds or ownership.
  It derives the authoritative event ID from the ticket record, pays the
  organizer and seller, calls `restricted_transfer`, and marks the listing
  `Sold` (D-020/D-021).
- `cancel_listing(seller, listing_id)` marks a listing `Cancelled`.

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

### Identity and wallets (D-008/D-028)

- Supabase Auth provides the stable human identity through Google or six-digit
  email OTP; `auth.uid()` is the person identifier.
- Each user has one Dfns delegated `StellarTestnet` attendee wallet. A passkey
  authorizes signing, and a user-held encrypted recovery credential is
  registered during provisioning.
- The browser may read only attendee address, network, and readiness. Provider
  user IDs, wallet IDs, signing-key IDs, recovery records, challenges, and audit
  records are service-role-only.
- Freighter is a separate organizer connection. It never replaces the
  attendee wallet or human session.
- Restoration failure becomes `recovery_required`; no browser flow creates a
  replacement wallet. Raw wallet secrets never enter browser storage,
  Zustand, Supabase, logs, or application code.

Relevant ownership code is in [`frontend/src/hooks/useWallet.ts`](../frontend/src/hooks/useWallet.ts),
[`frontend/src/store/useAppStore.ts`](../frontend/src/store/useAppStore.ts), and
[`frontend/src/lib/stellar.ts`](../frontend/src/lib/stellar.ts).

### Transactions and primary purchase (D-007, D-036)

The MVP uses generated `AssembledTransaction` objects and
`signAndSend()` for build → simulate → sign → submit. A fresh sequence is
fetched for each transaction; simulation is never skipped. There is no backend
XDR builder or shared transaction signer.

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

Primary purchase ends at durable `chain_confirmed` plus a receipt in Phase 3.
Trusted ticket and event-supply reconciliation belongs to Phase 4. The browser
does not write a ticket row or refresh event supply as proof of purchase.
See [`frontend/src/lib/purchaseOperations.ts`](../frontend/src/lib/purchaseOperations.ts)
and [`supabase/functions/purchase-operation/index.ts`](../supabase/functions/purchase-operation/index.ts).

### Routing and state (D-013/D-025)

The React/Vite SPA uses durable React Router routes for discovery, event
details, checkout, purchase receipts, tickets, account, organizer events, and
event-scoped check-in. `/` redirects to `/events`; `/auth/callback` handles
Google PKCE; `/purchases/:operationId` is authenticated but does not require
wallet readiness, allowing receipt recovery during wallet restoration.

Protected routes store only a short-lived same-origin intent with an enumerated
action. Invalid, external, or expired destinations are rejected, and consuming
an intent never submits a transaction. Zustand keeps `txState`,
`attendeeWallet`, and `organizerWallet` independent; signing functions are
reconstructed in memory and are not persisted.

### Data layer (D-004/D-029)

Supabase is a read model for searchable discovery and mirrored metadata. It
must never authorize chain actions. Published event rows are trusted; editable
preparation and interrupted-publication recovery use the private
`event_publication_drafts` table.

Private `purchase_operations` and `purchase_operation_attempts` are owner-
readable durability records and are not browser-mutable. Trusted verification
stores the immutable receipt snapshot: event identity, start and timezone,
venue, purchaser, amount, charged fee, transaction hash, ledger, close time,
network, and contract.

Before `create_event`, the browser reserves a complete draft with stable event
ID, authenticated user, intended organizer, deployment identity, and expected
immutable chain values. The organizer's creation transaction supplies the
binding. The authenticated `event-publication` function reads `get_event`,
verifies network, contract, organizer, name, start, capacity, and price, then
atomically publishes the same draft. Only this trusted service writes published
event rows or chain-verification fields.

`discoverable_events` contains complete, verified, active future events.
`published_events` intentionally has no upcoming/lifecycle filter so direct
links, ticket views, organizer views, and calendar actions resolve sold-out,
started, cancelled, and completed events. Discovery sale information is only a
preview: direct event loading and checkout re-read the chain and require
explicit reconfirmation after price, supply, status, or time changes.

The authenticated ticket route does not yet claim authoritative ownership;
trusted reconciliation owns that enforcement. Test funding uses the mapped
attendee wallet, Friendbot only for initial activation, and a separate
rate-limited demo top-up account for activated but underfunded wallets.

### QR entry (D-005/D-006/D-027)

Every 30 seconds the attendee signs
`{wallet_address}:{ticket_id}:{timestamp}` and encodes the message and Ed25519
signature as a QR payload. The organizer scanner:

1. Validates the payload format and rejects `|now - timestamp| >= 45s`.
2. Verifies the signature locally with the wallet address.
3. Reads `get_ticket(ticket_id)` and requires matching owner and `Active` status.
4. Submits organizer-signed `mark_used()` on-chain.
5. Mirrors `Used` only after the chain call succeeds, then displays entry as
   valid. A mirror failure produces a synchronization warning; it does not
   invalidate successful on-chain entry.

Local validation is necessary for responsive scanning, but only the
authoritative on-chain owner/status check and successful `mark_used()` call
authorize entry. See [`frontend/src/lib/qr.ts`](../frontend/src/lib/qr.ts) and
[`frontend/src/pages/ScannerPage.tsx`](../frontend/src/pages/ScannerPage.tsx).

## Deployment sequence

1. Fund test accounts, including auto-generating the organizer CLI identity.
2. Deploy `TicketContract` and record its address.
3. Deploy `MarketplaceContract` and record its address.
4. Initialize `TicketContract` with admin, marketplace address, and XLM token.
5. Initialize `MarketplaceContract` with admin, ticket address, and royalty
   rate.

Contract IDs, network values, generated bindings, and both contracts' stored
peer addresses must remain synchronized. The deployment script is
[`scripts/deploy.sh`](../scripts/deploy.sh).

## Accepted MVP limitations

These are deliberate testnet compromises, not hidden guarantees:

| ID | Limitation | Revisit when |
| --- | --- | --- |
| D-030 | Cancellation refunds return the original mint price, not a later resale price. | A production resale-refund policy or resale escrow is designed. |
| D-031 | Escrow release depends on organizer authorization and event time, not proof the event occurred or attendance reached a threshold. | Mainnet funds or adversarial organizers are in scope. |
| D-034 | Some Soroban `i128` values become JavaScript `Number` values in the frontend adapter. | Production-scale balances or prices require end-to-end `bigint`. |
| D-035 | Supabase RLS permits public mirror writes; forged rows can affect display but never authorize chain actions or entry. | Public deployment requires indexer- or trusted-service-verified writes. |

The following remain outside the MVP: alternative attendee-wallet custody
architectures, on-chain event images, automated refunds, and marketplace ticket
locks. Off-chain event metadata is used instead.

## Change checklist

When changing a boundary, update every affected layer in one change:

- Contract ABI, types, errors, or lifecycle: Rust tests, cross-contract
  mirrors, generated bindings, adapter/error mapping, callers, and this
  document.
- Supabase schema: migration/schema, RLS, adapter types/helpers, hooks, writes,
  and row mapping.
- Wallet, QR, or route behavior: all producers/consumers, hydration and
  protection gates, navigation, refresh/direct-link behavior, and this
  document.

For the focused coupling matrix and verification timing, see
[`agent-handbook.md`](./agent-handbook.md#7-change-coupling-matrix).
