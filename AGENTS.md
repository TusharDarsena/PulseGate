# AGENTS.md
*Read this before touching any file. Navigation, ownership, and hard rules — no design detail.*

---

## What this project is

NFT event ticketing on Stellar. Two Soroban smart contracts + React/Vite frontend. Full design in `docs/architecture.md`.

---

## Read before you code

| Working on          | Read first                                                      |
| ------------------- | --------------------------------------------------------------- |
| Anything            | `docs/architecture.md`                                          |
| Contracts           | + `contracts/README.md`                                         |
| Any design decision | `docs/decisions.md` — check before changing, add after deciding |

---

## File ownership

### Root
| File           | Owns                                         |
| -------------- | -------------------------------------------- |
| `README.md`    | Project overview and current status          |
| `AGENTS.md`    | This file                                    |
| `CHANGELOG.md` | Session log — append after each work session |

### docs/
| File              | Owns                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `architecture.md` | **Binding design.** Storage models, function signatures, wallet flows, QR, deployment sequence. Do not deviate without updating `decisions.md`. |
| `decisions.md`    | Why each design choice was made. Check before overriding anything.                                                                              |
| `repo_guide.md`   | What to use/avoid from reference repos. Read once before writing contracts.                                                                     |
| `frontend.md`     | Frontend file responsibilities, hook APIs, page behaviors.                                                                                      |

### contracts/
| File                         | Owns                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Cargo.toml`                 | Workspace root. SDK pinned **once** here: `soroban-sdk = "25.3.1"`. Never add a version in per-contract files. |
| `ticket/src/lib.rs`          | Public interface only. No business logic. Never calls `env.storage()` directly.                                |
| `ticket/src/types.rs`        | All `#[contracttype]` definitions. Nothing else.                                                               |
| `ticket/src/storage.rs`      | All `read_*` / `write_*` helpers. Raw storage, no logic.                                                       |
| `ticket/src/escrow.rs`       | XLM stroop accounting only.                                                                                    |
| `ticket/src/events.rs`       | All `env.events().publish()` calls. Nowhere else.                                                              |
| `ticket/src/test.rs`         | Contract tests using Soroban test environment.                                                                 |
| `marketplace/src/lib.rs`     | Public interface + the one inter-contract call to `restricted_transfer` in `buy_listing`.                      |
| `marketplace/src/types.rs`   | `DataKey`, `Listing`, `ListingStatus`.                                                                         |
| `marketplace/src/storage.rs` | Storage helpers, same pattern as ticket.                                                                       |
| `marketplace/src/events.rs`  | Marketplace events only.                                                                                       |
| `marketplace/src/test.rs`    | Royalty calculation, buy_listing flow, cancellation.                                                           |

### frontend/src/
| File                    | Owns                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `lib/constants.ts`      | ⚠️ Contract addresses, RPC URL, network passphrase. The **only** place. Hardcoding elsewhere is a bug. |
| `lib/soroban.ts`        | Build → simulate → prepare → submit. Only file importing `SorobanRpc`.                                |
| `lib/stellar.ts`        | `Keypair.verify()`, Burner Wallet generation (`Keypair.random()`), Friendbot funding. No tx building. |
| `lib/qr.ts`             | QR payload build + verify. Zero network calls.                                                        |
| `hooks/useWallet.ts`    | Unified Freighter + Burner Wallet hook. `walletType: 'freighter' \| 'burner' \| null`. Nothing outside knows which provider is active. Web3Auth deferred (D-028). |
| `hooks/useEvents.ts`    | Event list with 30s cache. Never fetch inside render.                                                 |
| `hooks/useTickets.ts`   | Tickets for current wallet. Call `invalidate()` after purchase.                                       |
| `components/shared/`    | UI primitives. No blockchain logic.                                                                   |
| `components/attendee/`  | Attendee-only components. Does not import from `organizer/`.                                          |
| `components/organizer/` | Organizer-only components. Does not import from `attendee/`.                                          |
| `components/scanner/`   | Camera + QR decode + result display.                                                                  |

### scripts/
| File        | Owns                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| `deploy.sh` | Deploy Ticket → Marketplace → initialize both. Fails loudly on error. Order is enforced here. |
| `fund.sh`   | Friendbot for test addresses.                                                                 |

---

## Hard rules

### Contracts
- `lib.rs` never calls `env.storage()` directly — goes through `storage.rs`
- `env.events().publish()` lives only in `events.rs`
- `address.require_auth()` at the top of every guarded function
- `checked_*` arithmetic everywhere on `i128` — no raw operators
- `persistent()` for all data; `instance()` only for contract-lifetime data (e.g. `MarketplaceAddress`)
- Inter-contract calls: use the generated `#[contractclient]` type — never `env.call_contract()`

### Frontend
- `AssembledTransaction.signAndSend()` handles build → simulate → sign → submit client-side (D-007 revised). No backend XDR server for MVP.
- All SDK calls go through `lib/soroban.ts` or `lib/stellar.ts` — components never import `@stellar/stellar-sdk`
- 30s cache TTL in all hooks — never fetch inside render
- `constants.ts` reads from `import.meta.env` only — never hardcode contract IDs
- Attendee wallets are Burner Wallets (D-028): `Keypair.random()`, secret in `localStorage`, funded via Friendbot
- Event/ticket lists are discovered via Supabase (`lib/supabase.ts`) — no `get_all_*` contract methods exist. On-chain `get_event`/`get_ticket` are used for authoritative state during transactions (D-004, D-029).

---

## Never do these

- **No SAC tickets.** Custom NFT — gated transfer (`restricted_transfer`) requires it. D-001.
- **No auto-refund loops.** Hits Soroban instruction limits. Refunds are pull-based. D-002.
- **No shared backend signer for MVP.** `AssembledTransaction` is used client-side — safe because each user has their own keypair. D-007 revised.
- **No `env.call_contract()`.** Use generated client.
- **No `soroban-auth` / `Signature` / `Identifier` types.** Ancient SDK (0.4.x). Auth is `address.require_auth()`.
- **No hardcoded addresses outside `constants.ts`.**
- **No QR windowed timestamp `floor(unix/30)`.** Use `|now - timestamp| < 30`. D-006.
- **Never skip `simulateTransaction`.** Wrong fees, opaque errors.
- **No lock mechanism on listings.** Known gap, acceptable for MVP. D-009.

---

**do not** write 15–20 lines of setup in test.rs files (creating the environment, generating addresses, mocking auths, deploying the token, and initializing the ticket contract). 1-2 sentences max. instead - create a Test Fixture or setup struct. Then, your actual tests become beautifully short:

Rust
#[test]
fn test_create_event_and_purchase() {
    let setup = TestSetup::new();
    // Start testing the actual logic immediately:
    setup.contract.create_event(...);
    setup.contract.purchase(...);
}

## updating architecture.md

# **update teh architecture.md if soem change is made that changes teh architecture.**

## Before writing code

1. Is there a stated ownership for this file above?
2. Does `docs/architecture.md` define the storage model or function signature you're implementing?
3. Is this decision already in `docs/decisions.md`?
4. If deviating — add a note to `docs/decisions.md`.
