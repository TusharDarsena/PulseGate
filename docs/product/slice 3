# Product Slice 3: Reliable Venue Check-in

> An organizer can admit the correct ticket holder to the correct event within the permitted entry window, with authoritative Stellar confirmation, duplicate protection, and safe recovery after interruption.

## 1. Repository-grounded verdict

**Approve with required changes.**

The current scanner is routed under an event URL, but `ScannerPage` does not read or validate that route’s `eventId`. It starts the camera immediately, uses one generic error state, directly calls `markUsed`, directly writes `Used` to Supabase, includes dead Start/Flash controls, and falls back to a fabricated attendee name and stock portrait.

The current contract verifies the ticket’s actual organizer, but `mark_used(ticket_id, organizer)` does not receive the event being scanned, and it does not enforce an opening or closing time. An organizer who owns multiple events therefore has no contract-level expected-event boundary, while an `Active` event can continue accepting check-ins after its end until it is manually completed.

The repository already has the correct durability pattern for organizer transactions: prepare through generated bindings, persist the signed transaction hash before submission, distinguish unknown submission from failure, verify exact contract events, and synchronize mirrors afterward. Slice 3 should reuse that pattern without adding a generic workflow engine or overloading the existing event-level cancellation/completion lock.

### Required corrections

1. **The contract must receive and verify the expected event.**
   Add the expected `event_id` to `mark_used`. The contract must reject a ticket whose immutable `ticket.event_id` differs from it.

   **Classification:** Must fix.

2. **Check-in time must be enforced on-chain.**
   UI timing alone cannot authorize entry. The same contract call that marks the ticket `Used` must reject early and late submissions.

   **Classification:** Must fix.

3. **Check-in needs its own ticket-level operation owner.**
   Do not add check-ins to the existing `organizer_event_operations` event lock: that lock intentionally permits only one unresolved cancellation or completion per event and would serialize unrelated door scans. Create one narrow check-in lifecycle keyed by ticket.

   **Classification:** Must fix.

4. **RPC failure must not look like an invalid ticket.**
   The current `getTicket` wrapper returns `null` for transport failure and nonexistence alike. The scanner needs a read boundary that distinguishes `not_found` from `unavailable`.

   **Classification:** Must fix.

5. **Used-mirror writes must leave the browser.**
   Remove `mirrorUsedTicket()` from the scanner. Only a trusted finalizer may set the mirrored status to `Used`, after verifying the exact successful transaction and current contract state.

   **Classification:** Must fix.

6. **Remove unsupported presentation.**
   No stock avatar, “Anonymous Attendee,” fabricated ticket tier, fake access category, or control without real behavior should remain.

   **Classification:** Simplify.

The plan correctly preserves the rotating signed QR, local signature verification, Soroban authority, mobile responsiveness, limited statistics, and explicit exclusion of staff roles, offline entry, overrides, and a replacement QR system. Those decisions should remain. The architecture already states that Supabase cannot authorize entry and that success must follow an authoritative chain result.

---

## 2. Decisions to lock before implementation

### Decision 1: Check-in is event-scoped through every layer

**At present**

The route contains `eventId`, but the scanner ignores it. The contract derives the ticket’s event without knowing which event the scanner expected.

**Final model**

A check-in operation is identified by:

* authenticated organizer account;
* configured Stellar network and TicketContract;
* route event ID;
* ticket ID;
* authoritative organizer wallet.

**Final behavior**

* Human ownership is established through the existing owner-derived published-event lookup.
* The scanner loads the event from Stellar and compares its organizer with the published ownership record.
* The connected Freighter address must equal the authoritative event organizer.
* The camera remains disabled until all three checks succeed.
* `mark_used` receives `event_id`, `ticket_id`, and `organizer`.
* The contract rejects `ticket.event_id != event_id`.
* Supabase event ownership, ticket status, or route parameters alone never authorize entry.

**Why this prevents rework**

Statistics, recovery, device concurrency, wallet rejection, and result history all require one stable event identity. Fixing it only in the UI would leave the backend and contract operating under a different model.

### Decision 2: Use one fixed MVP check-in window

**Final policy**

Check-in opens **two hours before the authoritative event start** and closes **at the authoritative event end**.

The permitted interval is:

`event start − 2 hours ≤ ledger timestamp < event end`

**Final behavior**

* Before opening: scanner page is visible, but the camera and submission controls are disabled.
* At the opening timestamp: scanning becomes available.
* At the end timestamp: no new check-in transaction may succeed.
* Cancelled or completed events never permit check-in.
* The UI displays the same derived opening and closing times in the event timezone.
* The contract is the final enforcement point.
* There is no per-event door-time setting in this slice.

**Why this prevents rework**

This gives venues useful pre-start admission without changing the stored `Event` structure or migrating existing event records. Configurable door schedules would require a separate contract and publishing-model decision.

### Decision 3: One durable operation per ticket

A new `check_in_operation` owns the lifecycle of marking one ticket used.

* Business uniqueness: network + TicketContract + ticket ID.
* The immutable ticket event must match the operation event.
* Repeated allocation from another tab or device returns the same operation.
* Pre-submission failure may start a replacement attempt.
* Once a signed hash is persisted, no replacement transaction is allowed until non-submission or authoritative failure is proven.
* Chain-confirmed operations may retry synchronization only.
* No queue, background worker, continuous indexer, or generic workflow framework is required.

### Decision 4: Result labels describe different facts

* **Wrong wallet** means the connected organizer Freighter address is not the event organizer.
* **Transferred** means the QR signature is valid, but the QR wallet is no longer the ticket’s current on-chain owner.
* **Invalid QR** means the payload is malformed or its signature does not match its claimed wallet.
* **Status unknown** means current authoritative state or a possibly submitted transaction cannot yet be resolved.

These must never be collapsed into a generic “Invalid ticket” message.

---

## 3. Final happy-path experience

1. The organizer opens `/organizer/events/:eventId/check-in`.

2. The page verifies:

   * the signed-in account owns the published event;
   * the event exists on the configured TicketContract;
   * the published and on-chain organizers match;
   * the connected Freighter wallet is the exact organizer wallet;
   * the event is active and within its check-in window.

3. The page shows:

   * event name and venue;
   * opening and closing times;
   * sold, checked-in, remaining, and unresolved counts;
   * a real **Enable camera** button.

4. Camera permission is requested only after the organizer presses the button. The rear camera is preferred where available.

5. After decoding a QR, the camera pauses. The scanner separately verifies:

   * payload structure;
   * timestamp age;
   * Ed25519 signature;
   * ticket existence;
   * expected event;
   * ticket status;
   * current owner.

6. Only an eligible ticket allocates a durable check-in operation. Invalid, expired, wrong-event, refunded, used, or transferred tickets never open Freighter.

7. The transaction is prepared through the existing generated-binding adapter. Its source, sequence, expiration, and unsigned identity are attached to the operation.

8. Freighter requests organizer approval. The signed transaction hash must be durably recorded before submission is allowed.

9. The service resolves the exact transaction and `tk_used` event, confirms the transaction source, and rereads the ticket and event from the configured contract.

10. As soon as authoritative success is proven, the page displays:

**Entry confirmed**

This remains a valid entry result even when the Supabase mirror is still synchronizing.

11. A trusted finalizer updates the ticket mirror and provenance. The scanner then refreshes statistics and offers **Scan next ticket**.

12. Refreshing or reopening the route restores unresolved operations. It never silently starts a second `mark_used` transaction.

---

## 4. Event and permission states

| Condition                            | Scanner display            | Permitted action                                     |
| ------------------------------------ | -------------------------- | ---------------------------------------------------- |
| Ownership loading                    | Verifying organizer access | None                                                 |
| Signed-in account does not own event | Event unavailable          | Return to organizer events                           |
| Chain event unavailable              | Event status unavailable   | Retry authoritative read                             |
| Freighter disconnected               | Organizer wallet required  | Connect Freighter                                    |
| Wrong Freighter address              | Wrong organizer wallet     | Switch to the displayed organizer address            |
| Before opening                       | Check-in opens at [time]   | Wait; camera disabled                                |
| Active and within window             | Ready for check-in         | Enable camera                                        |
| Event cancelled                      | Event cancelled            | No scanning                                          |
| Event completed                      | Event completed            | No scanning                                          |
| At or after event end                | Check-in closed            | No scanning                                          |
| Camera permission denied             | Camera access blocked      | Retry permission or follow browser settings guidance |
| No supported camera                  | Camera unavailable         | Use another supported device                         |
| Camera running                       | Scan a ticket for [event]  | Scan QR                                              |

The organizer management page must disable **Open scanner** when authoritative ownership is unavailable and explain why. It may still link to a read-only closed scanner after the window ends so statistics and history remain accessible.

---

## 5. Scan results

| Result             | Authoritative condition                           | Visible response                             | Next action                                         |
| ------------------ | ------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| Valid              | Successful `mark_used` proven                     | Entry confirmed                              | Scan next                                           |
| Expired            | QR age is outside the existing `<45s` requirement | QR expired                                   | Ask attendee to refresh QR                          |
| Invalid QR         | Malformed payload or invalid signature            | QR could not be verified                     | Scan refreshed QR                                   |
| Ticket not found   | Contract definitively returns no ticket           | Ticket not found                             | Check attendee’s ticket                             |
| Wrong event        | Ticket event differs from route event             | Ticket belongs to another event              | Do not admit                                        |
| Transferred        | Ticket owner differs from QR wallet               | Ticket has been transferred                  | Current owner must show their QR                    |
| Refunded           | On-chain status is `Refunded`                     | Ticket was refunded                          | Do not admit                                        |
| Already used       | On-chain status is `Used`                         | Ticket already checked in                    | Show confirmed time when known                      |
| Wrong wallet       | Freighter differs from event organizer            | Switch organizer wallet                      | Reconnect correct wallet                            |
| Status unavailable | Pre-submission contract read failed               | Ticket status unavailable                    | Retry read; no transaction exists                   |
| Status unknown     | A signed transaction may have been submitted      | Check-in status unknown                      | Resolve existing operation; do not rescan           |
| Chain failed       | Authoritative transaction failure proven          | Check-in failed                              | Re-read ticket and use a fresh QR if still eligible |
| Sync warning       | Entry is chain-confirmed but mirror update failed | Entry confirmed; app synchronization delayed | Scan next; retry mirror separately                  |

The existing QR payload order, signature system, 30-second rotation, and absolute 45-second age rule remain unchanged. Only the verifier’s return type changes so it can report the reason instead of returning one undifferentiated `null`.

---

## 6. Check-in operation state model

| State                       | Meaning                                                        | User experience                             |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `review`                    | Operation allocated; no transaction prepared                   | Preparing check-in                          |
| `approval_required`         | Simulated transaction recorded; no signed hash                 | Waiting for Freighter approval              |
| `pre_submission_failed`     | No transaction could have been submitted                       | Safe to retry with fresh QR                 |
| `signed_submission_pending` | Signed hash persisted; submission outcome unresolved           | Confirming with Stellar                     |
| `confirmation_pending`      | Submission accepted but final transaction unavailable          | Confirming with Stellar                     |
| `status_unknown`            | Submission may have occurred; authoritative result unavailable | Do not rescan; resolve existing operation   |
| `chain_failed`              | Authoritative failure proven                                   | Safe to re-evaluate and retry when eligible |
| `chain_confirmed`           | Exact successful `tk_used` proof found                         | Entry confirmed                             |
| `mirror_syncing`            | Ticket mirror finalization in progress                         | Entry confirmed                             |
| `sync_warning`              | Chain succeeded; mirror finalization failed                    | Entry confirmed with sync warning           |
| `complete`                  | Chain proof and mirror are synchronized                        | Entry confirmed                             |

Two devices scanning the same ticket must receive the same active operation. Only one may proceed to a signed attempt.

An `approval_required` operation with no signed hash can be expired and returned to `pre_submission_failed`. A `status_unknown` operation cannot be replaced merely because the QR has expired.

---

## 7. Contract and authority changes

### TicketContract

Change the public check-in entrypoint to include the expected event.

The contract must:

1. authenticate the supplied organizer;
2. load the expected event;
3. verify that event’s stored organizer;
4. require `Active` event status;
5. enforce the fixed opening and closing timestamps;
6. load the ticket;
7. require the ticket’s event to equal the expected event;
8. return distinct errors for `Used` and `Refunded`;
9. write `Used`;
10. emit `tk_used`.

Append stable error variants rather than renumbering existing codes:

* `TicketRefunded`
* `TicketWrongEvent`
* `CheckInNotOpen`
* `CheckInClosed`

The event and ticket storage shapes do not change.

### Trusted check-in verification

The service must verify:

* authenticated ownership of the published event;
* configured network and contract;
* expected organizer address;
* exact transaction hash;
* transaction source equals expected organizer;
* successful `tk_used` event for the exact ticket;
* current ticket event equals the operation event;
* current ticket status is `Used`;
* current event organizer equals the operation organizer;
* positive ledger sequence and close time.

A successful `tk_used` transaction remains valid historical proof even if the ticket mirror is unavailable.

---

## 8. Minimum data and authority contract

### Authoritative on-chain data

* event ID;
* event organizer;
* event start and end;
* event status;
* ticket ID;
* ticket event;
* ticket owner;
* ticket status;
* successful transaction and `tk_used` proof.

### Private check-in operation data

* operation ID and authenticated user ID;
* network and TicketContract ID;
* event ID and ticket ID;
* expected organizer and expected ticket owner;
* operation state;
* unsigned envelope identity;
* signed transaction hash;
* source sequence and transaction expiration;
* verified transaction hash, ledger, and close time;
* failure category and detail;
* confirmation and synchronization timestamps.

The full QR payload and signature do not need to be stored.

### Trusted ticket mirror fields

The finalizer records:

* `status = Used`;
* check-in operation ID;
* check-in transaction hash;
* verified ledger;
* verified timestamp.

Authenticated browser clients must be prevented from setting a ticket to `Used`. Existing refund and resale synchronization must not be broken by that restriction.

### Display-only data

* event name and venue;
* formatted times;
* shortened wallet and ticket IDs;
* optional genuine profile name, if retained.

Display metadata, attendee profiles, avatars, and Supabase ticket status never authorize entry.

---

## 9. Statistics

The scanner and organizer event page show:

* **Sold:** current authoritative `event.current_supply`.
* **Checked in:** distinct ticket IDs whose check-in operation is in `chain_confirmed`, `mirror_syncing`, `sync_warning`, or `complete`.
* **Remaining:** `max(sold − checked in, 0)`.
* **Unresolved:** distinct ticket IDs in `signed_submission_pending`, `confirmation_pending`, or `status_unknown`.

A mirror synchronization warning still counts as checked in because Stellar success is already proven.

Do not create a continuously maintained aggregate table or analytics worker. Counts can be derived from the bounded operation records, while sold supply is refreshed from Stellar.

Do not manufacture check-in operations from old `tickets.status = Used` rows. Any legacy Used row without check-in proof must be excluded from verified statistics and identified during migration or deployment validation.

---

## 10. Work packages

### Package A — Contract-enforced admission boundary

**Final state**

The contract rejects wrong-event, early, late, refunded, used, inactive-event, and wrong-organizer attempts with distinct outcomes.

**Dependencies and implications**

Contract tests, generated bindings, the handwritten Soroban adapter, error mappings, deployment IDs, and architecture documentation change together.

**Completion boundary**

No client can successfully call `mark_used` outside the expected event and time window.

### Package B — Recoverable check-in operation

**Final state**

Each eligible ticket has one durable operation that survives refresh, tab closure, RPC timeout, and a second scanning device.

**Dependencies and implications**

One ordered migration, one narrow check-in service, owner-derived reads, transaction-event verification, and a trusted finalizer. Reuse the current prepared organizer-transaction and shared Stellar verification patterns.

**Completion boundary**

After a signed hash exists, no path can submit a replacement until the first attempt is definitively resolved.

### Package C — Event-scoped mobile scanner

**Final state**

The organizer sees a real permission and wallet gate, enables the camera deliberately, receives precise results, and can scan the next ticket without stale state.

**Dependencies and implications**

The route remains unchanged, but `ScannerPage` consumes `eventId`, restores operations, and removes the direct mirror write, profile fallback, dead controls, and generic error overlay.

**Completion boundary**

Every visible control works, every visible state corresponds to real system state, and no success appears before chain confirmation.

### Package D — Door statistics and operational recovery

**Final state**

The organizer can see attendance progress and locate unresolved check-ins from the scanner or event management route.

**Dependencies and implications**

Owner-scoped count queries, chain supply refresh, operation restoration, and sync-only retry.

**Completion boundary**

Statistics remain truthful during RPC failure, mirror failure, refresh, and two-device scans.

---

## 11. Explicitly out of scope

* staff accounts, delegated scanner roles, or multiple permission levels;
* offline QR validation or offline admission;
* manual entry approval or contract-state overrides;
* attendee search or manual ticket-ID entry;
* configurable door-opening schedules;
* re-entry or multiple-use tickets;
* ticket tiers, seating, access zones, or guest counts;
* attendee messaging;
* advanced analytics or attendance charts;
* replacement QR formats;
* background queues, continuous indexers, or generic workflow infrastructure.

This remains proportionate to the hackathon requirement for a complete mobile-responsive dApp with truthful loading, errors, tests, and production-style architecture without introducing enterprise infrastructure.

---

## 12. Corrected implementation order

1. Add contract event/time/status guards and focused Rust tests.
2. Regenerate TicketContract bindings and update error translation.
3. Add the check-in operation migration, uniqueness rules, trusted finalizer, and owner-scoped reads.
4. Extend the shared transaction-event verifier for exact `tk_used` resolution.
5. Add a prepared `mark_used` transaction wrapper using the existing pre-submission hash-recording boundary.
6. Replace the scanner’s direct flow with owner, wallet, event, QR, ticket, and operation states.
7. Remove browser `Used` writes, fake profile content, and dead controls.
8. Add verified statistics and unresolved-operation recovery.
9. Run focused frontend, service, contract, mobile-device, and two-device tests.
10. Update architecture, agent coupling notes, deployment artifacts, and demo evidence.

---

## 13. Definition of done

### Contract authority

* Wrong-event tickets are rejected on-chain.
* Check-in before opening and at or after closing is rejected on-chain.
* Used and refunded tickets return different outcomes.
* Wrong organizer and inactive-event checks remain enforced.
* Existing error numbers are not renumbered.
* Generated bindings come from the updated WASM.

### Organizer access

* Direct navigation by a non-owner exposes no event or ticket information.
* Camera access is not requested before event ownership is verified.
* Disconnected and incorrect Freighter wallets cannot begin scanning.
* The expected organizer wallet is clearly displayed.

### Scanner behavior

* Valid, expired, invalid, wrong-event, transferred, refunded, already-used, wrong-wallet, unavailable, and unknown outcomes are distinguishable.
* No fabricated name, avatar, tier, or access class appears.
* Start camera, retry camera, scan next, connect wallet, and resolve operation controls perform real actions.
* Camera denial and unavailable-camera states are usable on mobile.
* Backgrounding or refreshing the page does not create duplicate submission.

### Transaction recovery

* The signed hash is persisted before submission.
* RPC timeout after signing results in `status_unknown`, not ordinary failure.
* `status_unknown` disables resubmission.
* Proven pre-submission failure permits a new attempt.
* Chain confirmation grants entry before mirror synchronization.
* Mirror retry never calls `mark_used` again.
* Two devices scanning the same ticket cannot create two active operations.

### Statistics

* Sold comes from an authoritative event read.
* Checked-in counts chain-success operations, including sync warnings.
* Remaining never becomes negative.
* Unresolved reflects only potentially submitted, unconfirmed operations.
* Legacy unproven Used rows are not silently counted.

### Verification scenarios

The completed slice is demonstrated with:

* mobile rear-camera permission granted;
* camera permission denied and retried;
* page refresh during confirmation;
* two devices scanning the same QR;
* wrong organizer Freighter wallet;
* QR expiry;
* ticket from another event;
* ticket transferred after QR generation;
* refunded ticket;
* already-used ticket;
* RPC timeout after signed-hash persistence;
* chain rejection before success;
* mirror finalizer failure followed by sync-only repair.

# Approval condition

Implementation may begin when the plan preserves the dedicated ticket-level operation owner, contract-level event and time enforcement, and the fixed two-hour opening policy. Removing any of those three would reopen the main correctness gap.
