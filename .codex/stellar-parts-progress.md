# Stellar parts progress

## Part 8 - completed

- Commit: uncommitted; this change completes Parts 7 and 8 together.
- Files changed: `.codex/stellar-parts-progress.md`, route wrappers in `frontend/src/App.tsx`, ticket/listing/scanner pages, `frontend/src/pages/BrowsePage.tsx`, and the new debounce hook and focused tests.
- Behavioral changes: `useTickets()` now mounts only for `/tickets`, while `useListings()` mounts only for `/marketplace`; the scanner no longer holds an invisible ticket subscription. Route-local mutations refresh only the read models currently displayed, and later routes fetch fresh on mount. Browse search and city text wait 300 ms before querying; category and date filters remain immediate.
- Verification: `vitest run src/pages/QRDisplayPage.test.tsx src/hooks/useDebouncedValue.test.tsx src/pages/MyTicketsPage.test.tsx src/hooks/initialLoading.test.tsx` passed (4 files, 8 tests), plus `git diff --check`.
- Deferred work: no production build, bundle measurement, full final verification, permanent documentation, code splitting, or temporary-ledger deletion was run or made.

## Part 7 - completed

- Commit: uncommitted; this change completes Parts 7 and 8 together.
- Files changed: `frontend/src/pages/QRDisplayPage.tsx` and `frontend/src/pages/QRDisplayPage.test.tsx`.
- Behavioral changes: every initial, focused, manual, and 30-second QR refresh first reads the authoritative ticket, requires the restored attendee wallet to be the owner and the status to be `Active`, and only then signs the payload. The development screenshot payload bypass was removed. A failed check clears the displayed QR.
- Verification: focused QR lifecycle coverage verifies ordering, revalidation before a refresh signature, and refusal to sign wrong-owner or non-Active tickets.
- Deferred work: no production build, bundle measurement, full final verification, permanent documentation, code splitting, or temporary-ledger deletion was run or made.

## Part 6 - completed

- Commit: this containing `part 6: make listing state and ticket visibility truthful` commit; its exact SHA is reported in the handoff because a Git commit cannot contain its own hash.
- Files changed: `.codex/stellar-parts-progress.md`, `frontend/src/hooks/useWallet.ts`, `frontend/src/lib/safeStorage.ts`, `frontend/src/lib/supabase.ts`, `frontend/src/pages/MyTicketsPage.tsx`, `frontend/src/pages/MyTicketsPage.test.tsx`, and `supabase/migrations/202607290004_part_6_listing_truth_and_ticket_visibility.sql`.
- Behavioral changes: ticket resale state is fetched once in a batch and is fail-closed until the batch succeeds, with one retry action after failure; tickets lacking an event projection remain visible in a separately sorted fallback group with their ticket, status, purchase date, and available receipt action; `get_my_tickets()` now left-joins events; resale/refund mutations remain on the existing trusted ticket-operation adapter. The unused organizer restore export and ignored storage-helper boolean results were removed.
- Verification: scoped diff and status inspection, plus `git diff --check` only.
- Known limitations/deferred work: focused UI coverage and a migration assertion were added but not run. No tests, lint, TypeScript checks, builds, migration validation, deployment, formatters, or permanent documentation changes were run or made.
- Next: Part 7 - explicit QR lifecycle (not started).

## Part 2 — completed

- Commit: `098ad5091b0266578bc586c80bb9bf61c5c6c2e1` — `part 2: make attendee restoration session safe`.
- Files changed: attendee auth restoration, protected routing, and fail-soft browser-storage helpers.
- Behavioral changes: attendee wallet restoration is session-safe and browser-storage failures cannot interrupt authentication or purchase resolution.
- Verification: diff inspection and `git diff --check` only.
- Known limitations/deferred work: tests, lint, type checks, builds, deployment, and permanent documentation were intentionally not run or changed.

## Part 3 — completed

- Commit: `e47fbd2c1c0ecac8778f7d8e4ff08c9fe2fda6fd` — `part 3: correct organizer editor saves`.
- Files changed: `frontend/src/lib/supabase.ts`, `frontend/src/pages/organizer/EventDraftPage.tsx`, `frontend/src/pages/organizer/EventDraftPage.test.tsx`, `frontend/src/pages/organizer/OrganizerEventPage.tsx`, and `supabase/migrations/202607290003_part_3_organizer_editor_correctness.sql`.
- Behavioral changes: ordinary draft saves omit organizer binding; an unbound draft has an explicit one-time organizer-binding action; a database trigger prevents organizer reassignment; both organizer editors retain edits made while a save is in flight while adopting the returned server revision; metadata saves use their returned event record without a redundant reload.
- Verification: scoped diff inspection and `git diff --check` only.
- Known limitations/deferred work: focused tests were added but not run. No tests, lint, TypeScript checks, builds, migration validation, deployment, formatters, or permanent documentation changes were run or made.

## Part 4 — completed

- Commit: `ab5b25e34bf4962bb64a0e5cb8b71801ff5218f1` — `part 4: verify organizer wallet and scanner access`.
- Files changed: `.codex/stellar-parts-progress.md`, `frontend/src/App.tsx`, `frontend/src/hooks/useWallet.ts`, `frontend/src/hooks/useWallet.test.ts`, `frontend/src/pages/ScannerPage.tsx`, and `frontend/src/store/useAppStore.ts`.
- Behavioral changes: persisted organizer-wallet state contains only a disconnected address hint; restoration verifies Freighter connectivity and current address before restoring signer capability and balance; every organizer signer checks Freighter's current address immediately before signing; the scanner keeps one stable library callback, rechecks authoritative event/wallet/signing authorization before allocation and resume, and pauses when its visible gate becomes invalid.
- Verification: scoped diff inspection and `git diff --check` only.
- Known limitations/deferred work: focused tests were added but not run. No tests, lint, TypeScript checks, builds, migration validation, deployment, formatters, or permanent documentation changes were run or made.

## Part 5 — completed

- Commit: `8c933ac6019ea2771553bd9f8eae0ea717affbb7` - `part 5: protect organizer unsaved work`.
- Files changed: `.codex/stellar-parts-progress.md`, `frontend/src/main.tsx`, `frontend/src/hooks/useOrganizerUnsavedWorkGuard.tsx`, `frontend/src/pages/organizer/EventDraftPage.tsx`, `frontend/src/pages/organizer/EventDraftPage.test.tsx`, and `frontend/src/pages/organizer/OrganizerEventPage.tsx`.
- Behavioral changes: the app uses a minimal data-router host around its existing declarative route tree; both organizer editors share a guard that blocks unsaved, failed, offline, conflict, and newer-local-edit states for SPA navigation, Back/Forward, refresh, and tab close; the dialog offers only Stay and Discard and leave.
- Verification: scoped diff inspection and `git diff --check` only.
- Known limitations/deferred work: focused tests were added or updated but not run. No tests, lint, TypeScript checks, builds, migration validation, deployment, formatters, or permanent documentation changes were run or made.
- Next: Part 6 — listing truth and ticket visibility (not started).
