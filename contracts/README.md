# Contracts

Two Soroban smart contracts compiled to `.wasm` and deployed to Stellar Testnet.

Read `docs/architecture.md` before writing any contract code — it has the storage models, function signatures, and deployment sequence that are binding.

---

## Structure

```
contracts/
├── Cargo.toml              Workspace root. SDK pinned once here.
├── ticket/
│   └── src/
│       ├── lib.rs          Public interface — delegates to modules, never calls env.storage() directly
│       ├── types.rs        All #[contracttype] structs and DataKey enum
│       ├── storage.rs      All read_*/write_* storage helpers
│       ├── escrow.rs       Escrow XLM accounting (checked arithmetic only)
│       ├── events.rs       All env.events().publish() calls
│       └── test.rs         Contract tests (no running node needed)
└── marketplace/
    └── src/
        └── lib.rs          Public interface + inter-contract call to restricted_transfer in buy_listing
```

## SDK

`soroban-sdk = "25.3.1"` pinned in root `Cargo.toml`. Per-contract files use `{ workspace = true }` — never add a version number in a per-contract dependency.

## Commands

```bash
cargo build                                              # check compiles
cargo test -p ticket                                     # run ticket tests
cargo test -p marketplace                                # run marketplace tests
cargo build --target wasm32v1-none --release             # build wasm for deploy
```

## Status

- `ticket` contract: ✅ complete, tests passing
- `marketplace` contract: ✅ complete, tests passing
- Both deployed to Stellar Testnet (see root README for addresses)

## Deploying

Use `scripts/deploy.sh`. Order matters — see `docs/architecture.md` → Deployment Sequence.
