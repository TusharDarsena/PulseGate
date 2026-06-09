# Slice 1 Decision Register

## Purpose

This file records the architectural choices for **Product Slice 1: Confident First Purchase**. The choices below are selected, not open questions.

The product behavior in [`slice-1-product-spec.md`](./slice-1-product-spec.md) remains controlling. Soroban is authoritative for event sale conditions, payment, ticket creation, ownership, and ticket state. Supabase, wallet-provider records, purchase-operation records, and receipts support discovery and recovery; none of them prove ticket ownership.

A **proof gate** validates that a selected integration works with the existing Stellar flow. It does not reopen the product decision unless the selected provider is technically incapable of meeting it.

## Decision summary

| ID | Locked decision | Remaining gate |
| --- | --- | --- |
| **DR-01** | Supabase human account + recoverable delegated Stellar attendee wallet | Cross-device purchase and QR signing proof |
| **DR-02** | Public Vite SPA with durable URL routes and protected return | Auth callback and refresh proof |
| **DR-03** | One durable purchase operation per payment attempt | Idempotency and unknown-status proof |
| **DR-04** | Chain-verified trusted reconciliation and restrictive RLS | Forgery, retry, and atomic repair proof |
| **DR-05** | Contract-enforced sales cutoff and fresh paired testnet deployment | Contract boundary and deployment smoke tests |
| **DR-06** | Explicit, rate-limited testnet activation through Friendbot | New, funded, delayed, and failed account proof |
| **DR-07** | Complete event metadata and publish-readiness contract | Timezone and calendar fixtures |

---

## DR-01 — Human identity and attendee signing

**Decision.** Use **Supabase Auth** for Google sign-in and email OTP/magic-link sign-in. `auth.uid()` is the stable `user_id` used by profiles, wallet links, purchase operations, receipts, and RLS.

Provision one **Dfns delegated wallet on Stellar Testnet** for each user. The wallet is controlled by the end user through a passkey. The raw Stellar secret must never enter local storage, Zustand state, profile rows, logs, or application code. Store only the Dfns user/wallet identifiers, public Stellar address, lifecycle status, and ownership mapping.

The attendee wallet and organizer wallet are separate:

- the delegated wallet owns tickets and signs purchases and QR claims;
- Freighter authorizes organizer actions;
- connecting or disconnecting Freighter does not replace or sign out the attendee account;
- signing out ends the human and wallet-provider sessions but does not destroy the wallet;
- a returning user must recover the recorded wallet address or enter `wallet_recovery_required`; the app must never silently create a second wallet.

**Why.** The current burner secret is browser-local, deleted on disconnect, and cannot restore tickets on another device. Supabase Auth fits the existing database and RLS stack. Dfns documents delegated end-user wallets, passkey authorization and recovery, Stellar/Ed25519 support, and Stellar transaction signing/broadcasting.

**Proof gate.** Before building the complete auth UI, prove this narrow journey:

1. Sign in on Browser A and provision the wallet.
2. Build, sign, submit, and confirm the current Soroban purchase flow.
3. Sign the existing QR message format and verify it locally.
4. Sign in on Browser B and restore the same Stellar address and signing ability.
5. Revoke or lose the first device and complete the selected recovery flow.
6. Confirm that no raw wallet secret appears in browser storage, Supabase, or logs.

If Dfns cannot pass this proof or is unavailable under the selected plan, only the delegated-wallet provider may change. The account/wallet separation and recovery behavior remain locked.

**References.** [`useWallet.ts`](../frontend/src/hooks/useWallet.ts) · [`stellar.ts`](../frontend/src/lib/stellar.ts) · [`useAppStore.ts`](../frontend/src/store/useAppStore.ts) · [`qr.ts`](../frontend/src/lib/qr.ts) · [Supabase Auth](https://supabase.com/docs/guides/auth) · [Dfns end-user wallets](https://docs.dfns.co/solutions/embed-user-wallets) · [Dfns Stellar key support](https://docs.dfns.co/networks/supported-key-formats) · [Dfns Stellar broadcast](https://docs.dfns.co/api-reference/broadcast/stellar)

---

## DR-02 — Public entry and durable navigation

**Decision.** Keep the React/Vite SPA and replace `AppView` navigation with a mature client router such as React Router.

Canonical Slice 1 routes are:

- `/events`
- `/events/:eventId`
- `/events/:eventId/checkout`
- `/tickets`
- `/tickets/:ticketId`
- `/marketplace`
- `/account`
- `/purchases/:operationId`
- `/organizer/events`
- `/organizer/events/:eventId`
- `/organizer/events/:eventId/check-in`
- `/auth/callback`

The root route redirects to `/events`. Discover and event details are public. Protected actions store a validated same-origin route and action intent, complete authentication, then return to that exact destination. The event is reloaded and revalidated after return. External or malformed return URLs are rejected.

Scanner access exists only inside a specific organizer event. Browser Back/Forward, refresh, shared links, receipt reopening, and not-found behavior are part of the routing contract.

**Why.** The current in-memory view and selected-ID state cannot support authentication return, refresh recovery, receipts, calendar links, or shareable events.

**Proof gate.** Google and email auth must return to an exact checkout route; refreshing event, checkout, ticket, and receipt routes must retain the destination; no redirect restoration may submit a transaction.

**References.** [`App.tsx`](../frontend/src/App.tsx) · [`types/index.ts`](../frontend/src/types/index.ts) · [`AppHeader.tsx`](../frontend/src/components/layout/AppHeader.tsx) · [`BottomNav.tsx`](../frontend/src/components/layout/BottomNav.tsx)

---

## DR-03 — Purchase operation, receipt, and idempotency

**Decision.** Every user confirmation creates or resumes one durable `purchase_operation` before transaction preparation.

Allocate these values once:

- `operation_id`;
- `user_id`;
- `event_id`;
- `ticket_id`;
- attendee wallet address;
- idempotency key;
- expected price and network;
- transaction hash when available;
- chain state, mirror state, timestamps, and bounded error details.

Use `operation_id` as the external idempotency identifier when the wallet provider supports it. Enforce uniqueness for the operation, idempotency key, and ticket ID. Keep a small local copy only for immediate crash or redirect continuity; the authenticated database record is the durable record.

The operation follows the Slice 1 transaction states: `review`, `preparing`, `approval_required`, `submitting`, `confirming`, `status_unknown`, `chain_failed`, `chain_confirmed`, `mirror_syncing`, `sync_warning`, and `complete`.

After submission may have occurred, the Pay action remains disabled. The app resolves the existing operation by hash or ticket ID; it never generates a second payable attempt while status is unresolved. A new operation is allowed only after a definitive non-submitted or chain-failed result and an explicit user retry.

The receipt route is `/purchases/:operationId`. It survives refresh and shows the ticket ID, owner, amount, hash, network, confirmation time, and sync status. An operation or receipt never proves ownership; the chain does.

**Why.** The current ticket ID is generated inside the click handler, transaction state is not persisted, and the Soroban wrapper discards the hash. A refresh or timeout can therefore lead to an unsafe second payment.

**Proof gate.** Test double-click, refresh at each boundary, timeout after broadcast, same-ID replay, cross-device receipt access, and recovery without a second payment.

**References.** [`PurchasePage.tsx`](../frontend/src/pages/PurchasePage.tsx) · [`soroban.ts`](../frontend/src/lib/soroban.ts) · [`useAppStore.ts`](../frontend/src/store/useAppStore.ts) · [`ticket/src/lib.rs`](../contracts/ticket/src/lib.rs)

---

## DR-04 — Trusted reconciliation and database authority

**Decision.** Remove anonymous financial mirror writes. Use Supabase RLS and a **Supabase Edge Function** as the Slice 1 trusted reconciliation boundary.

Access rules are:

- visitors may read only publish-ready public events and open marketplace discovery data;
- authenticated users may read and update only their own profile, wallet links, purchase operations, and receipts;
- ticket ownership, event financial state, transaction hashes, and reconciliation results are written only by the trusted function or service role;
- service credentials never enter the Vite bundle.

After a transaction hash exists, the Edge Function verifies the transaction and authoritative `get_ticket`/`get_event` state through Stellar RPC. It then performs one idempotent database transaction that upserts the ticket mirror, reconciles event supply from authoritative state, updates the operation, and records the sync attempt. Repeating the same repair must be safe.

The browser may request reconciliation and display progress, but it cannot declare chain success or submit owner/status/hash values as truth. A full continuous indexer is deferred; Slice 1 uses operation-triggered repair.

**Why.** Current public RLS permits forged rows, and ticket insertion plus supply increment are separate browser writes. A partial failure can leave inconsistent discovery data even after a valid purchase.

**Proof gate.** Reject forged user, owner, event, status, and hash inputs; force each mirror step to fail independently; close the browser; repair once from chain state; repeat safely; confirm another user cannot read private operations or receipts.

**References.** [`supabase_schema.sql`](../supabase_schema.sql) · [`readModelSync.ts`](../frontend/src/lib/readModelSync.ts) · [`supabase.ts`](../frontend/src/lib/supabase.ts) · [`soroban.ts`](../frontend/src/lib/soroban.ts)

---

## DR-05 — Sales cutoff, deployment, and legacy data

**Decision.** Primary sales close on-chain when `env.ledger().timestamp() >= event.date_unix`. Add a stable `EventSalesClosed` error without renumbering existing errors, run the check before ticket, supply, escrow, or token effects, regenerate bindings, and map the error to the Sale closed experience.

Deploy a **fresh TicketContract and MarketplaceContract pair** on Stellar Testnet after this change. Do not replace only one peer contract.

The current burner-based testnet application data will not be migrated into authenticated accounts. Before reset:

1. export the current contract IDs, relevant transaction hashes, screenshots, and user-validation evidence required for the hackathon record;
2. archive the old deployment as read-only evidence;
3. reset Supabase application rows that cannot be trusted or linked to a verified user;
4. deploy and initialize the new contract pair;
5. regenerate bindings and update every environment and documentation reference.

Do not claim that a database reassignment moved on-chain ticket ownership. Users begin the finished product experience with recoverable wallets and new testnet activity.

**Why.** The current contract permits purchase after the event start, and browser-local burners cannot be safely assigned to new human accounts. Preserving them would add insecure legacy access or an unplanned transfer/migration contract.

**Proof gate.** Test one second before, exactly at, and after the cutoff; cancelled and sold-out interactions; rollback; cross-contract compatibility; fresh paired deployment; environment generation; and one complete purchase smoke test.

**References.** [`ticket/src/lib.rs`](../contracts/ticket/src/lib.rs) · [`ticket/src/error.rs`](../contracts/ticket/src/error.rs) · [`marketplace/src/lib.rs`](../contracts/marketplace/src/lib.rs) · [`scripts/deploy.sh`](../scripts/deploy.sh)

---

## DR-06 — Testnet activation and funding

**Decision.** Wallet provisioning and testnet funding are separate states. Do not fund silently during sign-in.

When checkout needs funds:

1. read the wallet account and current balance;
2. show the ticket price, estimated fee, available balance, and exact shortfall;
3. offer **Get test XLM** only when the account is not yet activated;
4. call Friendbot through an authenticated, rate-limited Supabase Edge Function tied to the user's recorded attendee wallet;
5. poll until Horizon/RPC shows the account and balance or a bounded failure is reached;
6. never treat every HTTP 400 as success.

If an already-created account later has insufficient funds, show a truthful support/reset path rather than pretending Friendbot refilled it. Keep the persistent disclosure: **Stellar Testnet — balances and payments have no monetary value.**

**Why.** Current onboarding silently calls Friendbot and displays a temporary 10,000 XLM success message without proving account creation or balance.

**Proof gate.** New account, already funded account, delayed visibility, rate limit, repeated click, non-benign 400, network failure, and refresh during activation.

**References.** [`stellar.ts`](../frontend/src/lib/stellar.ts) · [`useWallet.ts`](../frontend/src/hooks/useWallet.ts) · [`PurchasePage.tsx`](../frontend/src/pages/PurchasePage.tsx)

---

## DR-07 — Event metadata and publishing

**Decision.** Keep `date_unix` on-chain as the authoritative start instant. Store the following required public metadata in Supabase:

- summary and full description;
- image and category;
- IANA timezone;
- explicit end timestamp;
- venue name, address, and city;
- organizer display name and organizer wallet;
- support contact;
- refund summary;
- resale summary;
- entry instructions;
- `publish_state` of `draft`, `published`, or `archived`.

A public event query returns only `published` rows whose required metadata is complete and whose row is linked to the correct on-chain event. Missing required values are not replaced with `TBA`, stock identities, fabricated tiers, or fixed fees.

For the current one-shot Create Event flow, collect all required metadata before submitting the contract transaction. Publish only after chain creation and trusted mirror completion. If the mirror fails after chain success, keep the event hidden and repair synchronization; do not ask the organizer to create a second event.

The same normalized start, end, timezone, venue, address, and event URL power event details, receipt, owned ticket, Google Calendar, Outlook, `.ics`, and maps actions.

**Why.** Current rows lack the data needed for truthful event details, calendar export, support, and publish readiness, while every row is immediately discoverable.

**Proof gate.** Test timezone and daylight-saving boundaries, calendar exports, incomplete-row exclusion, chain-success/mirror-failure recovery, and consistent display across event, receipt, and ticket pages.

**References.** [`supabase_schema.sql`](../supabase_schema.sql) · [`CreateEventPage.tsx`](../frontend/src/pages/organizer/CreateEventPage.tsx) · [`EventDetailPage.tsx`](../frontend/src/pages/EventDetailPage.tsx) · [`BrowsePage.tsx`](../frontend/src/pages/BrowsePage.tsx)

---

## Deferred from Slice 1

Multiple quantities, ticket tiers, fiat or stablecoin payments, general transaction history for every contract action, a continuous chain indexer, in-app notifications, organizer following, announcements, waitlists, AI, detailed analytics, venue-staff delegation, recurring events, seat maps, and a full internal calendar remain out of scope.

These decisions should be copied into the canonical architecture and decision records as their implementation lands. Do not maintain contradictory wallet, RLS, routing, or deployment models in parallel.
