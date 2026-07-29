# StellarTickets — Minimum-Change Frontend Correction Plan

## Objective

Complete the confirmed product corrections using the smallest changes to the current implementation.

This is a Vite React 19 Stellar Level 5 hackathon MVP. Improve existing flows; do not redesign the architecture or create generalized infrastructure.

## Implementation constraints

1. Read the root and frontend `AGENTS.md` files before editing.
2. Preserve these existing systems:

   * `purchaseOperations.ts`
   * `ticketOperations.ts`
   * `useTicketOperationRecovery.ts`
   * `authIntent.ts`
   * Organizer draft/publication recovery
   * Scanner and organizer-event operation recovery
3. Do not add:

   * New contracts or contract states
   * New operation tables or migrations
   * Another Edge Function for ticket operations
   * Background workers, queues, schedulers, or polling services
   * A generic workflow engine
   * A new error-handling framework
   * A modal library or design-system rewrite
4. View the screenshots in - screenshots\ui-refinement\2026-07-27 for reference
5. Prefer frontend-only changes. Modify Supabase or Edge Functions only if a concrete defect is found in the existing ticket-operation implementation.
6. Avoid unrelated refactoring, file renaming, dependency changes, and component rewrites.
7. Do not run broad tests, builds, or screenshot suites unless verification is requested separately.

---

## 1. Preserve the existing ticket-operation recovery

The repository already provides durable operations for:

* Refund
* Create listing
* Cancel listing
* Buy listing

Do not rebuild this system.

Inspect the existing implementation only to ensure the affected pages continue using it. Any discovered defect must be fixed inside the current operation path rather than by introducing another recovery authority.

Expected touch area:

* `frontend/src/lib/ticketOperations.ts`
* `frontend/src/hooks/useTicketOperationRecovery.ts`
* `frontend/src/pages/MyTicketsPage.tsx`
* `frontend/src/pages/MarketplacePage.tsx`

---

## 2. Clarify preview and live event status

Keep Supabase preview discovery and the existing authoritative event read.

Make only presentation changes:

* Browse must indicate that card availability is preview information and is confirmed on the event page.
* Event Detail and Checkout must say **Live sale status could not be verified** when the authoritative read fails.
* Do not present a read failure as sold out, cancelled, ended, or otherwise unavailable.
* Continue blocking purchase until the live read succeeds.
* Do not add another event state model or backend read path.

Use the existing `authority` field and `deriveEventSalesState()` behavior.

---

## 3. Correct shared button states

Update the existing shared `Button` component:

* Disabled buttons must lose hover, active-scale, strong shadow, and primary emphasis.
* Add `cursor-not-allowed`.
* Add a visible keyboard-focus style.
* Where a transaction cannot proceed, use the existing page state to show a short reason-specific label.

Do not build a new button system or replace existing page controls solely for visual consistency.

---

## 4. Add one marketplace purchase review step

Add a compact local review surface before wallet approval.

It must show:

* Event name and date
* `1 × General Admission`
* Seller
* Ask price
* Estimated network fee
* Total expected debit
* A short statement that ownership transfers on-chain

Use the existing ticket-operation `review` state and existing `prepareBuyListing()` simulation.

Adjust the current helper only as much as required to pause between transaction preparation and wallet signing. Allocation, signed-hash persistence, submission, resolution, and synchronization must remain in the existing ticket-operation path.

Do not add:

* A new marketplace checkout route
* A second purchase-operation system
* A reservation mechanism
* New database states or tables

---

## 5. Sanitize displayed operational errors

Reuse the contract-error mappings already present in `soroban.ts`.

For RPC, wallet-provider, SDK, authentication, decoding, and database failures, add one small frontend formatter or local mappings for the known user-facing cases.

Primary UI should use messages such as:

* Could not verify the event
* Network connection failed
* Wallet request was rejected
* Transaction status is still being checked
* Ticket synchronization is delayed
* Sign-in could not be completed

Raw details may remain in development logging but must not appear in `TxOverlay`, scanner results, authentication screens, or attendee transaction surfaces.

Do not introduce custom error classes, telemetry infrastructure, or a logging service.

---

## 6. Keep listed tickets usable until sold

Use the rule already implied by the contract:

> A listing does not lock the ticket. The current owner may use it until ownership is transferred.

Make My Tickets consistent with Ticket Detail and the direct QR route:

* An open listing must not hide the **Show QR** action.
* Show both **Show QR** and **Cancel listing**.
* Add restrained copy such as **Listed for sale — remains valid until sold**.
* After a sale, the existing QR ownership revalidation must stop generating a valid QR.

Do not add a `Listed` on-chain ticket state or another listing-authority system.

---

## 7. Add useful identity to the QR page

Reuse the ticket already verified by `getTicket()` and the existing event hooks.

Show above the QR:

* Event name
* Date
* Venue
* General Admission
* Current ticket validity

Truncate the attendee wallet by default and provide copy or reveal only if useful.

Do not add another ticket endpoint or duplicate ticket-loading flow.

---

## 8. Apply small recovery and shell corrections

Make these narrow changes:

* Receipt:

  * Use **Your purchase is confirmed** while ticket synchronization is pending.
  * Use **Your ticket is ready** only at `complete`.
  * Add **Total debited** using the existing amount and fee.
* Authentication:

  * Explain the saved action or destination using the existing auth intent.
  * Add safe callback wording and **Return to sign in**.
  * Preserve the current return-intent implementation.
* Wrong organizer wallet:

  * Add **Switch wallet** or **Reconnect wallet** using the existing connection function.
* Testnet indicator:

  * Move it into reserved shell space.
  * Remove the duplicate checkout notice.
* Overlays:

  * Add dialog semantics, initial focus, focus return, and safe Escape handling directly to the existing overlays.
  * Use a tiny shared focus helper only if necessary; do not add a modal package.

---

## 9. Apply only the confirmed small polish

* Change **Restore signing on this device** when the wallet is already ready.
* Display draft state `prepared` as **Draft** or **Ready to edit**.
* Add a visible **Continue editing** action to draft cards.
* Add a simple **Organizer Hub** link on organizer subpages.
* Add **Go back** and **Browse events** to the not-found page.
* Shorten hashes, IDs, and wallet addresses visually while preserving access to the full value.
* Replace capture-only fixture wording with credible event content.

Do not build an organizer workspace expansion, a route-specific error framework, or new product sections.

---

## 10. Screenshot completion

After the implementation is separately approved for verification:

* Regenerate only the affected screenshot cases.
* Accept a screenshot only when its existing manifest assertion passes.
* Reject loading, blank, stale, or error captures for declared ready states.
* Do not expand the screenshot catalogue unless a changed user state genuinely requires a new capture.

## Definition of done

The correction pass is complete when:

1. Existing ticket-operation recovery remains the only authority for resale, cancellation, listing, and refund recovery.
2. Preview information and live sale verification are visibly distinct.
3. Disabled transaction controls cannot appear enabled.
4. Marketplace buyers review the entitlement and total before wallet signing.
5. Core screens expose no raw infrastructure errors.
6. Listed tickets remain usable until sold and QR ownership is revalidated.
7. The QR screen identifies the event and ticket.
8. Receipt wording matches synchronization state.
9. Authentication and wrong-wallet failures provide direct recovery.
10. The Testnet indicator and overlays do not obstruct or trap users incorrectly.
11. No new infrastructure was added without a demonstrated need.
