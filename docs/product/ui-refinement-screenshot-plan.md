## UI Refinement Screenshot Plan — Summary

**Scope:** Frontend page-state capture across the app for visual refinement/regression comparison. Date: 2026-07-27.

### Page priority tiers
- **Tier 1** (highest-risk flows — purchase, ownership, organizer ops, check-in): Browse, EventDetail, Purchase, PurchaseReceipt, MyTickets, Scanner, EventDraft, OrganizerEvent.
- **Tier 2** (support/repeat-use): Marketplace, TicketDetail, QRDisplay, Account, Dashboard.
- **Tier 3** (transition/low-duration): Auth, AuthCallback, CreateEvent, 404.

*Rationale for ordering: capture highest-risk transactional/ownership flows first since they're most consequential to get visually right and most likely to reveal broken/placeholder states.*

### States to capture
For each page, the full realistic state set — not just "happy path": loading, error, empty, ready/default, in-progress action, disabled/blocked reasons, pending/unknown resolution, sync warnings, and (for Scanner specifically) the full result-outcome set: confirmed, invalid QR, expired, transferred, refunded, already used, unknown, failed. Draft/save flows also capture unsaved/saving/failed/offline/conflict states. *Rationale: matches the truthful-state-machine approach baked into Slices 1–3 — every screenshot should reflect a real system state, not a placeholder.*

### Storage & naming
- Root: `screenshots/ui-refinement/2026-07-27/`
- Subfolders by tier + page group, plus `00-reference/` (baseline chrome/viewport notes) and `99-archive/` (deprecated shots).
- Strict filename format: `T{tier}_{page}_{state}_{viewport}_{role}_{data}_{version}.png`
  (e.g. `T1_purchase_ready_mobile-390x844_attendee_seedA_v01.png`)

### Capture order
Tier 1 mobile (390×844) → Tier 1 desktop (1440×900) → Tier 2 mobile→desktop → Tier 3 mobile→desktop → after each UI refinement batch, re-capture only changed states.

### Quality gates
Header/nav/warning-strip visible when expected; state-specific CTA and copy fully visible; no dev overlays/extension panels; consistent viewport/zoom across comparable shots; filename matches schema exactly; async states get both in-progress and resolved shots.

### Tracking
Status model: `TODO → CAPTURED → APPROVED / RECAPTURE`, tracked in a table in `screenshots/ui-refinement/README.md`.