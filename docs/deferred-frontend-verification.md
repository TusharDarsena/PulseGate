# Deferred frontend verification

The implementation findings are being completed before normal test, lint, or
build suites run. Keep this file concise and execute it only when all ten parts
are ready for final verification.

## Part 1 — trusted refund and resale operations

- Apply `202607290002_phase_5_ticket_operations.sql` to a disposable/local
  Supabase database and verify clean migration plus RLS/grants.
- Deploy `ticket-operation` with matching Testnet Ticket and Marketplace IDs.
- Refund: confirm success, rejection, refresh after signing, RPC-unavailable
  status recovery, mirror failure, and mirror-only retry.
- Create/cancel listing: verify exact seller-namespaced listing identity,
  duplicate IDs across different sellers, signed-status recovery, and no browser
  insert/update permission.
- Buy listing: verify exact `mk_sold` proof, buyer ownership projection, atomic
  listing/ticket update, stale seller rejection, and two buyers racing.
- Delay create-listing reconciliation until after a sale and confirm the newer
  current chain state wins rather than reopening the listing.
- Confirm recovery banners survive refresh and never offer a second blockchain
  submission for `status_unknown` or `sync_warning`.
- Leave operations in both `chain_confirmed` and `mirror_syncing`; verify both
  appear as synchronization recovery actions after a refresh.
- Delay synchronization of a successful buy until the ticket has been resold
  again; verify it mirrors the latest authoritative owner instead of getting
  stuck on the historical buyer.
- Run focused frontend operation tests, Edge Function checks, migration checks,
  then the repository’s final frontend test, lint, and production build commands.
