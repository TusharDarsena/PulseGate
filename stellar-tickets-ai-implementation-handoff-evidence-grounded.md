# StellarTickets — Evidence-Grounded AI Implementation Handoff

## Purpose

Use this document as the product-correction authority for the current StellarTickets frontend.

The project is a Vite React 19 Stellar Level 5 hackathon MVP. Fix the confirmed product and reliability problems below without replacing working recovery systems or expanding the product into an enterprise architecture.

This handoff preserves the meaningful findings from the screenshot audit and the later frontend-code review. It removes unsupported assumptions, but retains smaller confirmed issues so they are not lost.

## Path conventions

- Code paths are relative to the repository root.
- In the supplied evidence bundle, the extracted repository is under `repo/`.
- Screenshot links are relative to this Markdown file and open the exact reviewed capture.
- Line ranges refer to the reviewed ZIP snapshot and may shift after edits.


Relevant code:

- `frontend/e2e/screenshots/capture-manifest.ts:50-65`
- `frontend/e2e/screenshots/capture-manifest.ts:68-92`
- `frontend/e2e/screenshots/capture-manifest.ts:152-182`
- `frontend/e2e/screenshots/capture.spec.ts:31-110`

---

# Existing Systems to Preserve

Do not replace or create competing authorities for these systems:

1. **Primary purchase operation recovery**
   - `frontend/src/lib/purchaseOperations.ts`
   - `frontend/src/pages/PurchasePage.tsx`
   - `frontend/src/pages/PurchaseReceiptPage.tsx`
   - `frontend/src/hooks/useTickets.ts`

2. **Authentication return intent**
   - `frontend/src/lib/authIntent.ts`
   - `frontend/src/App.tsx:35-79`
   - `frontend/src/pages/AuthPage.tsx`
   - `frontend/src/pages/AuthCallbackPage.tsx`

3. **Organizer draft and publication recovery**
   - `frontend/src/pages/organizer/CreateEventPage.tsx`
   - `frontend/src/pages/organizer/EventDraftPage.tsx`
   - Existing revision-conflict, offline-save, wallet-binding and publication-operation behavior

4. **Organizer event and scanner operation recovery**
   - `frontend/src/pages/organizer/OrganizerEventPage.tsx`
   - `frontend/src/pages/ScannerPage.tsx`
   - Existing uncertain-submission and synchronization recovery

5. **Contract ticket lifecycle**
   - Preserve contract states `Active`, `Used` and `Refunded`.
   - Do not invent additional on-chain ticket states solely to solve presentation rules.

---

# P0 — Required Before User Onboarding and Final Demo

## P0.1 Durable resale, cancellation and refund recovery

### Why this is required

Primary purchase and scanner operations have durable recovery. Marketplace purchase, listing cancellation and attendee refund do not. They submit irreversible chain actions and then rely on direct browser-side Supabase writes.

The latest migration revokes browser updates to `public.tickets`. Therefore a successful resale or refund can leave the application read model stale. `mirrorListingSale` also updates the listing before the ticket owner, allowing a partial state where the listing is `Sold` but ticket ownership remains stale.

### Code evidence

- `frontend/src/lib/readModelSync.ts:24-45`
- `frontend/src/lib/readModelSync.ts:48-103`
- `frontend/src/pages/MarketplacePage.tsx:36-78`
- `frontend/src/pages/MyTicketsPage.tsx:59-75`
- `frontend/src/pages/MyTicketsPage.tsx:84-170`
- `supabase/migrations/202607290001_slice_3_check_in_operations.sql:1-12`

### Related screenshots

The screenshots show the user-facing surfaces affected by stale synchronization, but this defect is established primarily by code:

- [Marketplace listings](screenshots/screenshots/02-tier-2-support-flow/marketplace/T2_marketplace_listings-loaded_desktop-1440x900_guest_seedA_v01.png)
- [My Tickets](screenshots/screenshots/01-tier-1-core-flow/my-tickets/T1_my-tickets_upcoming_mobile-390x844_attendee_seedA_v01.png)
- [Ticket detail](screenshots/screenshots/02-tier-2-support-flow/ticket-detail/T2_ticket-detail_ready_mobile-390x844_attendee_seedA_v01.png)

### Required behavior

- Persist an operation for marketplace purchase, listing cancellation and refund.
- Store the signed transaction hash before submission uncertainty can lose it.
- Verify the authoritative chain result.
- Synchronize through a trusted server or service-role path, not a browser write that current RLS rejects.
- Expose durable states equivalent to `pending`, `status_unknown`, `sync_warning` and `complete`.
- Retry synchronization without repeating payment, ownership transfer, cancellation or refund.
- Avoid multi-step read-model writes that can leave a partial result without a recovery owner.

### Done when

- A successful resale eventually appears correctly after refresh, sign-out or device change.
- A refunded ticket cannot remain indefinitely `Active` only because mirroring failed.
- A synchronization failure leaves a persistent receipt or recovery action.
- The UI never asks the user to repeat an already successful chain action.

---

## P0.2 Distinguish preview event status from confirmed live status

### Why this is required

Browse intentionally uses a fast Supabase preview. Event detail and checkout require a live Soroban read. The architecture is reasonable, but the UI presents preview availability too authoritatively.

A browse card can say **On sale** while detail says **Unavailable** because the live read failed. A transport or decoding failure is therefore presented like an event lifecycle state.

### Code evidence

- `frontend/src/hooks/useEvents.ts:27-49`
- `frontend/src/hooks/useEvent.ts:12-27`
- `frontend/src/lib/eventModel.ts:35-50`
- `frontend/src/pages/BrowsePage.tsx:148`
- `frontend/src/pages/EventDetailPage.tsx:39`
- `frontend/src/pages/PurchasePage.tsx:279`
- `frontend/src/pages/PurchasePage.tsx:390-397`

### Screenshot evidence

- [Browse — preview shown as On sale](screenshots/screenshots/01-tier-1-core-flow/browse/T1_browse_ready_desktop-1440x900_guest_seedA_v01.png)
- [Event detail — generic Unavailable state](screenshots/screenshots/01-tier-1-core-flow/event-detail/T1_event-detail_mobile-390x844_guest_seedA_v01.png.png)
- [Checkout — sale unavailable while payment CTA remains visually strong](screenshots/screenshots/01-tier-1-core-flow/purchase/T1_purchase_review-ready_mobile-390x844_attendee_seedA_v01.png)

### Required behavior

- Keep Supabase preview discovery for speed.
- Do not label preview availability as equivalent to a current contract-confirmed sale state.
- Add restrained wording such as **Sale status confirmed on event page** or another clear preview cue.
- On live-read failure, use **Live sale status could not be verified** rather than lifecycle label **Unavailable**.
- Continue blocking checkout until the authoritative read succeeds.
- Keep true lifecycle states—sold out, ended, cancelled and not started—distinct from read failure.

### Done when

A user can tell whether an event is genuinely unavailable or whether the app simply could not verify its current chain state.

---

## P0.3 Make disabled transaction controls visually unmistakable

### Why this is required

`PurchasePage` correctly passes `disabled={paymentDisabled}`, but the shared `Button` component keeps its normal primary background, shadow and active transform. The control is technically disabled but looks executable.

### Code evidence

- `frontend/src/pages/PurchasePage.tsx:390-397`
- `frontend/src/pages/PurchasePage.tsx:472-525`
- `frontend/src/components/ui/Button.tsx:9-27`

### Screenshot evidence

- [Checkout — disabled payment state with active-looking CTA](screenshots/screenshots/01-tier-1-core-flow/purchase/T1_purchase_review-ready_mobile-390x844_attendee_seedA_v01.png)

### Required behavior

For the shared Button component:

- Reduce disabled emphasis.
- Remove hover brightness, active scale and action shadow while disabled.
- Use `cursor-not-allowed`.
- Add a visible keyboard-focus style for enabled buttons.
- Where useful, replace an impossible transactional label with a reason-specific label such as **Sale status unavailable** or **Checking wallet**.

### Done when

No disabled financial or destructive action can be mistaken for an enabled action on desktop or mobile.

---

## P0.4 Add marketplace review before wallet signing

### Why this is required

Marketplace cards show event name, date, seller and ask price. Clicking **Buy Now** revalidates the ticket and then begins the wallet transaction directly. Chain revalidation is good, but the buyer does not receive a final review of the exact entitlement and expected debit before signing.

### Code evidence

- `frontend/src/pages/MarketplacePage.tsx:36-78`
- `frontend/src/pages/MarketplacePage.tsx:186-245`
- `frontend/src/hooks/useListings.ts:50-83`

### Screenshot evidence

- [Marketplace listing cards](screenshots/screenshots/02-tier-2-support-flow/marketplace/T2_marketplace_listings-loaded_desktop-1440x900_guest_seedA_v01.png)

### Required behavior

Before opening the wallet prompt, show one compact confirmation surface containing:

- Event name and date
- Exact entitlement, for example `1 × General Admission`
- Seller
- Ask price
- Estimated network fee
- Total expected debit
- A concise statement that ownership transfer occurs on-chain

Keep the existing owner/status revalidation immediately before submission.

### Done when

The buyer knows exactly what will be purchased and the expected total debit before approving the wallet request.

---

## P0.5 Sanitize operational and infrastructure errors

### Why this is required

Raw Soroban, provider, SDK and database messages can reach core user surfaces. The scanner screenshot exposes `invalid encoded string`, and the same authority error can be rendered in more than one scanner panel. `TxOverlay` also renders `errorMessage` as raw monospace diagnostic text.

### Code evidence

- `frontend/src/hooks/useEvent.ts:17-26`
- `frontend/src/lib/soroban.ts:161-175`
- `frontend/src/pages/ScannerPage.tsx:427-465`
- `frontend/src/pages/ScannerPage.tsx:528-555`
- `frontend/src/components/ui/TxOverlay.tsx:43-52`
- `frontend/src/pages/AuthCallbackPage.tsx:10-30`

### Screenshot evidence

- [Scanner — raw decoding error](screenshots/screenshots/01-tier-1-core-flow/scanner/T1_qr-display_event-unavailable_mobile-390x844_attendee_seedA_v01.png.png)
- [Auth callback — provider-style error with no recovery](screenshots/screenshots/03-tier-3-edge-flow/auth-callback/T3_auth-callback_error_mobile-390x844_guest_seedA_v01.png)

### Required behavior

Map failures to a small task-focused vocabulary, for example:

- Could not verify the event
- Network connection failed
- Wallet request rejected
- Transaction result is still being checked
- Ticket synchronization is delayed
- Sign-in could not be completed

Keep raw detail in logging or an optional diagnostics disclosure. Do not put raw exceptions in the primary attendee, organizer, scanner or transaction UI.

### Done when

Core screens explain what the user can do next without exposing RPC, provider, decoding or database internals.

---

## P0.6 Make the Testnet indicator non-obstructive

### Why this is required

The global Testnet notice is fixed above the mobile bottom navigation even on routes where the bottom navigation is hidden. It can float over task content. Checkout also repeats the same disclosure inline.

### Code evidence

- `frontend/src/App.tsx:201-204`
- `frontend/src/components/layout/BottomNav.tsx:10-14`
- `frontend/src/pages/PurchasePage.tsx:478-480`

### Screenshot evidence

- [Checkout](screenshots/screenshots/01-tier-1-core-flow/purchase/T1_purchase_review-ready_mobile-390x844_attendee_seedA_v01.png)
- [Purchase receipt](screenshots/screenshots/01-tier-1-core-flow/purchase-receipt/T1_purchase-receipt_confirmed_mobile-390x844_attendee_seedA_v01.png)
- [Account](screenshots/screenshots/02-tier-2-support-flow/account/T2_account_wallet-ready_mobile-390x844_attendee_seedA_v01.png.png)
- [Attendee QR](screenshots/screenshots/02-tier-2-support-flow/qr-display/T2_qr-display_active_mobile-390x844_attendee_seedA_v01.png)
- [Scanner failure](screenshots/screenshots/01-tier-1-core-flow/scanner/T1_qr-display_event-unavailable_mobile-390x844_attendee_seedA_v01.png.png)

### Required behavior

- Keep Testnet status visible.
- Place it in reserved application-shell space or another non-overlapping location.
- Remove the duplicate checkout disclosure.
- Verify mobile routes with and without BottomNav.

### Done when

The indicator never covers wallet, scanner, QR, ticket, transaction or recovery controls at supported viewports.

---

## P0.7 Regenerate and validate submission screenshots

### Why this is required

The supplied event-detail, checkout and scanner captures do not match their current manifest ready-state assertions. An AI should not use those images as approved final product evidence merely because a file exists.

### Code evidence

- `frontend/e2e/screenshots/capture-manifest.ts:50-65`
- `frontend/e2e/screenshots/capture-manifest.ts:68-92`
- `frontend/e2e/screenshots/capture-manifest.ts:152-182`
- `frontend/e2e/screenshots/capture.spec.ts:31-110`

### Conflicting captures

- [Event detail capture](screenshots/screenshots/01-tier-1-core-flow/event-detail/T1_event-detail_mobile-390x844_guest_seedA_v01.png.png)
- [Checkout capture](screenshots/screenshots/01-tier-1-core-flow/purchase/T1_purchase_review-ready_mobile-390x844_attendee_seedA_v01.png)
- [Scanner capture](screenshots/screenshots/01-tier-1-core-flow/scanner/T1_qr-display_event-unavailable_mobile-390x844_attendee_seedA_v01.png.png)

### Required behavior

- Regenerate screenshots after product corrections.
- Accept a screenshot only after the manifest’s required heading, text and labels pass.
- Reject blank, loading, error or stale captures when the manifest declares a ready state.
- Use review-quality fixture content; do not publish seed descriptions, data URLs or obvious capture-only values in README, pitch deck or submission images.

### Done when

Every final screenshot can be traced to a passing capture assertion for the intended state.

---

# P1 — Important Product-Quality Corrections

## P1.1 Align receipt wording with synchronization state

### Confirmed behavior to preserve

The primary purchase architecture already separates chain confirmation from mirror completion, prevents a second payment, provides **Retry ticket sync**, and exposes **View ticket** only at `complete`.

### Code evidence

- `frontend/src/lib/purchaseOperations.ts:9-21`
- `frontend/src/pages/PurchasePage.tsx:360-390`
- `frontend/src/pages/PurchaseReceiptPage.tsx:16-21`
- `frontend/src/pages/PurchaseReceiptPage.tsx:70-84`
- `frontend/src/pages/PurchaseReceiptPage.tsx:131-155`
- `frontend/src/hooks/useTickets.ts:75-109`

### Screenshot evidence

- [Purchase receipt](screenshots/screenshots/01-tier-1-core-flow/purchase-receipt/T1_purchase-receipt_confirmed_mobile-390x844_attendee_seedA_v01.png)

### Required behavior

- During `chain_confirmed`, `mirror_syncing` or `sync_warning`, use **Your purchase is confirmed**.
- Show **Preparing your ticket library** or equivalent synchronization copy.
- Use **Your ticket is ready** only when the operation is `complete`.
- Keep the existing receipt, retry and no-second-payment behavior.

---

## P1.2 Decide and consistently enforce listed-ticket QR behavior

### Why this is required

My Tickets suppresses QR and resale actions when an open listing exists and instead shows **Cancel listing**. Direct Ticket Detail and QR routes do not query listing state, so the same chain-active ticket can still appear usable when opened directly.

The contract intentionally does not lock a listed ticket. The product must therefore choose and communicate an application rule rather than inventing a new contract state.

### Code evidence

- `frontend/src/components/tickets/TicketCard.tsx:78-114`
- `frontend/src/lib/eventModel.ts:17-18`
- `frontend/src/pages/TicketDetailPage.tsx:164-170`
- `frontend/src/pages/QRDisplayPage.tsx:20-25`

### Screenshot evidence

- [My Tickets — QR and resale entry points](screenshots/screenshots/01-tier-1-core-flow/my-tickets/T1_my-tickets_upcoming_mobile-390x844_attendee_seedA_v01.png)
- [Ticket detail](screenshots/screenshots/02-tier-2-support-flow/ticket-detail/T2_ticket-detail_ready_mobile-390x844_attendee_seedA_v01.png)
- [Active QR](screenshots/screenshots/02-tier-2-support-flow/qr-display/T2_qr-display_active_mobile-390x844_attendee_seedA_v01.png)

### Required decision

Choose one rule and apply it across all three routes:

1. **Usable until sold:** keep QR available while listed and clearly explain that successful resale transfers ownership immediately; or
2. **Listing suppresses entry use:** block QR consistently in My Tickets, Ticket Detail and direct QR routes until the listing is cancelled.

Do not add an on-chain ticket state only for this presentation rule.

---

## P1.3 Add human-readable identity to attendee QR

### Confirmed strengths to preserve

The QR page revalidates current chain ownership, requires an `Active` ticket, regenerates a signed QR every 30 seconds, revalidates on focus and supports manual refresh.

### Code evidence

- `frontend/src/pages/QRDisplayPage.tsx:20-91`
- `frontend/src/pages/QRDisplayPage.tsx:93-113`
- `frontend/src/lib/qr.ts`

### Screenshot evidence

- [Active attendee QR](screenshots/screenshots/02-tier-2-support-flow/qr-display/T2_qr-display_active_mobile-390x844_attendee_seedA_v01.png)

### Required behavior

Show compact identity above the QR:

- Event name
- Date
- Venue
- Ticket tier
- Current validity

The long attendee wallet value should truncate or wrap safely and offer copy/reveal if full provenance is needed.

---

## P1.4 Make authentication context-aware and recoverable

### Confirmed behavior to preserve

Protected routes save a validated, nonce-bound, time-limited return intent. Successful email or Google authentication returns the user to the intended route.

### Code evidence

- `frontend/src/App.tsx:35-79`
- `frontend/src/lib/authIntent.ts:20-88`
- `frontend/src/pages/AuthPage.tsx:14-69`
- `frontend/src/pages/AuthCallbackPage.tsx:10-30`

### Screenshot evidence

- [Default sign-in](screenshots/screenshots/03-tier-3-edge-flow/auth/T3_auth_default_mobile-390x844_guest_seedA_v01.png)
- [Auth callback failure](screenshots/screenshots/03-tier-3-edge-flow/auth-callback/T3_auth-callback_error_mobile-390x844_guest_seedA_v01.png)

### Required behavior

- Tell the user why sign-in is required and where they will return, using the saved action or route.
- Map provider errors to safe wording.
- Add **Try again** or **Return to sign in**.
- Preserve the pending intent on recoverable callback failure.

Do not replace the existing return-intent system.

---

## P1.5 Add dialog semantics and focus management to overlays

### Why this is required

The listing modal, transaction overlay and scanner result overlay are visually modal but lack explicit dialog semantics, focus entry/containment, focus return and safe Escape behavior. The shared Button also lacks a visible focus style.

### Code evidence

- `frontend/src/pages/MyTicketsPage.tsx:358-393`
- `frontend/src/components/ui/TxOverlay.tsx:7-56`
- `frontend/src/pages/ScannerPage.tsx:575-614`
- `frontend/src/components/ui/Button.tsx:9-27`

### Related screenshots

- [My Tickets — listing action entry point](screenshots/screenshots/01-tier-1-core-flow/my-tickets/T1_my-tickets_upcoming_mobile-390x844_attendee_seedA_v01.png)
- [Marketplace transaction surface context](screenshots/screenshots/02-tier-2-support-flow/marketplace/T2_marketplace_listings-loaded_desktop-1440x900_guest_seedA_v01.png)

### Required behavior

- Use appropriate dialog semantics.
- Move focus into the open surface.
- Keep focus inside while modal.
- Return focus to the initiating control on close.
- Support Escape only where cancellation is safe.
- Announce transaction and scan-result state changes.
- Verify with keyboard and screen-reader testing.

---

## P1.6 Improve wrong-wallet recovery without weakening authority checks

### Confirmed behavior to preserve

Organizer event access separately verifies account ownership and on-chain organizer authority. Terminal operations require the connected wallet to match the event organizer.

### Code evidence

- `frontend/src/pages/organizer/OrganizerEventPage.tsx:22-31`
- `frontend/src/pages/organizer/OrganizerEventPage.tsx:54-159`
- `frontend/src/pages/organizer/OrganizerEventPage.tsx:219-227`

### Screenshot evidence

- [Organizer event — wrong-wallet/unavailable state](screenshots/screenshots/01-tier-1-core-flow/organizer-event/T1_organizer-event_ready_desktop-1440x900_organizer_seedA_v01.png)

### Required behavior

Keep management actions blocked, but provide a direct **Reconnect wallet** or **Switch wallet** recovery action and retain event context around the error.

---

# P2 — Smaller Confirmed Corrections Worth Retaining

These are not release blockers, but they are real and should not disappear from the product backlog.

## P2.1 Account recovery wording

The Account page clearly separates account, attendee ticket wallet and organizer wallet. The remaining issue is that **Restore signing on this device** appears even when attendee-wallet readiness is already `ready`.

- Code: `frontend/src/pages/AccountPage.tsx:79-105`
- Screenshot: [Account wallet-ready state](screenshots/screenshots/02-tier-2-support-flow/account/T2_account_wallet-ready_mobile-390x844_attendee_seedA_v01.png.png)

Use a secondary device-management label such as **Recover this wallet on another device**, or show restoration only for `recovery_required`.

## P2.2 Organizer draft labels and continuation affordance

Organizer draft recovery is already strong. Remaining presentation corrections:

- Replace internal-facing `prepared` with **Draft** or **Ready to edit**.
- Add an explicit **Continue editing** action instead of relying only on whole-card clickability.

Code:

- `frontend/src/pages/organizer/DashboardPage.tsx:64-126`
- `frontend/src/components/organizer/OrganizerEventRow.tsx`

Screenshots:

- [Organizer dashboard](screenshots/screenshots/02-tier-2-support-flow/organizer-dashboard/T2_organizer-dashboard_populated_desktop-1440x900_organizer_seedA_v01.png)
- [Organizer draft](screenshots/screenshots/01-tier-1-core-flow/organizer-event-draft/T1_organizer-event-draft_ready_desktop-1440x900_organizer_seedA_v01.png)

## P2.3 Organizer navigation continuity

A full enterprise organizer workspace is unnecessary. Add a consistent **Organizer Hub** breadcrumb or link on draft, event and scanner pages and keep the current event name visible.

- Code: `frontend/src/components/layout/BottomNav.tsx:10-14`
- Code: organizer route pages under `frontend/src/pages/organizer/`
- Screenshot: [Organizer event](screenshots/screenshots/01-tier-1-core-flow/organizer-event/T1_organizer-event_ready_desktop-1440x900_organizer_seedA_v01.png)

## P2.4 Generic not-found recovery

The wildcard route displays only **Page not found**.

- Code: `frontend/src/App.tsx:195-199`
- Screenshot: [Not-found page](screenshots/screenshots/03-tier-3-edge-flow/not-found/T3_not-found_default_desktop-1440x900_guest_seedA_v01.png)

Add **Go back** and **Browse events**. Do not build a large route-specific error framework for this MVP.

## P2.5 Receipt total and technical-value hierarchy

Primary checkout already discloses ticket price, estimated network fee and total. The receipt reconciles those values, but an explicit **Total debited** line would improve scanning.

Ticket IDs, transaction hashes and wallet addresses are legitimate blockchain provenance. Do not remove them; shorten them by default and provide copy/reveal where useful.

- Code: `frontend/src/pages/PurchasePage.tsx:429-450`
- Code: `frontend/src/pages/PurchaseReceiptPage.tsx:105-134`
- Screenshot: [Purchase receipt](screenshots/screenshots/01-tier-1-core-flow/purchase-receipt/T1_purchase-receipt_confirmed_mobile-390x844_attendee_seedA_v01.png)

## P2.6 Review-quality fixture content

Seed IDs, deterministic-capture descriptions and `data:image` values originate in screenshot fixtures and do not prove production hardcoding. They still make the submission look unfinished.

- Code: `frontend/e2e/screenshots/fixtures/`
- Code: `frontend/e2e/screenshots/helpers/`
- Screenshots:
  - [Organizer draft fixture content](screenshots/screenshots/01-tier-1-core-flow/organizer-event-draft/T1_organizer-event-draft_ready_desktop-1440x900_organizer_seedA_v01.png)
  - [Organizer event fixture content](screenshots/screenshots/01-tier-1-core-flow/organizer-event/T1_organizer-event_ready_desktop-1440x900_organizer_seedA_v01.png)

Use credible event copy, valid image URLs and review-safe IDs in final captures.

---

# Do Not Reintroduce These Disproven Findings

The code review did not support the following claims. Do not create work for them unless new runtime evidence proves otherwise:

- Authentication loses the original destination.
- Primary purchase lacks durable synchronization recovery.
- Primary purchase allows a second payment while the first operation is unresolved.
- Organizer draft creation is unrecoverable or inherently duplicate-prone.
- Organizer publication can silently bind an unintended wallet.
- Same-name draft and marketplace screenshots prove one invalid event lifecycle.
- The attendee QR page prints the encoded QR payload as text; the overflowing value is the wallet public key.
- Every seed value in a screenshot proves production fixture leakage.
- The MVP needs a large enterprise ticket-state model.
- The organizer MVP needs a full Sales/Attendees/Settings workspace before release.
- Showing ticket IDs, transaction hashes or wallet addresses is automatically a UX defect.

---

# Recommended Implementation Order

1. Replace direct browser resale/refund mirroring with durable trusted reconciliation.
2. Correct preview-versus-confirmed event-state presentation.
3. Fix shared disabled and focus styles.
4. Add marketplace purchase review.
5. Centralize safe operational error mapping.
6. Move the Testnet indicator into non-obstructive shell space.
7. Apply receipt, listed-ticket and QR-context corrections.
8. Improve auth and wrong-wallet recovery.
9. Add modal focus behavior.
10. Apply P2 polish.
11. Regenerate and validate every submission screenshot.

---

# Final Definition of Done

The product-correction pass is complete when:

1. Resale, cancellation and refund can recover from read-model failure without repeating the chain action.
2. Browse clearly distinguishes preview availability from contract-confirmed availability.
3. Disabled transaction controls look disabled and enabled controls show keyboard focus.
4. Marketplace buyers review entitlement and total before wallet signing.
5. Core screens expose no raw RPC, SDK, provider or database errors.
6. The Testnet indicator never obstructs task content.
7. Receipt wording distinguishes confirmed purchase from ready ticket.
8. Listed-ticket QR behavior is consistent across My Tickets, Ticket Detail and direct QR routes.
9. Attendee QR visibly identifies the event and ticket and contains long technical values safely.
10. Authentication failures preserve intent and provide a direct recovery action.
11. Organizer wrong-wallet states preserve authority checks and offer a reconnect path.
12. Modals and transaction overlays meet basic keyboard, focus and announcement requirements.
13. Final fixture content is review quality.
14. Every screenshot used in the README, pitch deck or submission passes its current manifest assertions.

## Verification limit from this review

The reviewed ZIP did not include `frontend/node_modules`, so the app, Vitest suite and Playwright capture suite were not executed during the audit. After implementation, runtime verification is still required for:

- RLS and trusted synchronization behavior
- Submission uncertainty and retry paths
- Keyboard focus and screen-reader announcements
- Responsive overlap at supported viewports
- Screenshot-manifest assertions
