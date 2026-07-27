# UI Refinement Screenshot Plan

Date: 2026-07-27
Scope: Frontend page-state coverage for visual refinement and regression comparison.

## 1) Important pages first (priority order)

### Tier 1 (capture first)

These pages drive the highest-risk flows (purchase, ownership, organizer operations, check-in):

1. /events (BrowsePage)
2. /events/:eventId (EventDetailPage)
3. /events/:eventId/checkout (PurchasePage)
4. /purchases/:operationId (PurchaseReceiptPage)
5. /tickets (MyTicketsPage)
6. /organizer/events/:eventId/check-in (ScannerPage)
7. /organizer/drafts/:draftId (EventDraftPage)
8. /organizer/events/:eventId (OrganizerEventPage)

### Tier 2 (capture second)

Support and repeat-use pages:

1. /marketplace (MarketplacePage)
2. /tickets/:ticketId (TicketDetailPage)
3. /tickets/:ticketId/qr (QRDisplayPage)
4. /account (AccountPage)
5. /organizer/events (DashboardPage)

### Tier 3 (capture third)

Transition and low-duration pages:

1. /auth (AuthPage)
2. /auth/callback (AuthCallbackPage)
3. /organizer/events/new (CreateEventPage)
4. * (Not Found fallback)

## 2) Important states for each important page

### Tier 1 state checklist

1. BrowsePage
- loading
- service error
- empty results
- loaded grid (default)
- loaded grid (with filters/search active)

2. EventDetailPage
- loading
- not found or unavailable
- ready to buy (in sale)
- checking availability
- unavailable or sold out with retry path

3. PurchasePage
- loading current sale conditions
- ready review state
- buy action in progress
- non-sale or disabled purchase
- funding-required state
- pending or unknown resolution state
- recover-and-retry path shown

4. PurchaseReceiptPage
- loading
- not found or error
- confirmed success
- unresolved safety state
- sync warning or retry available

5. MyTicketsPage
- loading
- error
- empty upcoming
- empty past
- list populated (upcoming)
- list populated (past)
- pending sync warning
- list-for-sale modal open
- list-for-sale validation error

6. ScannerPage
- organizer ownership loading
- ownership denied or event unavailable
- wrong organizer wallet
- before open window
- ready for check-in
- camera blocked or unavailable
- scanning active
- pending resolution state
- result overlays: confirmed, invalid qr, expired, transferred, refunded, already used, unknown, failed

7. EventDraftPage
- loading
- unavailable
- draft editable ready
- save states: unsaved, saving, failed, offline, conflict
- wallet mismatch gate
- completion incomplete
- completion complete
- publish action in progress
- published success
- published frozen non-editable state

8. OrganizerEventPage
- loading or verifying
- unavailable
- authority mismatch warning
- ready management state
- metadata save in progress
- metadata save failure
- scanner disabled with reason
- unresolved operation chip visible
- terminal action review state (cancel or complete)
- confirmation modal open and processing

### Tier 2 state checklist

1. MarketplacePage
- loading
- service error
- empty listings
- listings loaded
- own listing badge state
- buying in progress

2. TicketDetailPage
- loading
- not found
- event unavailable block
- wallet recovery required
- ready with actions (show qr, view receipt)

3. QRDisplayPage
- validating
- active qr with countdown
- refresh and revalidate in progress
- owner or status gate failure
- error alert

4. AccountPage
- default account ready
- wallet not prepared
- recovery code shown
- recovery required warning
- organizer wallet disconnected
- organizer wallet connected
- account-level error

5. DashboardPage
- loading
- error banner
- no drafts
- no published events
- both sections populated

### Tier 3 state checklist

1. AuthPage
- default sign-in methods visible
- email otp mode
- otp verify mode
- auth error alert

2. AuthCallbackPage
- completing sign-in loading
- callback error state

3. CreateEventPage
- preparing/loading
- creation error and retry
- success redirect transition

4. Not Found
- simple 404 state

## 3) Screenshot storage plan (folder + naming)

Root capture folder:
- screenshots/ui-refinement/2026-07-27/

Folder strategy:

1. 00-reference/
- reference browser chrome, viewport verification, baseline style notes

2. 01-tier-1-core-flow/
- browse/
- event-detail/
- purchase/
- purchase-receipt/
- my-tickets/
- scanner/
- organizer-event-draft/
- organizer-event/

3. 02-tier-2-support-flow/
- marketplace/
- ticket-detail/
- qr-display/
- account/
- organizer-dashboard/

4. 03-tier-3-edge-flow/
- auth/
- auth-callback/
- create-event/
- not-found/

5. 99-archive/
- moved deprecated shots from older passes

## 4) Filename convention (strict)

Format:

T{tier}_{page}_{state}_{viewport}_{role}_{data}_{version}.png

Field definitions:

- tier: 1, 2, or 3
- page: short slug (browse, purchase, scanner, etc.)
- state: loading, error, empty, ready, modal-open, action-pending, success, etc.
- viewport: mobile-390x844, tablet-768x1024, desktop-1440x900
- role: guest, attendee, organizer
- data: fixture or seed tag (seedA, seedB, live-like)
- version: v01, v02, v03

Examples:

- T1_purchase_ready_mobile-390x844_attendee_seedA_v01.png
- T1_scanner_result-confirmed_mobile-390x844_organizer_seedB_v01.png
- T2_marketplace_empty_desktop-1440x900_guest_seedA_v01.png
- T3_auth_error_mobile-390x844_guest_seedA_v01.png

## 5) Capture order (execution sequence)

1. Tier 1 mobile (390x844)
2. Tier 1 desktop (1440x900)
3. Tier 2 mobile then desktop
4. Tier 3 mobile then desktop
5. Re-capture only changed states after each UI refinement batch

## 6) Quality gates for each screenshot

1. Header, bottom nav, and warning strip are visible when expected.
2. The state-specific CTA and status copy are fully visible.
3. No dev overlays, terminal popups, or browser extension panels are present.
4. Same viewport and zoom are used across comparable shots.
5. File name exactly matches naming schema.
6. If a state is unresolved or async, capture both in-progress and resolved outcomes.

## 7) Lightweight tracking board

Use this status model while capturing:

- TODO: not captured
- CAPTURED: captured, unreviewed
- APPROVED: accepted for baseline
- RECAPTURE: needs update after UI change

Recommended place to track status:
- maintain a table in screenshots/ui-refinement/README.md during the refinement cycle.
