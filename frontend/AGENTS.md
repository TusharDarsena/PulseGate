# Frontend Guidance

These rules apply to `frontend/`.

## Integration Boundaries

- Generated bindings under `src/contracts/` are downstream artifacts. Never
  hand-edit them.
- `src/lib/soroban.ts` is the only handwritten module importing generated
  bindings. Pages call its wrappers.
- `src/lib/qr.ts` owns QR payload construction and local crypto; it performs no
  network calls.
- `src/lib/stellar.ts` owns public Horizon reads.
- `src/lib/dfns.ts` plus the authenticated Edge Function own delegated attendee
  signing.
- `src/hooks/useWallet.ts` owns organizer Freighter connection.
- `src/lib/supabase.ts` is a read-model adapter, never an authority source.
- UI components remain presentational and do not gain contract, wallet, or
  Supabase knowledge.

Do not bypass these adapters with new SDK imports in pages or components.

## Transactions And Synchronization

- Use generated `AssembledTransaction` objects and `signAndSend()` with
  simulation enabled.
- Validate local prerequisites, submit and confirm on-chain, update Supabase,
  invalidate every affected hook, then report the result.
- Never pre-write Supabase as optimistic authorization.
- A mirror failure after chain success is a synchronization failure. Do not
  blindly retry the financial transaction.

## Identity And Wallets

- Human identity is Supabase Auth.
- Organizer wallet is Freighter and remains separate from the attendee wallet.
- Attendee wallet is one recoverable Dfns delegated Stellar Testnet wallet per
  user.
- Raw attendee secrets never enter browser storage, Zustand, Supabase, logs, or
  application code.
- Signing functions are not persisted.
- Restoration failure enters `recovery_required`; it never silently creates a
  replacement wallet.
- Human sign-out and organizer disconnect are separate actions.

## Models, Polling, And QR

- Convert generated `bigint` and tagged unions at adapter boundaries, not in UI
  components.
- Keep status values aligned across Rust, bindings, app types, Supabase, and UI.
- The current `i128 -> Number` conversion is an accepted testnet limitation; an
  end-to-end bigint migration is required to replace it.
- Event, ticket, and listing hooks poll every 30 seconds. Clear intervals and
  ignore superseded responses; never fetch in a render body.
- QR format is
  `{wallet_address}:{ticket_id}:{timestamp}:{base64Signature}`.
- QR display and scanner must preserve the absolute age `< 45s` rule. Local
  signature validity does not replace the on-chain owner/status check.

## Routes

Route changes normally require coordinated updates to `App.tsx`, validated auth
intent patterns, header and bottom navigation, SPA fallback behavior, and
direct-link/refresh/Back/Forward tests.

## Verification

Use focused checks while coding. Run the production build and relevant
lint/type-check/test scripts once at final verification. Exercise the affected
role, hydration/refresh path, transaction success/error state, Supabase mirror
and invalidation, plus mobile and desktop navigation when views change.

