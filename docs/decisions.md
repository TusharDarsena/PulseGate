# Decisions

Quick reference for architectural decisions. Read before changing anything significant. Add an entry here whenever you make a new significant choice.

---

## D-001 — Custom NFT, not Stellar Asset Contract

Tickets are hand-rolled NFTs in TicketContract storage. SAC's `transfer` is open to anyone — we need transfer gated to MarketplaceContract only via `restricted_transfer`. Gating a SAC transfer requires overriding SAC itself, which adds surface area we don't need.

## D-002 — Pull-based escrow and refunds

`release_funds` and `refund` are callable by anyone; the contract enforces conditions. Soroban has no auto-execution, and looping over all ticket holders in one transaction hits instruction limits.

## D-003 — Two contracts

TicketContract owns ticket state. MarketplaceContract owns listing state and makes the one inter-contract call to `restricted_transfer`. Kept separate per hackathon requirement and correct architectural boundary.

## D-004 — Supabase as caching/indexing layer (revised)

On-chain is the source of truth for all ticket and event state. However, the Soroban RPC `getEvents` approach (originally planned — see D-029) proved too slow for list-view UX. Supabase is now used as a read-cache/indexing layer for two queries: all events (browse page) and tickets-by-owner (my tickets page). On every write (create event, purchase, mark_used), the frontend writes mirrored rows to Supabase in a non-blocking fire-and-forget call. On-chain lookups (`get_event`, `get_ticket`) are still used for authoritative state before any transaction (e.g. scanner QR verification).

## D-005 — QR verification is client-side

`Keypair.verify()` runs in the browser with no network call — makes the scanner instant. `mark_used` hits the chain after the green/red result is shown.

## D-006 — QR uses absolute timestamp, not windowed

Check `|now - payload_timestamp| < 30`. **Not** `floor(unix/30)` — that fails a QR generated at second 29 when scanned at second 31 (2 seconds later, but different window). See `lib/qr.ts`.

## D-007 — Frontend-only transaction building for MVP (revised)

**Original intent**: Server builds/simulates, client signs, server submits to prevent sequence number divergence under concurrent load.

**MVP revision**: Each user signs with their own keypair (Freighter for organizers, Burner Wallet for attendees — D-028). There is no shared backend signer and no concurrent writes to the same account. `AssembledTransaction.signAndSend()` from `@stellar/stellar-sdk` handles build → simulate → sign → submit in a single call, fetching a fresh sequence number each time. Sequence divergence cannot occur in a single-user-per-keypair model.

**Rule for MVP**: Use `AssembledTransaction` directly in `lib/soroban.ts`. No backend XDR endpoint needed. Re-evaluate if a shared organizer hot-wallet is ever introduced (that is the case where a submission queue is required).

**Files affected**: `lib/soroban.ts`. `AGENTS.md` hard rule updated accordingly.

## D-008 — Web3Auth for attendees, Freighter for organizers

Attendees: Google/email login, silent keypair creation, no crypto knowledge required. Organizers: Freighter, full key control. Both unified behind `useWallet` hook — nothing outside that hook knows which provider is active.

## D-009 — No marketplace listing lock

A listed ticket can be used at the door before it sells, making the listing stale. Acceptable for MVP — `restricted_transfer` is required to actually move ownership, so financial risk is contained.

## D-010 — royalty_rate as integer percentage, ceiling division

`royalty_rate = 10` means 10%. Royalty uses ceiling division to prevent micro-transaction evasion:
`royalty = (ask_price * royalty_rate + 99) / 100`.
Standard floor division (`* rate / 100`) rounds down to 0 for small prices (e.g. 9 stroops × 10% = 0.9 → 0), completely bypassing the organizer's cut.
Ceiling division ensures organizers always receive at least 1 stroop when `rate > 0` and `ask_price > 0`.
Pattern adopted from litemint-royalty-contract. Switch to basis points (/ 10000) if finer granularity is ever needed.
`buy_listing` skips the organizer transfer entirely if `royalty == 0` (rate=0 case) — the XLM SAC panics on a zero-amount transfer.

## D-011 — SDK pinned at 25.3.1

Started docs saying 21.0.0 but that's significantly outdated. Using 25.3.1 (latest stable at project start). Notable API differences from 21: `env.register()` in tests, `set_timestamp()` for ledger, `#[contractevent]` replacing `events().publish()`.

## D-012 — MarketplaceAddress in instance() storage

Set once at `initialize()`, never changes — it IS contract-lifetime data. `instance()` is semantically correct. All other state (Events, Tickets, Escrow) uses `persistent()`.

## D-013 — React + Vite for frontend

No SSR needed for a hackathon demo. The server/client transaction split (D-007) uses a lightweight API server alongside Vite, not Next.js API routes. Docs originally assumed Next.js — ignore those references.

## D-014 — XLM token address stored at initialize, never caller-supplied (S-001)

`initialize` accepts both `marketplace_address` and `xlm_token`. Both are stored in `instance()` storage. `purchase`, `refund`, and `release_funds` read the token address from storage. Callers cannot inject a fake token contract to inflate escrow accounting and drain real XLM.

## D-015 — Instance storage TTL extended on every write (S-002)

`write_marketplace_address` and `write_xlm_token` both call `instance().extend_ttl(TTL_MIN, TTL_TARGET)` after the set. If instance storage expires, an attacker could re-call `initialize()` to replace the marketplace address and gain transfer authority over all tickets. TTL extension on every write prevents this.

## D-016 — CEI ordering enforced in purchase, refund, release_funds (S-003)

All state mutations (ticket write, supply increment, escrow accounting) happen before the external `token.transfer` call in all three functions. This is the standard Check-Effects-Interactions pattern — it prevents re-entrancy-style execution-flow abuse where external call failure could leave state half-updated.

## D-017 — create_event validates capacity > 0, price > 0, date in the future

Zero or negative capacity allows events that are immediately sold out or allow infinite tickets. Zero or negative price breaks escrow math. A past date allows immediate fund release without running an actual event. All three are rejected at create time with explicit error codes.

## D-018 — TicketStatus enum instead of used: bool

`Ticket.status` is `TicketStatus { Active, Used, Refunded }` instead of a `bool`. A bool cannot distinguish "scanned at the door" from "refunded after cancellation" — both would be `true`. On-chain data is permanent; a bool here would require a storage migration to fix post-mainnet. The three-variant enum costs nothing extra and makes analytics, scanner UIs, and future tooling unambiguous.

## D-019 — Namespaced Listing IDs

Listings in `MarketplaceContract` are keyed by `(seller, listing_id)` rather than a globally unique `listing_id`. This prevents a griefing attack where a malicious actor observes a pending `list_ticket` transaction in the mempool and front-runs it with their own transaction using the same `listing_id`, causing the legitimate seller's transaction to fail.

## D-020 — Stale Listing Fail-Fast

When a buyer attempts to purchase a listing via `buy_listing`, the contract first verifies that `ticket.owner == listing.seller`. If the seller transferred or used the ticket out-of-band, the transaction fails immediately. While Soroban rolls back failed transactions regardless, this fail-fast check avoids the gas costs associated with cross-contract token transfers that would inevitably be rolled back.

## D-021 — On-Chain Event Derivation for Royalties

In `buy_listing`, the contract derives the event (and thus the organizer who receives royalties) by querying the on-chain ticket record (`get_ticket(listing.ticket_id).event_id`). It explicitly does NOT trust the `event_id` provided by the seller in the listing struct, closing a vulnerability where a malicious seller could list a real ticket but supply a fake `event_id` pointing to an event they control, thereby redirecting royalties to themselves.

## D-022 — `contractclient` for Cross-Contract WASM builds

To avoid `symbol multiply defined` linker errors when building `wasm32v1-none` binaries that perform cross-contract calls, the `TicketContract` is strictly isolated as a `[dev-dependency]`. For production builds, `MarketplaceContract` uses the `#[contractclient]` macro on a minimal interface trait (`TicketInterface`) alongside identical struct definitions, enabling XDR-compatible cross-contract calls without linking the other contract's binary.

## D-023 — SDK pinned at 25.3.1 (moved from D-011)

Started docs saying 21.0.0 but that's significantly outdated. Using 25.3.1 (latest stable at project start). Notable API differences from 21: `env.register()` in tests, `set_timestamp()` for ledger, `#[contractevent]` replacing `events().publish()`.

## D-024 — Centralized Mock Data Source

All mock events and tickets were moved to `src/data/mockData.ts`. Previously, components like `DashboardPage` and `BrowsePage` had local, slightly divergent mock objects. Centralization ensures that when a ticket is "purchased" or "used" in one view, the data remains consistent across the entire session, preventing "ghost" data bugs during the prototype phase.

## D-025 — Zustand for Global State Management

Migrated `wallet` and `txState` from local `useState` in `App.tsx` to a global Zustand `useAppStore`. This eliminates prop-drilling into deeply nested components like `PurchasePage` or `CreateEventPage`. It also allows any component to trigger transaction overlays or read the connected wallet address without complex callback chains.

## D-026 — Self-Hiding Layout Components

`AppHeader` and `BottomNav` now contain internal visibility logic based on `currentView`. Instead of `App.tsx` conditionally rendering them, the components themselves return `null` for "standalone" views (like Scanner or Dashboard). This prevents "double-header" artifacts where both a global header and a page-specific header would render simultaneously.

## D-027 — Standardized QR Payload Format (extended by D-028)

Base payload: `{wallet_address}:{ticket_id}:{timestamp}`. Extended to include an `ed25519` signature field — see D-028 for the full signed format. The 30s rotation ensures a photographed QR expires before it can be replayed. `ScannerPage` parses by splitting on `:` (first 3 fields) and treating the remainder as the base64 signature.

## D-028 — Burner Wallet for Attendees (MVP)

`Keypair.random()` is called when an attendee clicks "Connect". The secret key is stored in `localStorage` under `stellar_burner_secret`. The public key is the attendee's on-chain identity. The account is funded via Friendbot (`https://friendbot.stellar.org/?addr=<pubkey>`) immediately after generation.

**Why not Web3Auth**: Web3Auth requires an API key, OAuth app registration, and a more complex auth flow. Deferred to post-MVP.

**Security note**: `localStorage` is not encrypted. Acceptable for a testnet hackathon demo where funds are worthless. Mainnet would require either Web3Auth (server-side key custody) or a hardware-backed solution.

**QR signing**: The full signed payload format is `{wallet_address}:{ticket_id}:{timestamp}:{base64Signature}` where the signature covers the UTF-8 bytes of `{wallet_address}:{ticket_id}:{timestamp}`. `lib/qr.ts` is the only file that builds or verifies this format. See D-005, D-006.

**walletType field**: `useWallet` exposes `walletType: 'freighter' | 'burner' | null`. Only `burner` wallets have a private key in state; `frighter` wallets never expose one.

## D-029 — Supabase for List Queries (revised from RPC polling)

The `TicketContract` has no `get_all_events()` or `get_tickets_by_owner()` — only keyed lookups by ID. The original plan was to use `SorobanRpc.getEvents()` to discover IDs from on-chain events, but this proved too slow for list-view UX (full ledger scans on every page load).

**Actual implementation**: Supabase is used as a read-cache. See D-004 (revised).

**Browse page**: `useEvents` calls `fetchAllEvents()` from `lib/supabase.ts`, which queries the `events` Supabase table directly. The table is populated by the frontend after each successful `create_event` call (`upsertEventMetadata`).

**My Tickets page**: `useTickets` calls `fetchTicketsByOwner(walletAddress)` from `lib/supabase.ts`, which queries the `tickets` table filtered by `owner_address`. The table is populated after each successful `purchase` call.

**Polling**: Both hooks poll every 30s via `setInterval`. A manual `invalidate()` method re-fetches immediately (called after a purchase).

**On-chain as source of truth**: For the QR scanner flow, the frontend still calls `getTicket(ticketId)` on-chain to confirm current ownership and status before executing `mark_used`. Supabase is for list discovery only — never for authoritative state during transactions.

---

## Known Economic Limitations (Not Fixed for MVP)

## D-030 — Secondary Market Refund Only Returns Original Mint Price

The `refund()` function in `TicketContract` returns `event.price_per_ticket` — the price set at event creation. It does NOT return the price paid on the secondary market.

**Scenario**: An attendee buys a ticket for 100 XLM via the marketplace (original price: 10 XLM + 90 XLM markup). If the event is cancelled, `refund()` returns only 10 XLM, not the 100 XLM paid.

**Why this is acceptable for MVP**: The secondary market operates in a trustless, trust-minimized way. Refunding the full secondary price would require the contract to track the actual ask_price paid per ticket, adding storage overhead and complexity. The V2 approach would be to add an optional "refund policy" field to the Event struct that organizers opt into.

## D-031 — Escrow Release Timing (Rug Pull Vulnerability)

`release_funds` can be called when `ledger.timestamp >= event.date_unix`. An organizer could theoretically:

1. Create an event for a fake concert
2. Mint a few tickets to themselves or friends
3. Wait until the event date, then immediately call `release_funds`

This drains the (empty or minimal) escrow while the contract appears legitimate.

**Mitigation for V2**: Require a minimum threshold of scanned tickets (e.g., at least 50% of capacity marked as `Used` via `mark_used`) before `release_funds` becomes callable. This ensures real attendance before funds unlock.

**Why not fixed for MVP**: Adding a scanned-ticket threshold requires tracking scanned count per event, additional storage writes on every `mark_used`, and a more complex release condition. The MVP prioritizes core functionality over this edge case.

---

## D-032 — Secondary Market / Resale UI Deferred to Post-MVP

The `MarketplaceContract` is deployed and fully functional (listing, buying, royalty deduction, cancellation). However, **no frontend UI will be built for resale flows in the MVP**.

**Reason**: The attendee flow (buy → QR → scan) and organizer flow (create event → dashboard → release funds) are the minimum viable product. Resale is an enhancement. Building a marketplace UI before the core flows are tested end-to-end would add scope without adding demo value.

**Affected pages not built**: `ListTicketPage`, `ResaleMarketPage`, `BuyResalePage`. These are V2.

**Contract functions affected (not exposed in frontend)**: `create_listing`, `buy_listing`, `cancel_listing` in `MarketplaceContract`.

---

## D-033 — Event Cancellation and Refund UI Deferred to Post-MVP

The `TicketContract` has `cancel_event()` (organizer-only) and `refund()` (attendee pull-based, D-002). **No frontend UI is built for either in the MVP.**

**Reason**: Cancellation is an edge case — the MVP demo assumes events proceed normally. Building a cancel + refund flow before the happy path works end-to-end is premature.

**Rule**: Organizers cannot cancel events from the dashboard in MVP. Attendees cannot self-serve refunds. These are V2 features.

**Contract functions affected (not exposed in frontend)**: `cancel_event`, `refund` in `TicketContract`.
