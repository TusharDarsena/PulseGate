# Contract Guidance

These rules apply to `contracts/`.

## Ownership

- `contracts/Cargo.toml`: workspace configuration and Soroban SDK version.
- `ticket/src/lib.rs`: public entrypoints and business-flow orchestration.
- `marketplace/src/lib.rs`: listing, purchase, cancellation, royalty, token, and
  cross-contract orchestration.
- Each contract's `storage.rs`: raw storage access and TTL extension.
- `ticket/src/escrow.rs`: checked per-event escrow accounting only.
- Each contract's `events.rs`: event publication.
- Each contract's `error.rs`: stable deployed error codes.
- `marketplace/src/ticket_interface.rs`: minimal cross-contract interface and
  XDR-compatible mirrored types.

Contract `lib.rs` files legitimately coordinate workflows. Marketplace
production code uses the minimal client interface; the ticket crate is only a
test dependency.

## Invariants

- Call `require_auth()` for every externally supplied actor authorizing an
  action. Organizer actions also compare with the organizer stored on-chain.
- `restricted_transfer()` authenticates the stored Marketplace contract. It is
  not an owner-callable transfer function.
- Keep raw `env.storage()` access in `storage.rs`.
- Event, Ticket, Escrow, and Listing records use persistent storage. Admin and
  trusted contract/token addresses use instance storage.
- Preserve TTL extension on every write path.
- Struct field order, enum variants, storage keys, and error numbers are
  compatibility boundaries. Analyze migration impact before changing them.
- XLM values are stroops (`i128`). Use checked arithmetic and skip zero-value SAC
  transfers.
- Preserve royalty ceiling division: `(ask_price * royalty_rate + 99) / 100`.
- Purchase, refund, and release read the trusted XLM SAC address from contract
  storage, never from the caller.
- Preserve lifecycle transitions:
  - Ticket: `Active -> Used` or `Active -> Refunded`
  - Event: `Active -> Cancelled` or `Active -> Completed`
  - Listing: `Open -> Sold` or `Open -> Cancelled`
- Preserve checks/effects/interactions ordering around token and cross-contract
  calls.
- Listing storage remains keyed by `(seller, listing_id)`. Derive royalty
  authority from the on-chain ticket/event, not the listing's informational
  `event_id`.
- Do not add bulk refunds, an ad hoc listing lock, or Supabase authorization.

## Secondary Purchase

`buy_listing()` must reject closed/self/stale/cancelled purchases before money
moves, mark the listing sold before external interactions, pay royalty and seller
proceeds, call TicketContract `restricted_transfer()`, and rely on transaction
rollback for failures.

## Verification

Use focused tests while coding. At final verification, run from `contracts/`:

```bash
cargo fmt --check
cargo test
cargo build --target wasm32v1-none --release
```

Cover applicable auth failures, transitions, balances, duplicate IDs, stable
errors, rollback-sensitive paths, TTL writes, and cross-contract compatibility.
Regenerate TypeScript bindings after ABI changes; never patch them manually.

On Windows, `cargo test` uses the default MSVC host toolchain and requires the
Visual C++ linker (`link.exe`) from Visual Studio Build Tools or a Developer
PowerShell. Git's `usr/bin/link.exe` is not the MSVC linker. Do not switch to
the GNU target as a workaround for these contract tests; the `cdylib` test link
can fail before tests run. If MSVC Build Tools are not available, report that
toolchain issue and still run `cargo fmt --check` plus the WASM release build.
On this Windows workspace, use
`cargo +stable-x86_64-pc-windows-gnu build --target wasm32v1-none --release`
for that deployable WASM build.
