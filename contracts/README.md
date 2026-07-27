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
cargo build                                              # host compile check
cargo test -p ticket                                     # run ticket tests
cargo test -p marketplace                                # run marketplace tests
cargo build --target wasm32v1-none --release             # build deployable wasm
```

On Windows, plain `cargo build` and `cargo test` compile native host binaries.
With the default `stable-x86_64-pc-windows-msvc` toolchain, they require the
Visual C++ linker to be available in the shell, for example from a Developer
PowerShell. The deploy path may use the GNU toolchain for the WASM build:

```powershell
cargo +stable-x86_64-pc-windows-gnu build --target wasm32v1-none --release
```

That GNU command is appropriate for deployable WASM artifacts. It is not a
complete substitute for `cargo test`, because marketplace tests can still need
to link native test DLLs.

## Status

- `ticket` contract: ✅ complete, tests passing
- `marketplace` contract: ✅ complete, tests passing
- Both deployed to Stellar Testnet (see root README for addresses)

## Deploying

Use `scripts/deploy.sh` on Unix-like shells or `scripts/deploy.ps1` on this
Windows workspace. Order matters — see `docs/architecture.md` → Deployment Sequence.
