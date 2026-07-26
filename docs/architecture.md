# Architecture — NFT Event Ticketing on Stellar
*Binding technical spec. See `decisions.md` for design rationale (D-xxx).*

## Smart Contracts

**TicketContract**: Owns NFT state, enforces ticket logic. Custom NFT implementation (D-001).
**MarketplaceContract**: Handles listings, calls `restricted_transfer`. (D-003)

### TicketContract

**Storage Model**
- **Event** (persistent, keyed by `event_id`): `organizer`, `name`, `date_unix`, `capacity`, `price_per_ticket`, `current_supply`, `status` (Active, Cancelled, Completed)
- **Ticket** (persistent, keyed by `ticket_id`): `owner`, `event_id`, `status` (Active, Used, Refunded)
- **Escrow** (persistent, keyed by `event_id`): `xlm_held`
- **Config** (instance): `marketplace_address`, `xlm_token`
- **TTL Policy** (persistent + instance): Extend TTL on reads/writes for Event and Ticket storage; bump instance storage TTL for Config (D-014, D-015).

**Functions**
- `initialize(admin, marketplace_address, xlm_token)`: Admin is stored in instance storage and used to guard against re-initialization. Sets contract config.
- `create_event(organizer, name, date_unix, capacity, price)`: Validates args (D-017). Writes Event.
- `purchase(event_id, buyer, ticket_id)`: Caller supplies a client-generated `ticket_id` (via `generateID()` in the frontend). Contract checks for collision, Active status, and capacity, and rejects at or after `date_unix` with stable error 23 before any effect. It then mints Ticket (Active), updates state before token transfer (CEI - D-016), and adds to Escrow.
- `release_funds(event_id, organizer)`: Checks date. Marks Completed, clears Escrow, transfers XLM to organizer (CEI).
- `cancel_event(event_id, organizer)`: Marks Cancelled. No auto-refund (D-002).
- `refund(ticket_id, attendee)`: Checks event Cancelled. Marks Ticket Refunded, decrements Escrow, returns XLM (CEI).
- `restricted_transfer(ticket_id, new_owner)`: Marketplace only. Allows transfer only for valid active listings (D-009), then updates owner.
- `mark_used(ticket_id, organizer)`: Sets Ticket Used.
- **Read-only**: `get_ticket`, `get_event`, `get_marketplace`, `get_xlm_token`

### MarketplaceContract

**Storage Model**
- **Listing** (persistent, keyed by `(seller, listing_id)`): `seller`, `ticket_id`, `event_id`, `ask_price`, `status` (Open, Sold, Cancelled). Namespaced to `seller` to prevent ID front-running (D-019).
- **Config** (instance): `ticket_contract_address`, `royalty_rate` (integer percentage, e.g., 10 = 10% - D-010)

**Functions**
- `initialize(admin, ticket_contract_address, royalty_rate)`: Admin stored in instance storage, guards re-initialization. Sets contract config.
- `list_ticket(seller, listing_id, ticket_id, event_id, ask_price)`: Creates Open listing. No on-chain lock (D-009). `event_id` is stored for informational purposes only.
- `buy_listing(seller, listing_id, buyer)`: Fails fast if ticket owner changed (D-020). Derives authoritative `event_id` from on-chain ticket record (D-021). Pulls `ask_price`, calculates ceiling royalty `(price * rate + 99) / 100`, pays organizer and seller, calls TicketContract.`restricted_transfer`, marks Sold.
- `cancel_listing(seller, listing_id)`: Marks Cancelled.

---

## Application Architecture

### Identity and Wallet Flow (D-008, D-028 revised)
- **Human account**: Supabase Auth with Google or six-digit email OTP. `auth.uid()` is the stable person identifier.
- **Attendee**: One Dfns delegated `StellarTestnet` wallet per user. A passkey authorizes signing and a user-held encrypted recovery credential is registered at provisioning. Client-readable wallet data is limited to address, network, and readiness.
- **Organizer**: Freighter remains a separate connection. Connecting or disconnecting it does not change the attendee wallet or human session.
- Provider user IDs, wallet IDs, signing-key IDs, recovery records, action challenges, and audit records are service-role-only.
- Restoration failure sets `recovery_required`; no browser path creates a replacement wallet.

### Transaction Flow (D-007 revised)
`AssembledTransaction.signAndSend()` handles build → simulate → sign → submit in a single client-side call. Fetches a fresh sequence number each time. No backend XDR server for MVP. Never skip simulation.

Primary purchases add a purchase-specific durability boundary without changing
that submission architecture. The server atomically reserves one live
`purchase_operation` and ticket ID for the authenticated user, attendee wallet,
event, network, and TicketContract. Before the Dfns signer returns signed XDR to
`signAndSend()`, an operation-bound wrapper computes the deterministic
transaction hash and records only the hash, sequence, fee, and envelope
expiration. Signed XDR is never persisted.

The authenticated `purchase-operation` Edge Function does not build, sign, or
submit transactions. It resolves interrupted attempts through the configured
RPC and the immutable `(tk_buy, ticket_id)` contract event. The event payload
must contain the operation's server-derived attendee wallet and event ID, and
its transaction must have succeeded. That proof remains valid after the ticket
is used, refunded, or resold. Current ticket ownership or `Active` status is not
a receipt-validity condition.

### Routing and State Management (D-025)
React Router owns durable routes for discovery, event details, checkout, purchase receipts, tickets, account, organizer events, and event-scoped check-in. The root redirects to `/events`; `/auth/callback` handles Google PKCE return. `/purchases/:operationId` is authenticated but deliberately does not require wallet readiness, so a user can read a receipt while recovering delegated signing.

Protected routes store a short-lived same-origin intent with an enumerated action. Invalid, external, or expired destinations are rejected, and consuming an intent never submits a transaction.

**Global Store (Zustand)**: `txState`, `attendeeWallet`, and `organizerWallet` are independent. Signing functions are reconstructed in memory and are not persisted. Supabase Auth owns the human session.

### Data Layer (D-004, D-029 revised)
**Supabase** is used as a searchable read model for event and ticket list queries. `events` contains trusted published rows only. User-editable preparation and interrupted-publication recovery live separately in the private `event_publication_drafts` table.

`purchase_operations` and `purchase_operation_attempts` are private,
owner-readable durability records. Authenticated browser clients cannot mutate
them. The operation also stores the immutable receipt snapshot after trusted
`tk_buy` verification: event identity, start and timezone, venue, purchaser,
amount, charged fee, transaction hash, ledger, close time, network, and
contract. A small browser recovery bridge may store operation, event, ticket,
and transaction IDs only; Supabase remains the durable record.

Before `create_event`, the browser reserves a complete draft with a stable event ID, authenticated user, intended organizer, deployment identity, and expected immutable chain values. The organizer's Soroban creation transaction supplies the binding; there is no separate metadata-signature protocol. The authenticated `event-publication` Edge Function reads `get_event`, verifies network, contract, transaction, organizer, name, start, capacity, and price, then atomically publishes that same draft. Only this trusted service may write published event rows or chain-verification fields.

`discoverable_events` contains complete, verified, Active future events. `published_events` intentionally has no upcoming/lifecycle filter so `/events/:eventId`, ticket views, organizer views, shared links, and calendar actions continue to resolve sold-out, started, cancelled, and completed events.

Discovery sale information is a preview. The centralized direct-event loader combines published metadata with a fresh `get_event` read and rejects deployment or immutable-value mismatches. Event details refresh before opening checkout, and checkout refreshes again before payment; a changed price, supply, status, or time requires explicit reconfirmation.

Phase 1 adds `profiles`, a service-written attendee wallet record, and service-role-only Dfns mapping/challenge/audit tables. `get_my_attendee_wallet()` returns only the current user's address, network, and readiness. The authenticated `/tickets/:ticketId` route does not yet claim authoritative ownership; that enforcement belongs to trusted reconciliation.

Primary purchase no longer calls `lib/readModelSync.ts`, writes a ticket row, or refreshes event supply from the browser. Phase 3 stops at authoritative `chain_confirmed` plus a durable receipt. Trusted, atomic ticket and event-supply reconciliation belongs to Phase 4. Other legacy ticket/listing flows retain their existing mirror behavior until that phase. Mirror delay must never invite a repeated financial action.

Test funding is explicit. The authenticated `test-funding` function derives the
server-mapped attendee wallet, uses Friendbot only for initial account
activation, and verifies the resulting Horizon balance. An activated but
underfunded wallet uses a separately configured, rate-limited demo top-up
account; funding never replaces the attendee wallet.


### QR Verification (D-005, D-006)
1. **Frontend (every 30s)**: Attendee wallet signs `{wallet_address}:{ticket_id}:{timestamp}`. Encodes as QR.
2. **Scanner (at door)**: Decodes QR.
   - Rejects if `|now - timestamp| >= 45s` (30s rotation + 15s clock-drift grace — see D-006).
   - Verifies `ed25519` signature locally (`Keypair.verify()`).
   - Calls `get_ticket(ticket_id)` to ensure `owner == wallet_address` & `status == Active`.
   - Executes `mark_used` on-chain, mirrors `Used`, then displays Green. If only the mirror fails, entry remains valid because the on-chain `Used` state is authoritative, and the scanner displays a synchronization warning.

---

## Deployment Sequence
1. Fund test accounts, including auto-generating the `organizer` CLI identity (D-024).
2. Deploy TicketContract. Get address.
3. Deploy MarketplaceContract. Get address.
4. Call TicketContract.`initialize(admin, marketplace_address, xlm_token)`.
5. Call MarketplaceContract.`initialize(admin, ticket_contract_address, royalty_rate)`.

## Excluded from MVP
- Alternative Web3Auth/MPC attendee-wallet architecture (Dfns delegated signing is selected for Slice 1)
- On-chain event images (use off-chain metadata / Supabase)
- Automated refunds (hits instruction limits — D-002)
- Marketplace locks (D-009)
