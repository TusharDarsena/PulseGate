# Decisions

This file records choices that still constrain the project. It is not a changelog and does not restate the system design.

- [`architecture.md`](./architecture.md) owns the current architecture, storage models, public flows, and deployment sequence.
- [`AGENTS.md`](../AGENTS.md) owns repository boundaries, working rules, and verification requirements.
- Source code and generated contract bindings own implemented behavior and ABI details.

When a choice changes, revise its existing entry. Add a new decision only when the choice affects security, authority, contract ABI or storage, cross-layer data flow, wallet custody, or deployment.

---

## Contract model

### D-001 — Tickets are custom contract records, not SAC assets

**Decision.** `TicketContract` stores ticket ownership and lifecycle directly. Resale ownership changes are allowed only through its marketplace-gated transfer function.

**Reason.** The project needs ticket-specific states and a restricted resale path; an ordinary Stellar Asset Contract transfer would not enforce those rules without a larger custom asset surface.

**References.** [Architecture: Smart Contracts](./architecture.md#smart-contracts) · [`ticket/src/lib.rs`](../contracts/ticket/src/lib.rs) · [`ticket/src/types.rs`](../contracts/ticket/src/types.rs)

### D-002 — Escrow actions are explicit and refunds are pull-based

**Decision.** Organizers explicitly release escrow after an eligible event. After cancellation, each current ticket owner claims their own refund; the contract never loops over all attendees.

**Reason.** Soroban provides no automatic execution, and unbounded fan-out transactions are unsuitable for contract limits.

**References.** [Architecture: TicketContract](./architecture.md#ticketcontract) · [`ticket/src/lib.rs`](../contracts/ticket/src/lib.rs) · [`ticket/src/escrow.rs`](../contracts/ticket/src/escrow.rs)

### D-003 / D-022 — Ticketing and resale remain separate contracts

**Decision.** `TicketContract` owns events, tickets, and escrow. `MarketplaceContract` owns listings and uses a minimal generated client interface for the one gated ownership-transfer path. The ticket crate is linked into marketplace tests, not the marketplace production WASM.

**Reason.** This keeps authority boundaries explicit and avoids linking two contract implementations into one WASM build.

**Consequence.** Any cross-contract type or function change must keep the interface, generated bindings, adapters, and tests ABI-compatible.

**References.** [Architecture: Smart Contracts](./architecture.md#smart-contracts) · [`marketplace/src/lib.rs`](../contracts/marketplace/src/lib.rs) · [`marketplace/Cargo.toml`](../contracts/marketplace/Cargo.toml)

### D-009 / D-019 / D-020 / D-021 — Listings are unlocked but revalidated on purchase

**Decision.** Listing does not lock a ticket. Listing IDs are namespaced by seller, and `buy_listing` rechecks the on-chain ticket owner, ticket event, event status, and organizer before moving funds or ownership. Seller-supplied `event_id` is informational only.

**Reason.** This avoids lock complexity while preventing ID griefing, stale-owner purchases, cancelled-event purchases, and royalty redirection.

**Consequence.** Stale listings may remain visible in the read model, but the contract must reject them safely.

**References.** [Architecture: MarketplaceContract](./architecture.md#marketplacecontract) · [`marketplace/src/lib.rs`](../contracts/marketplace/src/lib.rs) · [`marketplace/src/storage.rs`](../contracts/marketplace/src/storage.rs)

### D-010 — Royalties use an integer percentage with ceiling division

**Decision.** `royalty_rate = 10` means 10%, calculated as `(price * rate + 99) / 100` with checked arithmetic. Zero-value token transfers are skipped.

**Reason.** Ceiling division prevents small resale prices from rounding a non-zero royalty down to zero.

**References.** [Architecture: MarketplaceContract](./architecture.md#marketplacecontract) · [`marketplace/src/lib.rs`](../contracts/marketplace/src/lib.rs)

### D-012 / D-014 / D-015 — Trusted configuration is stored once and kept alive

**Decision.** Admin and trusted contract configuration live in instance storage; events, tickets, escrow, and listings live in persistent storage. Contract code reads the XLM token and peer-contract addresses from storage rather than accepting them from transaction callers. Storage helpers extend TTL when records are written.

**Reason.** Caller-supplied infrastructure addresses would allow fake-token or authority substitution, while expired configuration could reopen initialization.

**References.** [Architecture: Storage Models](./architecture.md#ticketcontract) · [`ticket/src/storage.rs`](../contracts/ticket/src/storage.rs) · [`marketplace/src/storage.rs`](../contracts/marketplace/src/storage.rs) · [`scripts/deploy.sh`](../scripts/deploy.sh)

### D-016 / D-017 / D-018 — Invalid economic states are rejected at the contract boundary

**Decision.** Contract arithmetic uses checked operations; event capacity, price, and date are validated at creation; state effects are completed before token or cross-contract interactions; ticket outcomes use `Active`, `Used`, and `Refunded` rather than a boolean.

**Reason.** These rules prevent malformed events, ambiguous terminal states, and unsafe interaction ordering. Soroban transaction rollback remains the failure boundary.

**Consequence.** Lifecycle changes require coordinated updates to Rust types, cross-contract mirrors, generated bindings, frontend models, Supabase status values, and UI guards.

**References.** [`ticket/src/lib.rs`](../contracts/ticket/src/lib.rs) · [`ticket/src/types.rs`](../contracts/ticket/src/types.rs) · [`marketplace/src/lib.rs`](../contracts/marketplace/src/lib.rs)

---

## Application and data

### D-004 / D-029 — Soroban is authoritative; Supabase is the read model

**Decision.** Contracts authorize purchases, transfers, refunds, fund release, and venue entry. Supabase provides list discovery, searchable metadata, profiles, and mirrored statuses. A Supabase row is written or updated only after the corresponding contract transaction succeeds.

**Reason.** The contracts expose keyed reads rather than efficient list queries, while ledger-event discovery was too slow for the intended list-view experience.

**Consequence.** Supabase may be delayed or cosmetically wrong; transaction and scanner paths must re-read authoritative on-chain state where correctness matters.

**References.** [Architecture: Data Layer](./architecture.md#data-layer-d-004-d-029-revised) · [`lib/supabase.ts`](../frontend/src/lib/supabase.ts) · [`lib/soroban.ts`](../frontend/src/lib/soroban.ts) · [`supabase_schema.sql`](../supabase_schema.sql)

### D-005 / D-006 / D-027 — QR tickets are signed, short-lived claims

**Decision.** The attendee signs `{wallet_address}:{ticket_id}:{timestamp}` and the QR carries that message plus its Ed25519 signature. The scanner verifies format, signature, and an absolute age below 45 seconds locally, then checks on-chain ownership and `Active` status before consuming the ticket with `mark_used`.

**Reason.** Local cryptographic rejection keeps scanning responsive; the keyed contract read prevents an authentic but stale QR from authorizing entry.

**References.** [Architecture: QR Verification](./architecture.md#qr-verification-d-005-d-006) · [`lib/qr.ts`](../frontend/src/lib/qr.ts) · [`ScannerPage.tsx`](../frontend/src/pages/ScannerPage.tsx)

### D-007 — MVP transactions are assembled, simulated, signed, and submitted client-side

**Decision.** The frontend uses generated `AssembledTransaction` objects and `signAndSend()` through `lib/soroban.ts`. There is no backend XDR builder or shared transaction signer for the MVP.

**Reason.** Each user controls a separate account, so the shared-account sequence contention that would justify a submission queue is absent.

**Revisit when.** A relayer, shared organizer wallet, sponsored transaction service, or queued bulk submission is introduced.

**References.** [Architecture: Transaction Flow](./architecture.md#transaction-flow-d-007-revised) · [`lib/soroban.ts`](../frontend/src/lib/soroban.ts)

### D-008 / D-028 — Human accounts, delegated attendee wallets, and separate organizer wallets

**Decision.** Supabase Auth provides the stable human `user_id` through Google or six-digit email OTP. Each user has one recoverable Dfns delegated Stellar Testnet attendee wallet authorized by the user's passkey. Raw Stellar secrets never enter application storage. Organizers connect Freighter separately; that connection neither replaces nor signs out the attendee account.

**Reason.** Browser-local burner secrets could not restore ticket access on another device and disconnect deleted the only signing capability. Delegated signing preserves a provider-neutral transaction boundary while separating human identity from on-chain addresses.

**Constraint.** Wallet provisioning must register a user-held recovery credential. Restoration failure enters `recovery_required`; it must never create another wallet.

**References.** [Architecture: Wallet Flow](./architecture.md#wallet-flow-d-008-d-028) · [`hooks/useWallet.ts`](../frontend/src/hooks/useWallet.ts) · [`store/useAppStore.ts`](../frontend/src/store/useAppStore.ts) · [`lib/stellar.ts`](../frontend/src/lib/stellar.ts)

### D-013 / D-025 — The client is a URL-routed Vite SPA with narrow global state

**Decision.** The application remains a React/Vite single-page client and uses browser URL routes for durable public and protected destinations. Zustand stores independent attendee-wallet, organizer-wallet, and transaction state; Supabase Auth owns the human session. Server rendering is not part of the MVP architecture.

**Reason.** Durable URLs are required for refresh, Back/Forward, sharing, protected authentication return, and future notifications. The product has no current SSR requirement.

**References.** [Architecture: State Management](./architecture.md#state-management-d-025) · [`App.tsx`](../frontend/src/App.tsx) · [`store/useAppStore.ts`](../frontend/src/store/useAppStore.ts)

---

## Accepted MVP limitations

These are deliberate testnet compromises, not hidden guarantees.

| ID | Accepted limitation | Revisit when |
| --- | --- | --- |
| **D-030** | Cancellation refunds return the event's original mint price, not a later resale price. The contracts do not track a refundable resale premium. | A production resale-refund policy or resale escrow is designed. |
| **D-031** | Escrow release depends on organizer authorization and event time, not proof that the event occurred or attendance reached a threshold. | Mainnet funds or adversarial organizers are in scope. |
| **D-034** | Some Soroban `i128` values are converted to JavaScript `Number` in the frontend adapter. This is safe only within the testnet value range. | Production-scale balances or prices are supported; retain `bigint` end to end. |
| **D-035** | Supabase RLS permits public mirror writes. Forged rows can affect display but cannot authorize contract actions or entry. | The application is publicly deployed; writes must be verified by an indexer or trusted server/Edge Function. |

**References.** [`ticket/src/lib.rs`](../contracts/ticket/src/lib.rs) · [`lib/soroban.ts`](../frontend/src/lib/soroban.ts) · [`supabase_schema.sql`](../supabase_schema.sql)
