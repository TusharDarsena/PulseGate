# Testnet user proof worker

This directory contains one unattended Windows worker that:

1. creates and funds up to 65 Stellar Testnet identities;
2. creates three Testnet events;
3. submits one confirmed TicketContract purchase per identity;
4. assigns varied proof outcomes across primary purchases, open Marketplace
   listings, sold listings, resale purchases, listing cancellations, event
   cancellation, and attendee refunds;
5. resolves every proof transaction through Horizon and Stellar RPC;
6. captures exactly two Stellar Expert screenshots per account; and
7. writes a GitHub-ready `README.md` with sequentially numbered user sections.

It does not create Supabase Auth records, Dfns wallets, profiles, purchase
operations, or Mainnet activity.

The worker deliberately excludes `mark_used`. The contract currently deployed
under this workspace's configured IDs exposes an older check-in argument shape
than the current source and architecture. The worker does not use that weaker,
out-of-sync entrypoint. Check-in activity can be added after the contracts,
stored peer addresses, generated bindings, frontend environment, and Supabase
secrets are redeployed together.

## Prerequisites

- The current Testnet contracts are deployed and their IDs are present in
  `frontend/.env.local`.
- `organizer` exists in `C:\Users\asus\.config\stellar` and is funded.
- Do not use the `organizer` identity for unrelated transactions while a worker
  run is active; recovery assumes that source is exclusive to the run during
  organizer operations.
- Stellar CLI v27 is available at `C:\tmp\stellar.exe`.
- Root JavaScript dependencies are installed and Playwright Chromium is
  available. If Chromium has not previously been installed, run:

  ```powershell
  npx playwright install chromium
  ```

- Windows Credential Manager must be available because generated identities
  are saved through the Stellar CLI `--secure-store` option.

## Start a complete run

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\scripts\testnet-user-worker\Run-TestnetUserWorker.ps1
```

The default run targets 65 accounts and approximately 60 minutes. Explorer
indexing is external, so the worker may continue beyond the target rather than
produce missing screenshots.

For the lightweight three-account smoke path used to validate funding,
purchase confirmation, screenshots, and Markdown generation:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\scripts\testnet-user-worker\Run-TestnetUserWorker.ps1 `
  -UserCount 3 `
  -TargetRuntimeMinutes 2 `
  -RunId smoke-proof-01
```

Runs with at most three accounts and a target of five minutes or less use one
event and one purchase per account, then immediately capture the six proof
screenshots and README. Explorer indexing can make the complete proof phase
finish after the activity target.

For a stable name that can be resumed:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\scripts\testnet-user-worker\Run-TestnetUserWorker.ps1 `
  -RunId hackathon-proof-01
```

If the terminal closes or a network request remains unresolved:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\scripts\testnet-user-worker\Run-TestnetUserWorker.ps1 `
  -RunId hackathon-proof-01 `
  -Resume
```

The worker persists only public state under `.state/`: identity aliases,
addresses, event/ticket/listing IDs, transaction hashes, ledgers, and progress.
Wallet secrets remain in the Windows secure store.

## Output

The finished package is:

```text
proofs/
└── testnet-users-<run-id>/
    ├── README.md
    └── screenshots/
        ├── user-01-account.png
        ├── user-01-activity.png
        └── ...two images per account
```

The generated README sorts its sections by worker user number (`User 01`,
`User 02`, and so on). Resuming the same run preserves that presentation order.

For a 65-account run, the proof activity is distributed as follows:

- 25 primary ticket purchases;
- 8 Marketplace listings intentionally left open;
- 8 Marketplace listings later cancelled by their sellers;
- 8 Marketplace listings later sold, with the seller's listing transaction
  used as that seller's proof;
- 8 resale purchases, using the buyer's `buy_listing` transaction as proof;
  and
- 8 cancelled-event refunds.

Every account first performs a primary purchase. Role assignment is
deterministically shuffled across account numbers, and the README explicitly
labels the particular transaction displayed for each account.

## Safety and recovery behavior

- Testnet values are hard-coded and independently checked against
  `frontend/.env.local`.
- There is no network parameter that can select Mainnet.
- Before a state-changing call, the worker records the source account's latest
  transaction token and marks the operation `submitting`.
- If interrupted, `-Resume` resolves that exact account's newer transaction
  before considering another submission.
- A transaction with unknown status is not blindly repeated.
- Friendbot, RPC, Horizon, and Stellar Expert reads use bounded retries.
- Existing usable screenshots are retained during resume.
- The GitHub README is written only after all two-per-account screenshots pass
  the minimum-size check.

The worker intentionally does not commit or push the proof directory. Review
the generated README and images before publishing them to GitHub.
