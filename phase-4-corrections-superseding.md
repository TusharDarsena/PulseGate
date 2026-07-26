# Phase 4 Plan: Recoverable Owned Ticket

  ## Summary

  Complete the path from a Phase 3 chain-confirmed purchase to a recoverable ticket by extending the existing `purchase-operation` service. All coding and
  documentation changes will be completed before running tests, builds, lint, deployment verification, or smoke journeys.

  ## Implementation Changes

  ### 1. Preserve purchase semantics

  - Each checkout purchases exactly one ticket.
  - Concurrent or repeated actions reuse the same unresolved operation.
  - Unresolved states continue blocking another payment.
  - After a definitive terminal result, the user may intentionally start another checkout with a new operation ID and ticket ID, including for the same
  event.
  - Successful-operation synchronization retries never create another operation, ticket ID, signature request, or transaction.
  - Fix RPC uncertainty so it persists `status_unknown`; only authoritative rejection becomes `chain_failed`, and only proven non-submission becomes
  `pre_submission_failed`.

  ### 2. Add the narrow migration

  Add:

  - `get_my_tickets()`, deriving the attendee wallet from `auth.uid()` and returning owned tickets joined with event presentation fields and a nullable
  caller-owned receipt operation ID.
  - `get_my_ticket(ticket_id)`, deriving the wallet internally and returning the joined ticket only when its mirrored owner matches.
  - One service-role-only `finalize_verified_purchase_sync(...)`.
  - Minimal ticket provenance using existing Phase 3 transaction/ledger information and a verification timestamp.
  - One bounded synchronization-error category on the existing operation.

  The finalizer atomically:

  1. Locks the purchase operation.
  2. Accepts only `chain_confirmed`, `mirror_syncing`, `sync_warning`, or `complete`.
  3. Validates ticket, event, transaction, network, and contract against the operation.
  4. Upserts the current Soroban ticket.
  5. Updates event `current_supply` and `status` from the current Soroban event.
  6. Preserves immutable receipt facts.
  7. Sets the operation to `complete` and clears synchronization errors.
  8. Returns idempotently for repeated finalization.

  Security changes:

  - Drop every `anon`/`authenticated` ticket `INSERT` policy and revoke their `INSERT` grant.
  - Prevent browser updates to `events.current_supply` and `events.status`; organizer event changes continue through `event-publication`.
  - Revoke direct browser reads of `purchase_operations` and `purchase_operation_attempts`.
  - Return pending operations and receipts only through owner-checking purchase-operation actions.
  - Grant finalizer execution only to `service_role`.
  - Preserve unrelated ticket updates used by existing refund, scanner, and marketplace flows.

  Do not add reconciliation tables, marketplace migrations, another receipt table, global RLS redesign, or destructive cleanup.

  ### 3. Extend `purchase-operation`

  Add:

  - Post-confirmation ticket synchronization.
  - `retry-purchase-sync(operationId)`.
  - `list-pending-sync`, returning only the caller’s `chain_confirmed`, `mirror_syncing`, or `sync_warning` operations.
  - Existing owner-checked receipt retrieval.

  Synchronization:

  1. Load the caller-owned, chain-confirmed operation.
  2. Set `mirror_syncing`.
  3. Read `get_ticket(reserved_ticket_id)` and `get_event(event_id)` from the configured TicketContract.
  4. Require the current ticket’s event to match the operation.
  5. Call the atomic finalizer.
  6. Return `complete`, or retain confirmed receipt facts and return `sync_warning`.

  The current ticket constructs the present mirror. Historical purchase validity continues to come from the immutable Phase 3 `tk_buy` proof, even after
  use, refund, or transfer.

  ### 4. Restore My Tickets and routes

  My Tickets:

  1. Call `get_my_tickets()` immediately.
  2. Render available rows without waiting for Stellar.
  3. Call `list-pending-sync`.
  4. Retry at most the ten newest pending operations once per mount.
  5. Reload tickets after successful repairs.
  6. Show explicit retry for remaining delays.

  Do not inspect completed history, expose private tables, continuously poll Stellar, or add a worker or queue.

  For `/tickets/:ticketId`:

  1. Call `get_my_ticket(ticketId)`.
  2. If absent, retrieve the caller-owned confirmed operation for that known ticket.
  3. Retry synchronization once when pending.
  4. Retry `get_my_ticket`.
  5. If still absent, call the existing `getTicket()` adapter once.
  6. Require current on-chain ownership by the restored attendee wallet.
  7. Render using the receipt snapshot or published event metadata.

  Use Upcoming/Past grouping, General Admission wording, real event details, View ticket, calendar actions, receipt links, and durable refresh behavior.

  ### 5. Harden QR generation

  - Preserve Dfns `signMessage` and the existing QR format.
  - Before the first signature, read the current ticket through the Soroban adapter.
  - Require the restored wallet to be the owner and the ticket to be `Active`.
  - Reject wrong-owner, Used, and Refunded tickets.
  - Revalidate on page focus and explicit refresh, without continuous chain polling.
  - Continue 30-second QR rotation after validation.
  - Do not redesign the scanner.

  ### 6. Finish code and documentation

  Before running any test or build:

  - Complete the migration, Edge Function, frontend adapter, hooks, pages, routing behavior, and QR changes.
  - Remove only obsolete purchase-specific mirror code.
  - Update schema documentation, architecture, handbook, README, changelog, and Slice 1 completion records.
  - Prepare conditional deployment commands and environment documentation.
  - Perform a final static source review for incomplete call sites and browser writes.

  ## Testing And Deployment

  1. Run focused SQL/RLS checks:
     - ticket insertion denied;
     - chain-owned event updates denied;
  2. Run focused frontend and service tests:
     - unresolved duplicate convergence;
     - intentional later checkout;
     - synchronization success/failure/retry;
     - direct ticket fallback;
  4. Run lint, type-check, production build, and relevant contract checks once.
  5. Inspect configured Testnet contracts using ordinary CLI/RPC reads and a focused cutoff behavior check.
  6. Redeploy contracts only if IDs, stored peers/configuration, or cutoff behavior are wrong.
  7. Apply the migration and deploy the Edge Function/frontend.
  8. Run the complete Testnet journey: authenticate, restore wallet, fund, buy once, survive uncertainty, reopen receipt, force and repair `sync_warning`,
  ## Assumptions

  - All implementation work precedes every test, build, lint, deployment check, and smoke run.
  - No one-ticket-per-user or one-ticket-per-event restriction exists.
  - The purchase-operation service remains the only purchase authority.