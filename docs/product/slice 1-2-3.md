## Slice 1: Confident First Purchase — Summary

**Outcome:** A new user can discover an event, buy one ticket, and reliably find it again across sessions/devices.

### Key Decisions (with rationale)

1. **One unified user account** (not separate attendee/organizer identities) — a person shouldn't become a permanently different "kind" of user just for organizing an event. `user_id` (person) is kept separate from `wallet_address` (on-chain), so profile/notifications/etc. stay tied to the person even as wallets change. *Rationale: current model keys profiles directly to wallet address and uses a disposable burner wallet — no cross-device recovery.*

2. **Public browsing, auth only when required** (buy, view tickets, follow, manage events, etc.) — visitors shouldn't be forced into role-selection before understanding the product. Scanner tool must be hidden from general nav, nested under Manage Event → Check-in.

3. **URL-based routing** replacing internal view-state — needed *before* notifications/calendar/AI since all of those require durable, shareable links (refresh-safe, back/forward-safe, linkable from receipts/calendars/notifications).

4. **One ticket per checkout, no fake quantity UI** — remove quantity selectors/tiers since they don't functionally exist yet. *Rationale: don't simulate features before the underlying contract model supports them.*

5. **Explicit testnet labeling** — show real test-XLM balances/funding flow, never silently mint funds or hide that this is testnet.

### Happy Path (8 steps)
Browse (no auth) → open event (real data only, no placeholders) → click "Buy 1 ticket" (revalidate against Soroban truth) → auth without losing destination context → single truthful checkout review → transaction moves through explicit real states (no fake progress) → persistent receipt (tx hash, ticket ID, survives refresh) → ticket appears under "Upcoming" in My Tickets.

### Critical Models
- **Event states table**: on-sale / sold-out / sales-closed / cancelled / completed / unavailable, driven by on-chain status + time.
- **Contract fix**: purchase() must reject sales at/after event start — currently only checks Active+capacity, not time. *Rationale: this is a real security gap, so it's one of the few contract changes justified in Slice 1.*
- **Purchase state machine**: separates `chain_confirmed` from `mirror_syncing`/`sync_warning` so Supabase sync failures never get displayed as a failed (unpaid) purchase when the chain purchase actually succeeded. Non-negotiable: never show success before chain confirms; never require repeat payment to fix a display bug.
- **Auth states table**: covers visitor → signing in → wallet provisioning → wallet ready/recovery, keeping "Sign in" language (not "Connect Wallet") for attendees.
- **Minimum event-data contract**: full metadata list required before an event can be considered "published" — no fabricated placeholders (Time TBA, Tier 1, generic fee, etc.) allowed on published listings.

### Calendar (minimal, this slice only)
Google/Outlook/.ics export + map link, shown on event page, receipt, and ticket page. Not a full in-app calendar.

### Four Work Packages
- **A** — Product shell & routing (no contract changes)
- **B** — Identity/wallet foundation (requires a cross-device wallet-recovery proof-of-concept *before* full auth UI build)
- **C** — Truthful event data & purchase eligibility (incl. contract time-cutoff fix)
- **D** — Checkout/confirmation/reconciliation/owned ticket

### Explicitly Out of Scope
Multiple quantities/tiers, stablecoin/fiat, notifications, organizer announcements/follow, waitlists, AI chat, analytics, marketplace redesign, scanner redesign, staff delegation, full in-app calendar.

### Next Slice
Slice 2 = **Professional Event Publishing and Organizer Operations** (drafts, publishing, editing, sales overview, cancellations, settlements, announcements) — notifications and AI come after that.


## Slice 2: Professional Event Publishing and Organizer Operations — Summary

**Outcome:** Organizer lifecycle **Draft → Review → Publish → Manage → Cancel or Complete**, all irreversible actions truthful, recoverable, and tied to one authoritative owner. Extends (doesn't replace) Slice 1's existing draft table, publication service, and route boundaries — no second draft system, ownership table, or backend transaction relayer.

### Key Decisions (with rationale)

1. **Existing `event_publication_drafts` becomes the sole draft & ownership record.** Retired the "one open draft per user" + "latest row" model in favor of drafts addressed by ID (`/organizer/drafts/:draftId`), multiple concurrent drafts, and **server-enforced atomic compare-and-swap saves** (checks `auth.uid()`, ownership, editability, `expected_revision`; rejects mismatches — a React-side revision check doesn't count as real concurrency protection). *Rationale: prevents lost drafts, duplicate ownership records, and two-tab silent overwrites while reusing existing publication/ownership evidence.*

2. **Human ownership vs. wallet authority stay separate.** Signed-in user owns drafts/metadata/records; only the connected organizer wallet can sign publish/cancel/complete. Organizer reads derive from `auth.uid()`, never from a client-supplied wallet — so drafts/events are visible without Freighter connected, and a wrong wallet gets an explicit "Switch wallet" message instead of a generic failure.

3. **Publication locks contract terms only, not everything.** Three field classes: **Locked (Class A: id, wallet, title, start/end, capacity, price)**, **Editable anytime (Class B: summary, poster, contact, etc.)**, **Locked after first sale (Class C: venue/address)** — enforced server-side by re-reading Soroban supply, not just disabling a UI control.

4. **Product lifecycle is richer than the 3-value contract enum** (`Active/Cancelled/Completed`). Display states (On sale, Sold out, In progress, Awaiting completion, etc.) are derived from contract state + time + supply — "Active" is never shown as the only label.

5. **Authoritative start/end times replace the single `date_unix`**, and terminal states now consistently close mutation paths: sales close at start, completion only after end, cancellation/completion valid only from Active, `mark_used` and resale purchase now correctly reject **every** non-Active state (previously only checked for Cancelled). **Zero-sale events can be completed** (no zero-value transfer attempted, but `ev_rel` still emitted with amount `0`). *Rationale: one authoritative schedule + one Active-only mutation rule supports check-in, resale, settlement, and history without conflicting definitions.*

6. **Soroban remains sole financial authority.** Dashboard previously estimated escrow (supply × price); now reads actual contract escrow. Gross sales ≠ escrow — never conflated. No "refunded total" metric shown since that formula becomes false post-settlement. Mirrored values, when Soroban is unavailable, are marked stale/unavailable and can never enable lifecycle actions.

7. **`/organizer/events/:eventId` becomes a full operational hub** (Overview / Public listing / Sales & funds / Settings / Activity) instead of a thin check-in stub, with destructive/financial actions moved out of dashboard rows into this reviewed context. Activity log intentionally bounded to only what's provably recorded (publish, metadata update, cancel, complete, escrow release) — no promise of full ticket/refund/resale timeline yet.

8. **Cancellation and completion share one terminal-operation owner and one event-level lock** — they're framed as *competing* transitions for the same event, not independently-locked actions, enforced via server-side allocation lock + partial DB uniqueness. Prevents simultaneous cancel/complete wallet flows for one event.

9. **Signed-hash persisted before submission, every receipt proves its specific action.** Hash is computed after Freighter signs but stored *before* `signAndSend()` is called — if persistence fails, submission never starts. Lost responses become "Status unknown" (blocks retries until resolved). Receipts require binding to the exact emitted event (`ev_create`/`ev_cancel`/`ev_rel` + event ID + amount), not just "a successful tx from this wallet." *Rationale: recovers from lost SDK responses via known tx identity; prevents mismatched receipts.*

10. **Coordinated testnet redeployment.** Adding `end_unix` changes the Event ABI, so TicketContract + MarketplaceContract are redeployed as a pair, bindings regenerated, addresses cross-updated, environment repointed — old testnet data kept as history but not mixed into the active read model.

### State Models
- **Draft lifecycle**: Draft → Ready to publish → Publication review → Publishing → Status unknown / Needs attention → Published → Deleted.
- **Draft save states**: Saved / Saving / Unsaved changes / Save failed / Newer version detected / Offline.
- **Published-event display states**: On sale, Sold out, In progress, Awaiting completion, Settlement/Cancellation status unknown, Completed, Cancelled, Status unavailable.
- **Chain-operation states** (shared by publish/cancel/complete): Review → Preparing → Approval required → Recording signed transaction → Submitting → Confirmation pending → Status unknown / Authoritative failure/success → Mirror syncing / Sync warning → Complete.

### Publication Preflight (before Freighter opens)
Checks auth, draft ownership/revision, correct wallet connected & can sign, valid schedule/capacity/price, complete metadata, event ID not already published, no unresolved prior submission, network/contract match, sufficient wallet balance.

### Four Work Packages
- **A** — Contract: authoritative schedule, terminal guards, receipt events, coordinated deployment.
- **B** — Durable draft workspace, published-draft ownership, one-time publication.
- **C** — Event-specific management page with truthful operational/financial data.
- **D** — Safe, mutually exclusive cancellation and completion.

### Explicitly Out of Scope
Ticket tiers/quantities/seating/pricing variants, promo codes, custom refund policies, rescheduling/venue relocation post-sale, staff delegation, full attendee lists, scanner redesign, check-in analytics, organizer announcements, notifications, stablecoin/fiat, automatic escrow release, dispute resolution, bulk refunds, full activity indexing, revenue charts, generic AI assistant.

### Next Slice
**Reliable Venue Check-in** — scanner access, staff permissions, admission confirmation, duplicate-scan handling, live check-in counts, now buildable on durable event ownership/schedules/routes from this slice.



## Slice 3: Reliable Venue Check-in — Summary

**Outcome:** Organizer admits the correct ticket holder to the correct event, within the permitted entry window, with authoritative Stellar confirmation, duplicate protection, and safe recovery after interruption.

**Verdict:** Approve with required changes — current scanner ignores route `eventId`, calls `markUsed` directly, writes `Used` to Supabase from the browser, has dead controls, and uses fabricated attendee data. Contract's `mark_used` doesn't know which event is expected and has no time window enforcement.

### Six Required Corrections (with rationale)

1. **Contract must receive and verify expected `event_id`** — reject a ticket whose `ticket.event_id` doesn't match. *Must fix.*
2. **Check-in time enforced on-chain**, not just in UI — same call that marks `Used` must reject early/late submissions. *Must fix.*
3. **Check-in needs its own ticket-level operation owner** — must NOT reuse the Slice 2 `organizer_event_operations` lock, since that lock intentionally allows only one unresolved cancel/complete *per event* and would wrongly serialize unrelated door scans across all ticket holders. *Must fix.*
4. **RPC failure must not look like an invalid ticket** — current `getTicket` returns `null` for both transport failure and nonexistence; scanner needs to distinguish `not_found` from `unavailable`. *Must fix.*
5. **Used-mirror writes must leave the browser** — remove `mirrorUsedTicket()` from scanner; only a trusted finalizer sets mirror status after verifying the exact tx/contract state. *Must fix.*
6. **Remove unsupported presentation** — no stock avatar, "Anonymous Attendee," fake tier/access class, or dead controls. *Simplify.*

Preserved as-is: rotating signed QR, local signature verification, Soroban-as-authority, mobile responsiveness, limited stats, and exclusion of staff roles/offline entry/overrides/replacement QR.

### Key Decisions (with rationale)

1. **Check-in is event-scoped through every layer** — identified by organizer account + network/contract + route event ID + ticket ID + organizer wallet. Camera stays disabled until ownership, on-chain organizer match, and connected-wallet match all succeed. *Rationale: fixing this only in UI would leave backend/contract on a different model — stats, recovery, device concurrency all need one stable event identity.*

2. **Fixed MVP check-in window: opens 2 hours before event start, closes at event end** (`start − 2h ≤ ledger time < end`). No per-event configurable door time in this slice. Contract is final enforcement point. *Rationale: gives useful pre-start admission without changing the stored `Event` structure or requiring a new publishing-model decision.*

3. **One durable operation per ticket** (`check_in_operation`, uniqueness = network + contract + ticket ID). Two devices scanning the same ticket get the same operation; only one can proceed to signed attempt. Once a signed hash is persisted, no replacement transaction until non-submission or authoritative failure is proven. No queue/worker/generic workflow engine needed.

4. **Result labels must stay semantically distinct** — never collapse into generic "Invalid ticket":
   - **Wrong wallet** = connected Freighter ≠ event organizer
   - **Transferred** = valid QR signature but QR wallet ≠ current on-chain owner
   - **Invalid QR** = malformed payload or signature mismatch
   - **Status unknown** = current state or possibly-submitted tx unresolved

### Happy Path (12 steps)
Organizer opens `/organizer/events/:eventId/check-in` → page verifies ownership+chain-event+organizer-match+wallet-match+active/in-window → shows event info + counts + real **Enable camera** button → camera only requested after explicit press → QR decode pauses camera, verifies payload/timestamp/signature/ticket existence/event match/status/owner → only eligible ticket allocates a durable operation (ineligible tickets never open Freighter) → tx prepared via existing generated-binding adapter → Freighter approval, **signed hash persisted before submission** → service resolves exact tx + `tk_used` event, rereads ticket/event from contract → **"Entry confirmed"** shown as soon as chain success proven (valid even if Supabase mirror still syncing) → trusted finalizer updates mirror, then **Scan next ticket** → refresh/reopen restores unresolved operations, never silently starts a second `mark_used`.

### Contract Changes
`mark_used` now takes `event_id` too, and must: authenticate organizer → load expected event → verify organizer → require Active status → enforce fixed open/close timestamps → load ticket → require ticket.event == expected event → return **distinct errors** for Used vs Refunded → write Used → emit `tk_used`. New error variants appended (not renumbering existing): `TicketRefunded`, `TicketWrongEvent`, `CheckInNotOpen`, `CheckInClosed`.

### Statistics (derived, not a maintained aggregate table)
- **Sold** = authoritative `event.current_supply`
- **Checked in** = distinct tickets with operation in `chain_confirmed`/`mirror_syncing`/`sync_warning`/`complete`
- **Remaining** = `max(sold − checked in, 0)`
- **Unresolved** = distinct tickets in pending/unknown states

Legacy `tickets.status = Used` rows without check-in proof must be excluded from verified stats (flagged during migration), not silently counted.

### Four Work Packages
- **A** — Contract-enforced admission boundary (event/time/status/organizer guards, distinct error outcomes)
- **B** — Recoverable check-in operation (durable per-ticket operation, trusted finalizer, owner-derived reads)
- **C** — Event-scoped mobile scanner (real permission/wallet gates, removes mirror write & fake data & dead controls)
- **D** — Door statistics and operational recovery (truthful counts even under RPC/mirror failure)

### Explicitly Out of Scope
Staff accounts/delegated roles, offline validation/admission, manual entry override, attendee search/manual ID entry, configurable door schedules, re-entry/multi-use tickets, ticket tiers/seating/zones, attendee messaging, advanced analytics, replacement QR formats, background queues/workflow infrastructure.

### Approval Condition
Implementation may begin only if the plan preserves: the **dedicated ticket-level operation owner** (not reusing the event lock), **contract-level event and time enforcement**, and the **fixed two-hour opening policy**. Removing any of these three reopens the main correctness gap.