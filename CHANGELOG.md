# Changelog

## Session 1 — 2026-04-26

### Context
Starting from a docs-only repo. No code, no Cargo workspace, no frontend.
Toolchains already present: Rust 1.91, Stellar CLI 23.1.4, Node 22, wasm32 target.

### Decisions logged
- **D-011** — SDK bumped from 21.0.0 (in docs) to 25.3.1 (what we actually use). 21 is significantly outdated.
- **D-012** — `MarketplaceAddress` stored in `instance()`, not `persistent()`. Intentional — it's contract-lifetime data.
- **D-013** — Frontend will be React + Vite, not Next.js.

### What was built
Created the full `contracts/` workspace:
- `contracts/Cargo.toml` — workspace root, SDK 25.3.1 pinned once
- `contracts/ticket/` — full implementation: `error.rs`, `types.rs`, `storage.rs`, `escrow.rs`, `events.rs`, `lib.rs`, `test.rs`
- `contracts/marketplace/` — Cargo.toml + stub `lib.rs` only (implementation deferred)

### Bugs fixed (in AI-generated source from `my code/`)
| # | File | Problem | Fix |
|---|------|---------|-----|
| 1 | `storage.rs` | Imported `Escrow` type that doesn't exist | Removed from import |
| 2 | `lib.rs` | Duplicate event returned `AlreadyInitialized` | Added `EventAlreadyExists = 18`, used it |
| 3 | `events.rs` | `"ev_release"` is 10 chars, `symbol_short!` max is 9 | Renamed to `"ev_rel"` |
| 4 | `test.rs` | `env.ledger().with_mut()` removed in SDK 25 | Changed to `env.ledger().set_timestamp()` |
| 5 | `test.rs` | `.unwrap()` on client return values (SDK 25 returns directly) | Removed `.unwrap()` calls |
| 6 | `test.rs` | Auth rejection test used `mock_all_auths` — didn't test rejection | Rewrote: set up state with `mock_all_auths`, then `mock_auths(&[])` to clear auth before the restricted call |
| 7 | `marketplace/lib.rs` | Bare `#![no_std]` stub missing panic handler | Removed `#![no_std]` from placeholder |

### Test results
```
cargo build   → Finished (7 deprecation warnings on events::publish — not errors)
cargo test    → 6 passed, 0 failed
```

Tests: create+purchase, capacity exceeded, release after event date, refund on cancel (+ double-refund blocked), restricted transfer by marketplace, restricted transfer rejected when marketplace auth absent.

### Deprecation note
`env.events().publish()` is deprecated in SDK 25 — replaced by `#[contractevent]` macros.
Currently warnings only. Will address when writing the marketplace contract.

### What's next
- Marketplace contract implementation
- `scripts/deploy.sh` and `scripts/fund.sh`
- Frontend (React + Vite) — after contracts deployed

---

## Session 2 — 2026-04-26

### Context
Following up on the initial scaffold, identified several architectural and security improvements for the `TicketContract` before moving on to the marketplace.

### Decisions logged
- **D-014** — `xlm_token` is now stored in `instance()` at `initialize` rather than being provided by the caller, preventing fake-token escrow drain attacks.
- **D-015** — Instance storage TTL is extended on every write (`initialize`) to prevent expiration and unauthorized re-initialization.
- **D-016** — CEI (Check-Effects-Interactions) ordering enforced in `purchase`, `refund`, and `release_funds`. All state and escrow updates occur before external token transfers.
- **D-017** — `create_event` now validates capacity > 0, price > 0, and date in the future.
- **D-018** — Replaced `Ticket.used: bool` with `TicketStatus { Active, Used, Refunded }` enum for clearer on-chain history.
- **D-019** — Added `get_xlm_token()` public read-only method for frontend transparency.

### What was built
- Refactored `TicketContract` (`lib.rs` and `types.rs`) to implement the above decisions.
- Storage helpers updated to support `xlm_token` reads and writes, including TTL extensions.
- Modified tests to align with the new signatures (`purchase`, `refund`, `release_funds` no longer take `xlm_token` as an argument; `TicketStatus` assertions instead of `used` booleans).

---

## Session 3 — 2026-04-26

### Context
Following the completion of the `TicketContract`, implemented the secondary market via `MarketplaceContract`.

### Decisions logged
- **D-019** — Namespaced `Listing` DataKey to `(seller, listing_id)` to prevent ID front-running griefing.
- **D-020** — `buy_listing` incorporates a fail-fast check (`ticket.owner == listing.seller`) before token transfers to save gas on stale listings.
- **D-021** — `buy_listing` derives the authoritative `event_id` from the on-chain ticket record, eliminating seller-supplied `event_id` forgery vulnerabilities.
- **D-022** — Used `#[contractclient]` to define `TicketInterface` manually in `MarketplaceContract` to avoid `symbol multiply defined` linker errors when compiling the `wasm32v1-none` target.

### What was built
- **Implemented `MarketplaceContract`**: `lib.rs`, `types.rs`, `storage.rs`, `events.rs`, `error.rs`, `ticket_interface.rs`, and a comprehensive `test.rs`.
- **Financial accuracy**: Implemented Litemint's ceiling division pattern `((price * rate) + 99) / 100` for royalty calculations to ensure organizers receive their cut even on micro-transactions.
- **Testing**: Added 17 unit tests with a unified `TestSetup` fixture covering happy paths, royalty math, forgery attempts, and adversarial flows.

### Test results
```
cargo build --target wasm32v1-none --release -p marketplace   → Finished
cargo test -p marketplace                                       → 17 passed, 0 failed
```

### What's next
- Deployment scripts (`scripts/deploy.sh`, `scripts/fund.sh`)
- Frontend integration (React + Vite)

---

## Session 4 — 2026-04-26

### Context
With both smart contracts fully implemented, the goal was to deploy them to the Stellar Testnet, configure the necessary frontend environment files, and generate TypeScript bindings.

### What was built
- **Deployment Scripts**:
  - `scripts/fund.sh`: Ensures all necessary CLI identities (`alice`, `buyer`, `inspector`, `seller`, `organizer`) are generated and funded via Friendbot on the Testnet.
  - `scripts/deploy.sh`: Compiles WASM binaries for both contracts, deploys them using the `organizer` identity, executes their respective cross-dependent `initialize` functions, and outputs the contract addresses to `frontend/.env.local`.
- **Testnet Deployment**: Successfully executed the scripts. Both `TicketContract` and `MarketplaceContract` are live on the Testnet.
- **Frontend Preparation**:
  - Generated TypeScript bindings for both contracts directly into `frontend/src/contracts/ticket` and `frontend/src/contracts/marketplace` via `stellar contract bindings typescript`.
- **CLI Smoke Test**:
  - Verified the live Testnet contracts by invoking `create_event` with a future timestamp and `purchase` with the `organizer` identity. 
  - The transactions correctly transferred native Testnet XLM to the contract escrow and emitted the expected events.

### What's next
- Initialize the Vite + React frontend application inside `frontend/`.
- Build the core wallet hooks and Soroban connection utilities.

## Session 5 — 2026-04-27

### Context
Built the full frontend application from scratch using React, Vite, and Tailwind CSS v4, following the architectural guidelines in `docs/frontend.md` and visual references from Stitch designs.

### Decisions logged
- **D-023** — Switched to Tailwind v4 with `@theme` block in `globals.css` for design tokens.
- **D-024** — Adopted a single-state `AppView` router in `App.tsx` to keep the SPA lightweight and avoid `react-router-dom` boilerplate.
- **D-025** — Integrated `qrcode.react` for client-side QR generation, ensuring privacy and offline-readability for ticket verification.
- **D-026** — Standardized page-level navigation using a consistent `onBack` prop pattern across all views.

### What was built
- **Core Layout & UI**:
  - `AppHeader`: Context-aware navigation with wallet connectivity.
  - `BottomNav`: Mobile-first primary navigation.
  - `TxOverlay`: Global transaction state monitoring UI.
  - Component Library: `Button`, `Card`, `Badge`, `EventCard`, `TicketCard`.
- **Attendee Flow**:
  - `LandingPage`: Visual gateway with role selection.
  - `BrowsePage`: Real-time event grid with search and filtering.
  - `EventDetailPage`: High-fidelity event overview with purchase CTA.
  - `PurchasePage`: XLM-denominated checkout flow with mock transaction handlers.
  - `MyTicketsPage`: Collection view of purchased NFTs.
  - `QRDisplayPage`: Dynamic QR code generation for gate entry.
- **Organizer Flow**:
  - `ScannerPage`: Camera-ready gate entry system with valid/invalid mock states.
  - `DashboardPage`: High-level inventory and escrow settlement dashboard.
  - `CreateEventPage`: Interactive event creator with a live card preview.

### Bugs & Visual Fixes
- **Icons**: Fixed "raw text" icons by injecting Google Material Symbols into `index.html`.
- **Typography**: Injected "Inter" font and updated global sans-serif stack.
- **Boilerplate**: Deleted 185 lines of leftover Vite CSS.
- **Refactor**: Replaced hardcoded hex colors (`#7C5CFF`, etc.) with semantic variables (`bg-primary`) across core UI components.

### What's next
- Integrate real Soroban contract hooks (replacing mock handlers).
- Implement cryptographically signed QR payloads (D-006).
- Add real wallet connectivity via Freighter and Web3Auth hooks.
## Session 6 — 2026-04-27 (Current)

### Context
Refactored the frontend architecture to eliminate prop-drilling, centralize state management with Zustand, and consolidate mock data into a single source of truth. Aligned the transaction orchestration logic with the "Backend-Builds, Client-Signs" pattern (D-007).

### Decisions logged
- **D-027** — Centralized all mock data into `src/data/mockData.ts` to ensure UI consistency across pages.
- **D-028** — Migrated wallet and transaction state into a global Zustand `useAppStore` for reliable cross-component reactivity.
- **D-029** — Implemented "Auto-Hide" logic in `AppHeader` and `BottomNav` based on the current `AppView` to prevent double-header artifacts on standalone pages.
- **D-030** — Standardized QR payload format to `{wallet}:{ticket_id}:{timestamp}` as per the security specification (D-006).

### What was built
- **State Management**:
  - `useAppStore`: Centralized store for `wallet` and `txState`.
  - `useWallet`: Refactored to synchronize Freighter connection status with the global store.
- **Data Centralization**:
  - `mockData.ts`: Single source of truth for `MOCK_EVENTS` and `MOCK_TICKETS`.
- **Architectural Refactoring**:
  - `App.tsx`: Cleaned up to handle only high-level routing; all local state moved to stores.
  - `PurchasePage` & `CreateEventPage`: Fully wired to `useAppStore.txState` for real-time transaction feedback (Building → Signing → Success).
  - `ScannerPage`: Integrated with global store and added mock payload verification logic.
  - `QRDisplayPage`: Refactored to generate standardized payloads and handle 30s timestamp rotations.
- **Business Logic Integration**:
  - Implemented unit conversion (Date → Unix, XLM → Stroops) within the frontend flow to match Soroban contract requirements.

### Fixes
- **Freighter Integration**: Fixed `src/hooks/useWallet.ts` by updating the `@stellar/freighter-api` import to use `requestAccess` (v2.x pattern) instead of the deprecated `getPublicKey`.
- **UI Polish**: Resolved the double-header issue by moving visibility logic into the layout components themselves.

### What's next
- Implement actual backend API calls in `src/lib/soroban.ts` (replacing the stubs).
- Add real on-chain ticket status polling (checking if ticket is already 'Used').
- Implement organizer "Release Funds" transaction flow.
- Deployment of frontend to production environment.

---

## Session 7 — 2026-04-27 (Current)

### Context
Finalized the frontend integration, transitioning the UI from mock data to real on-chain smart contract calls and cryptographically secure local signatures.

### Decisions logged
- **D-031** — Attendee authentication uses a local Burner Wallet strategy (`Keypair.random()`) stored in `localStorage` instead of Web3Auth. This unlocks offline QR signing capabilities because Freighter cannot expose private keys.
- **D-032** — Client-side Transaction Building: Using `AssembledTransaction.signAndSend()` exclusively. No backend XDR server is used for transaction orchestration.
- **D-033** — Blockchain state discovery is done exclusively via RPC event polling (`SorobanRpc.getEvents`) instead of on-chain `get_all_*` methods to avoid exceeding Soroban instruction limits.
- **D-034** — The QR Code payload format is signed using `ed25519` via the attendee's local burner wallet, satisfying the zero-network-call verification requirement.

### What was built
- **Core Integrations (`src/lib/`)**:
  - `constants.ts`: Sourced all contract addresses and network configuration from `.env.local`.
  - `qr.ts`: Built cryptographically sound `ed25519` signed QR generation and verification routines.
  - `stellar.ts`: Handled Burner Wallet lifecycle management, including Testnet Friendbot funding.
  - `soroban.ts`: Replaced all mock handlers with real contract method invocations (`purchase`, `createEvent`, `markUsed`), with human-readable error decoding.
- **Hooks (`src/hooks/`)**:
  - `useTickets` & `useEvents`: Implemented intelligent 30s RPC event polling filters to discover tickets/events belonging to the user.
  - `useWallet`: Unified Freighter (organizer) and Burner (attendee) connection paths, exposing a standardized `SignFn`.
- **UI Wiring (`src/pages/`)**:
  - `QRDisplayPage`: Wrote live rotation logic to generate a fresh signed payload every 30s. Added safeguards to prevent Organizers (Freighter) from attempting to generate QR codes.
  - `ScannerPage`: Transitioned mock scan data to actual signature verification and on-chain `markUsed` transaction submission.
  - `PurchasePage` & `CreateEventPage`: Wired checkout and creation flows directly to their respective `soroban.ts` routines with real-time UI loading states.

### Bugs Fixed
- **XDR Parsing**: Migrated complex manual XDR extraction logic in the RPC pollers to use `@stellar/stellar-sdk`'s native `scValToNative()` utility for stable variable mapping.
- **Type Casting**: Enforced robust parameter conversions between JS numericals and Rust Smart Contract typings (e.g. converting XLM to Stroops via `BigInt`).

### Test Results
- `npx tsc --noEmit` — 0 errors.

### What's next
- Final testing on Stellar Testnet for end-to-end QR scan verification.
- MVP deployment to production environments.

---

## Session 8 — 2026-04-28

### Context
Production build hardening and architectural gap documentation. After the full 8-phase integration landed, `npm run build` revealed a set of SDK type mismatches and Vite interop issues that had been hidden by `tsc --noEmit` running against a looser tsconfig. All were fixed and the build now passes cleanly.

### Decisions logged
- **D-030** — `refund()` returns the original mint price, not the secondary-market resale price. Acceptable for MVP; V2 would require storing actual paid price per ticket. Documented in `decisions.md`.
- **D-031** — `release_funds` is callable as soon as `ledger.timestamp >= event.date_unix`. A rug-pull vector exists (organizer drains escrow before anyone attends). Mitigation deferred to V2 (require scanned-ticket threshold). Documented in `decisions.md`.

### What was built / fixed
- **`docs/decisions.md`**: Added D-030 and D-031 documenting known economic limitations of the MVP escrow model (secondary market refund gap, escrow release timing).
- **Contract bindings interop fix** (`contracts/ticket/src/index.ts`, `contracts/marketplace/src/index.ts`):
  - Commented out `export * from '@stellar/stellar-sdk'` — this wildcard re-export was causing Vite's ESM interop to fail at dev-server startup with a *"cannot interop export \*"* warning that broke HMR.
  - The `export * as contract` and `export * as rpc` named namespace re-exports are preserved and work correctly.
- **`SignFn` type overhaul** (`src/types/index.ts`, `src/hooks/useWallet.ts`, `src/lib/stellar.ts`):
  - The `@stellar/stellar-sdk/contract` `SignTransaction` type requires the callback to return `{ signedTxXdr: string }`, not a raw `string`. Updated `SignFn` return type to match.
  - Made the `opts` parameter optional (`opts?`) to satisfy the SDK's looser call-site signature.
  - Updated the Freighter wrapper in `useWallet.ts` and `buildBurnerSignFn` in `stellar.ts` to return `{ signedTxXdr }`.
- **`App.tsx`**: Replaced the non-existent `connectWallet()` call with role-aware dispatch — organizer/scanner views call `connectOrganizer()`, all other views call `connectAttendee()`.
- **RPC topic filter fix** (`src/hooks/useEvents.ts`, `src/hooks/useTickets.ts`):
  - `SorobanRpc.getEvents` `topics` array expects Base64-encoded XDR strings, not raw `ScVal` objects. Fixed by calling `.toXDR('base64')` on `xdr.ScVal.scvSymbol(...)` before passing it as a filter.

### Test Results
- `npm run build` — ✓ 115 modules, 0 errors (warnings only: chunk size, vite-plugin-node-polyfills esbuild/oxc deprecation — both non-blocking).
- `npm run dev` — server starts on http://localhost:5175/.

### What's next
- End-to-end Testnet smoke test: create event (Freighter) → purchase ticket (Burner) → QR scan → `mark_used` on-chain.
- Monitor Friendbot rate limits on testnet for burner wallet funding.
- MVP deployment to production (Vercel or similar static host).

---

## Session 10 — 2026-07-21

### Context
Documentation audit session. No contract or frontend logic changed. All changes are corrections to docs, schema, and the deploy script.

### Critical corrections

| File | What was wrong | What it says now |
|---|---|---|
| `docs/architecture.md` | `purchase()` claimed on-chain ticket_id generation | Client generates ID via `generateID()`; contract checks collision |
| `docs/architecture.md` | QR rejection threshold said `> 30s` | Corrected to `>= 45s` (matches `qr.ts` `PAYLOAD_EXPIRY_SECONDS = 45`) |
| `docs/architecture.md` | Both `initialize()` deployment steps missing `admin` param | Added `admin` as first arg to both calls |
| `docs/architecture.md` | Wallet flow said "Web3Auth"; transaction split said "server-side" | Burner Wallet + client-side `AssembledTransaction.signAndSend()` |
| `docs/decisions.md` | D-004 said "no database for MVP"; D-029 described RPC polling | Both rewritten: Supabase is the read-cache; on-chain is financial authority |
| `docs/decisions.md` | D-006 said 30s QR window | Updated to 45s; rationale documented |
| `docs/decisions.md` | D-032/D-033 said Marketplace, Cancel, and Refund UIs were deferred | All three are implemented — decisions updated to reflect reality |
| `docs/decisions.md` | D-018 title/body mismatch; D-019–D-022 titles one slot behind bodies | Titles realigned to match their bodies |
| `docs/decisions.md` | D-034, D-035 missing | Added: `Number()` i128 precision limitation; open RLS accepted testnet tradeoff |
| `README.md` | Listed `verify_entry` (non-existent); `cancel_event` said auto-refund | Corrected to `mark_used`; pull-based refund documented |
| `README.md` | Data Indexing section referenced `SorobanRpc.getEvents()` + generic symbols | Rewritten with Supabase strategy + full symbol table (`ev_create`, `tk_buy`, `ev_rel`, etc.) |
| `contracts/README.md` | Marketplace status: "🔲 not yet implemented"; wasm target wrong | Both contracts `✅ complete`; target corrected to `wasm32v1-none` |
| `AGENTS.md` | Docs table referenced `frontend.md`, `repo_guide.md` (don't exist) | Removed both rows |
| `AGENTS.md` | Component directories listed `shared/`, `attendee/`, `scanner/` (don't exist) | Corrected to `events/`, `layout/`, `organizer/`, `tickets/`, `ui/` |
| `AGENTS.md` | QR hard rule said `< 30`; soroban.ts description stale | Updated to `< 45`; soroban.ts description matches D-007 revised |
| `supabase_schema.sql` | Missing 5 metadata columns; `current_supply` and `capacity` typed as `integer` | Added `description`, `image_url`, `venue`, `city`, `category`; types corrected to `bigint` |
| `scripts/deploy.sh` | `XLM_TESTNET` hardcoded (violates AGENTS.md hard rule) | Removed; script now reads `XLM_TESTNET_TOKEN` from environment and fails loudly if unset |

