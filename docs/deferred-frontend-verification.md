# Deferred frontend verification

## Parts 2-8 — frontend correctness and lifecycle changes

- Run the AuthProvider tests for stale-session restoration, immediate sign-out
  clearing, and failed browser storage. Confirm only attendee-wallet routes wait
  for `walletRestoring`.
- Apply migrations `202607290003_part_3_organizer_editor_correctness.sql` and
  `202607290004_part_6_listing_truth_and_ticket_visibility.sql`; verify the
  one-time organizer bind guard, revision behavior, batch listing RPC, and
  missing-event ticket rows under RLS.
- Run organizer editor and wallet tests. Verify a persisted organizer hint is
  disconnected until Freighter confirms the exact current address, including
  immediately before a signature.
- Exercise scanner start, allocation, and resume after an account change,
  disconnected Freighter, expired check-in window, or non-active event; confirm
  the camera pauses and no operation is allocated.
- Exercise SPA links, programmatic navigation, Back/Forward, refresh, and tab
  close with each organizer unsaved state. Confirm the shared dialog offers
  only Stay and Discard and leave.
- Run My Tickets coverage for batch resale lookup failure/retry and missing
  event projections. Confirm resale controls remain disabled until the batch
  result is ready.
- Run QR lifecycle coverage for authoritative revalidation before initial,
  focus, manual, and 30-second signing; confirm failed validation clears the
  code and never creates a signature.
- Verify route-scoped ticket/listing polling mounts and unmounts with its route,
  search/city debounce is about 300 ms, category/date changes are immediate,
  and the published-event absence path discards the concurrent chain result.

The implementation findings are being completed before normal test, lint, or
build suites run. Keep this file concise and execute it only when all eight parts
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
