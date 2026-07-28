# StellarTickets Frontend Implementation Findings

Consolidated from two code-first reviews of the current repository. This is an implementation handoff, not a request to redesign the application.

## Read before changing code

- This is a Vite + React 19 Stellar hackathon MVP targeting Level 5. Do not introduce Next.js, server-component, or enterprise-scale patterns.
- Soroban owns authoritative economic and ticket state. Supabase is a discoverability/read model: confirm the chain action first, update the trusted mirror second, then invalidate affected reads.
- Keep attendee/Dfns and organizer/Freighter identities, lifecycle, and signers separate.
- Never create a replacement attendee wallet after restoration failure.
- Do not hand-edit generated contract bindings or import them from pages/components; handwritten contract access stays in `frontend/src/lib/soroban.ts`.
- A read-model failure after chain success must never cause the financial transaction to be blindly retried.
- Preserve the QR absolute-age rule: a payload is valid only while its age is `< 45s`, and local signature validation never replaces the authoritative ticket owner/status check.
- Avoid broad framework additions. The existing hooks and adapters are sufficient for most fixes.

## Priority summary

| ID | Finding | Priority | Regression risk | Plan decision |
|---|---|---:|---:|---|
| F1 | Refund/resale mirrors rely on browser writes | P0 | High | Mandatory |
| F2 | Attendee routes render before wallet restoration is authoritative | P0 | Medium-high | Mandatory |
| F3 | Saving with another Freighter account can rebind draft authority | P0 | Medium | Mandatory |
| F4 | Save responses can overwrite newer organizer edits | P0 | Medium | Mandatory |
| F5 | Running scanner can outlive its authorization gate | P0 | Medium-high | Mandatory |
| F6 | Persisted organizer wallet is trusted without revalidation | P1 | Medium | Include |
| F7 | Listing read failure is treated as “not listed” | P1 | Low-medium | Include |
| F8 | Owned tickets disappear when event metadata is unavailable | P1 | Low-medium | Include |
| F9 | Automatic QR renewal repeatedly invokes delegated signing | P1 | Medium | Include |
| F10 | Global/destructive polling causes unnecessary requests and skeleton resets | P1 | Medium | Include |
| F11 | Browser-storage failures can break auth and purchase recovery | P1 | Low-medium | Include |
| F12 | Unsaved organizer work has no navigation protection | P1 | Medium | Include |
| F13 | Event search sends a request per keystroke | P1 | Low-medium | Include |
| F14 | All routes and heavy features are in the eager entry graph | P1 | Medium-low | Include |
| F15 | Published preview and authoritative event reads are sequential | P2 | Medium | Include after correctness work |

---

## F1. Move refund and marketplace mirror updates behind a trusted reconciliation boundary

**Impact:** A refund, listing change, or resale can succeed on-chain while the UI remains stale or contradictory.

**Evidence**

- `frontend/src/lib/readModelSync.ts:48-103` directly updates/inserts `tickets` and `listings` from the browser.
- `supabase/migrations/202607270002_phase_4_recoverable_owned_ticket.sql:24-45` hardens ticket RLS and revokes browser insert access.
- `supabase/migrations/202607290001_slice_3_check_in_operations.sql:1-12` states that only trusted service-role functions may record verified ticket mirror changes and revokes browser updates.
- Root `AGENTS.md:19-23` and `frontend/AGENTS.md:23-31` require chain confirmation before a trusted mirror update.

**Required end state**

Use one trusted operation/reconciliation boundary for refund, create listing, cancel listing, and buy listing. It must identify the authenticated actor, verify the confirmed transaction and expected operation, update the affected projections, and support safe mirror retry without resubmitting the chain action.

**Guardrails**

- Do not restore broad browser write policies.
- Do not make Supabase authoritative for ownership, refund eligibility, resale eligibility, or transfer success.
- Reuse the existing purchase/check-in operation-service pattern where practical; do not create competing reconciliation owners.

---

## F2. Make attendee-wallet restoration an explicit, session-safe route gate

**Impact:** Existing users can briefly see “Prepare wallet” during restoration, start unnecessary provisioning, or receive stale wallet state from a previous session.

**Evidence**

- `frontend/src/auth/AuthProvider.tsx:60-76` sets auth `loading` false before `refreshWallet()` finishes and can start restoration from both the auth listener and initial session read.
- `frontend/src/App.tsx:44-75` treats every non-`ready` attendee state as provisioning/recovery UI once auth loading ends.
- `frontend/src/store/useAppStore.ts:15-21` initializes the attendee wallet as `signed_out`; it is intentionally not persisted.
- `refreshWallet()` has no request sequence or captured user/session check before committing its result (`AuthProvider.tsx:29-58`).

**Required end state**

- Add an explicit attendee-wallet hydration state such as `restoring`, or a separate `walletLoading` state.
- Attendee-protected routes must wait until restoration resolves.
- Show provisioning only after the authenticated backend definitively reports `not_provisioned`.
- Key each restoration request to the current authenticated user/session and discard superseded results.
- Reset attendee state immediately when signed-out becomes authoritative.

**Guardrails**

- Preserve `recovery_required`; never silently create a replacement wallet.
- Do not block receipt pages or organizer-only routes that do not require the attendee signer.
- Cover direct links, refreshes, OAuth/OTP callbacks, sign-out during restoration, and rapid account changes.

---

## F3. Do not let an ordinary draft save change the intended organizer wallet

**Impact:** Editing an unrelated field while the wrong Freighter account is connected can silently transfer the draft’s publication authority.

**Evidence**

- `frontend/src/pages/organizer/EventDraftPage.tsx:149-170` always includes `intended_organizer_address` in the save patch.
- `EventDraftPage.tsx:298-315` passes `wallet.publicKey ?? draft.intended_organizer_address` on every save.
- The UI detects and warns about a wallet mismatch at `EventDraftPage.tsx:501-517` and `614-617`.
- `supabase/migrations/202607280001_slice_2_organizer_lifecycle.sql:252-258` overwrites the stored intended organizer whenever that patch key is present.

**Required end state**

Bind `intended_organizer_address` only when a draft has no organizer address. Omit it from normal content saves. If organizer reassignment is required, make it a distinct explicit action showing the old and new wallet.

**Guardrails**

- Keep human draft ownership separate from wallet publication authority.
- Preserve first-time binding, publication recovery, revision conflict handling, and exact-wallet publication checks.

---

## F4. Prevent save completion from overwriting edits made during the request

**Impact:** Organizers can lose text they entered while a save was in flight and then see a false “saved” state.

**Evidence**

- Draft save replaces the whole form with the returned snapshot at `frontend/src/pages/organizer/EventDraftPage.tsx:298-315`.
- The Save button is disabled while saving, but fields remain editable because they use only `disabled={!editable}` (`EventDraftPage.tsx:549-550`, `622-674`).
- Published metadata save sends the old snapshot and then reloads/replaces all local metadata at `frontend/src/pages/organizer/OrganizerEventPage.tsx:54-73` and `176-210`.
- `updateOrganizerEventMetadata()` already returns the updated event (`frontend/src/lib/supabase.ts:453-463`), but the page ignores it and performs a second read.

**Required end state**

For this MVP, either disable editable fields during the short save or track a local edit revision and apply the response only when no newer edits exist. For published metadata, use the updated object returned by the save call; preserve newer local edits and leave the state `unsaved` when appropriate.

**Guardrails**

- Do not report a failed save merely because a redundant post-save reload failed after the update committed.
- Preserve optimistic-concurrency revisions and existing two-tab conflict behavior.

---

## F5. Revalidate scanner authority for every decoded QR and stop the camera when the gate closes

**Impact:** A camera started under valid conditions can continue accepting scans after the event window closes, the event changes state, or the organizer wallet changes.

**Evidence**

- The complete gate is derived at `frontend/src/pages/ScannerPage.tsx:73-85` and checked only when enabling the camera (`358-370`).
- `processScan()` begins at `178-196` without rechecking the full gate.
- Time changes every 30 seconds (`150-155`), but no effect stops the active camera when `scannerReady` becomes false.
- `resumeScanning()` resumes without rechecking the gate (`164-171`).
- The scanner library retains the callback supplied when `start()` runs, so it can hold an older closure (`364-368`).

**Required end state**

- Stop or pause the camera whenever the full gate becomes false.
- Recheck ownership, authoritative event state, time window, connection, exact wallet, and signer at the beginning of every decoded scan and before resume.
- Ensure the scanner callback reads the latest gate/handler state through a stable ref or suitable React 19 event mechanism.

**Guardrails**

- Invalid local gates must fail before operation allocation or wallet approval.
- Preserve durable operation recovery for scans that legitimately began submission.
- Keep the contract as final authority; do not weaken on-chain validation.

---

## F6. Revalidate persisted Freighter state before organizer actions

**Impact:** After refresh, extension disconnect, or account switching, the app can display and act as the previously stored organizer.

**Evidence**

- `frontend/src/store/useAppStore.ts:41-58` persists organizer state and reconstructs a signer during rehydration without checking the extension’s current connection/address or refreshing balance.
- The explicit connection path correctly checks Freighter, requests the current address, and reads balance (`frontend/src/hooks/useWallet.ts:14-35`).

**Required end state**

Treat rehydrated organizer state as unverified. Before enabling organizer/scanner actions, verify Freighter availability/connection, obtain the current address, compare it with the stored hint, refresh balance, and only then install a signer.

**Guardrails**

- Avoid repeated permission prompts on public routes.
- Keep human sign-out separate from organizer disconnect.
- A mismatched current account must not inherit the previous organizer’s event context.

---

## F7. Represent listing state as open, absent, or unavailable

**Impact:** A read-model outage can expose “List for sale” for a ticket that is already listed, allowing duplicate open listings.

**Evidence**

- `frontend/src/lib/supabase.ts:600-614` converts any listing-query error into `null`.
- `frontend/src/pages/MyTicketsPage.tsx:196-215` stores only returned listings and passes a boolean to the card (`260-275`).
- `frontend/src/components/tickets/TicketCard.tsx:75-113` treats false as permission to list.
- `contracts/marketplace/src/lib.rs:54-83` has no on-chain ticket lock and uniqueness is only seller + listing ID; the frontend creates a fresh listing ID for each attempt.

**Required end state**

Track at least `open`, `none`, and `unavailable/loading`. Enable “List for sale” only after a successful read confirms no open listing. On failure, show unavailable/retry rather than absence.

**Guardrails**

- This does not replace F1; a trusted mirror/reconciliation path is still required.
- Do not add an on-chain lock unless separately designed and approved.

---

## F8. Never hide an owned ticket solely because published event metadata is missing

**Impact:** A valid recovered/on-chain-owned ticket can disappear from “My Tickets” when the event projection is delayed or unavailable.

**Evidence**

- `frontend/src/pages/MyTicketsPage.tsx:55-57` fetches event rows for owned tickets.
- Missing event metadata leads to fallback date `0` during grouping and then both render paths return `null` (`MyTicketsPage.tsx:177-187`, `260-263`, `308-310`).
- `frontend/src/pages/TicketDetailPage.tsx:105-157` already demonstrates receipt-snapshot fallback for name, time, and venue.

**Required end state**

Every owned ticket must produce a visible library item. Use receipt snapshot data when available; otherwise show a minimal “Event details unavailable” item with ticket ID/status and preserve View Ticket/View Receipt.

**Guardrails**

- Fallback metadata is presentational only. Do not use it to authorize refund, resale, QR generation, or entry.
- Define deterministic grouping/sorting for unknown event time.

---

## F9. Make QR renewal compatible with Dfns/WebAuthn signing

**Impact:** Keeping a ticket open can repeatedly initiate delegated signing; a rejected renewal immediately removes a QR that may still be valid.

**Evidence**

- `frontend/src/pages/QRDisplayPage.tsx:40-84` signs initially, every 30 seconds, and again on window focus.
- Renewal failure clears the current payload (`QRDisplayPage.tsx:69-77`).
- `frontend/src/lib/qr.ts:12-23` signs each payload.
- `frontend/src/lib/dfns.ts:182-191` performs `signature-init`, an authenticator assertion, and `signature-complete` for each delegated signature.
- QR validity remains `< 45s` (`frontend/src/lib/qr.ts:4`, `38-40`).

**Required end state**

- Keep the existing payload visible until its actual expiry when renewal fails.
- Prevent overlapping focus, interval, and manual renewal attempts.
- Use explicit refresh when another WebAuthn assertion is required, unless the delegated-signing provider has a deliberately configured short-lived session that makes silent rotation valid.
- Show countdown based on the payload timestamp/expiry, not merely a resettable UI timer.

**Guardrails**

- Do not extend or weaken the `< 45s` rule.
- Revalidation must still confirm current on-chain owner and Active status.

---

## F10. Separate initial loading from background refresh and scope polling to consumers

**Impact:** Populated pages revert to skeletons every 30 seconds, and unrelated routes continuously request tickets/listings.

**Evidence**

- `frontend/src/App.tsx:104-108` mounts `useTickets()` and `useListings()` for the entire application.
- Ticket, listing, and event hooks set full `loading=true` on every refresh (`frontend/src/hooks/useTickets.ts:29-54`, `useListings.ts:40-92`, `useEvents.ts:27-55`).
- All poll every 30 seconds.
- Browse, marketplace, and tickets replace existing content with skeletons whenever loading is true.

**Required end state**

- Distinguish initial empty loading from background refreshing.
- Preserve usable data/cards while refreshing and surface only a subtle refresh/error state.
- Mount polling only where the data is consumed, or add an explicit route-aware `enabled` input.
- Separate one-time pending purchase synchronization from continuous ticket-library polling so recovery still runs after login.

**Guardrails**

- Continue clearing intervals and ignoring superseded responses.
- Do not introduce SWR or another application-wide data library solely for this fix.
- Preserve invalidation after purchase, refund, listing, resale, and check-in.

---

## F11. Make browser storage best-effort and non-authoritative

**Impact:** Restricted/throwing Web Storage can interrupt protected navigation, hide a successfully fetched receipt, or prevent a signed purchase adapter from returning after durable backend recording.

**Evidence**

- `frontend/src/lib/authIntent.ts:44-58` and `71-72` use unguarded `sessionStorage` access.
- `frontend/src/lib/purchaseOperations.ts:102-125` uses unguarded `localStorage` access.
- After the signed hash is durably recorded, `savePurchaseRecovery()` runs before returning the signed transaction (`purchaseOperations.ts:271-281`).
- `frontend/src/pages/PurchaseReceiptPage.tsx:32-45` treats local recovery-cache failure as receipt-load failure.

**Required end state**

Create small versioned safe-storage adapters that catch `getItem`, `setItem`, and `removeItem` failures and return a result. Auth intent and local purchase recovery must degrade safely; durable backend state remains authoritative.

**Guardrails**

- A local cache failure after `record-signed-attempt` must not convert signing into a pre-submission failure or block transaction submission.
- A successful backend receipt read must remain visible even if local caching fails.
- Store only minimal non-secret recovery metadata.

---

## F12. Protect unsaved organizer work from route and browser exit

**Impact:** Draft or published metadata edits can be lost through header/back navigation, bottom navigation, browser Back, or tab close.

**Evidence**

- Draft and published-event pages explicitly track unsaved/offline/failed states.
- Repository search finds no `beforeunload` or router navigation blocker.
- `frontend/src/components/layout/AppHeader.tsx:13-34` navigates directly without consulting editor state.

**Required end state**

Add one shared organizer-edit navigation guard active for unsaved, offline, failed, or newer edits during an unresolved save. Cover in-app routing and browser/tab close. Clear it immediately after confirmed save, deliberate discard, deletion, or completed publication transition.

**Guardrails**

- Do not add a full autosave framework.
- Avoid prompts when no local changes exist.
- Save/Stay/Discard behavior must respect offline and conflict states.

---

## F13. Debounce remote text filters and cancel scheduled work

**Impact:** Typing a normal search term can launch several Supabase requests and repeatedly reset the result grid.

**Evidence**

- `frontend/src/pages/BrowsePage.tsx:20-38` passes search and city values directly into `useEvents()` on each keystroke.
- `frontend/src/hooks/useEvents.ts:27-70` recreates the fetch callback and schedules an immediate request for every value change; the scheduled timeout is not retained/cleared.

**Required end state**

Debounce text-driven remote filters by roughly 250-400 ms, clear pending scheduled work on dependency change/unmount, and preserve existing results during the refresh. Category/date changes may remain immediate.

**Guardrails**

- `useDeferredValue` alone is insufficient because it does not guarantee suppression of network requests.
- Keep superseded-response protection.

---

## F14. Add bounded route/feature code splitting

**Impact:** The public browse/sign-in entry participates in a graph containing scanner, QR, organizer, Dfns, Freighter, Stellar SDK, and contract-related code before those features are opened.

**Evidence**

- `frontend/src/App.tsx:17-32` statically imports every route.
- `ScannerPage` imports `html5-qrcode`; `QRDisplayPage` imports `qrcode.react`; attendee auth/signing imports Dfns and Stellar dependencies.

**Required end state**

Use Vite-compatible `React.lazy(() => import(...))` with a route-level fallback. Prioritize scanner, QR display, organizer editor/management, marketplace, and checkout/receipt/ticket-management routes. Consider loading Dfns integration only when authenticated attendee restoration/provision/signing is actually needed.

**Guardrails**

- Keep browse and lightweight auth UI eager.
- Do not split every small component.
- Preserve direct-route refresh, auth intent return, Back/Forward, and lazy-module error behavior.

---

## F15. Start independent event-preview and authoritative reads concurrently

**Impact:** Event detail, checkout restoration, organizer event loading, and scanner setup currently pay two network waits in sequence.

**Evidence**

- `frontend/src/hooks/useEvent.ts:12-27` awaits `fetchPublishedEventById(eventId)` before starting `getEvent(eventId)`, although both require only `eventId`.

**Required end state**

Start both requests together, then preserve current semantics: no published row means no public event; authoritative failure produces the existing unavailable-authority state; identity mismatch remains blocking before merge.

**Guardrails**

- Do not display an unpublished chain event.
- Do not make the Supabase preview authoritative.
- Accept that this may issue an RPC read for an invalid/unpublished ID; implement only after higher-priority correctness work.

---

## Recommended implementation sequence

1. **Authority and transaction correctness:** F1, F2, F3, F5.
2. **Prevent organizer data loss:** F4, then F12.
3. **Wallet and ticket state reliability:** F6, F7, F8, F9, F11.
4. **Loading and network behavior:** F10, F13.
5. **Initial-load performance:** F14.
6. **Secondary latency improvement:** F15.

Do not combine all findings into one large change. Keep commits/work units narrow enough that authority, recovery, and UI-state regressions can be isolated.

## Focused verification cases

Run these only in a separate verification step when requested:

- Chain success + mirror failure never repeats refund/list/buy/cancel payment or contract action.
- Direct checkout/QR refresh waits for attendee restoration; sign-out/account switch discards older wallet results.
- Freighter refresh, disconnect, and account switch invalidate stale organizer state.
- Saving a draft while the wrong wallet is connected does not change the intended organizer.
- Typing during draft/metadata save does not lose newer input or falsely report it saved.
- Scanner camera stops when window/status/wallet/ownership gate becomes invalid; resume rechecks all gates.
- Rejected QR renewal leaves the previous payload visible only until its real expiry.
- Listing-query failure disables listing rather than implying no listing.
- Missing event projection still leaves every owned ticket visible with safe fallback details.
- Throwing `sessionStorage`/`localStorage` does not break auth redirect, receipt display, or signed purchase continuation.
- Background refresh preserves current cards; unrelated routes do not poll unused collections.
- Debounced search sends one settled request rather than one per keystroke.
- Every lazy route works through direct URL load, refresh, auth return, and Back/Forward.

## Explicit non-goals

- No broad memoization campaign, general component splitting, Map/Set micro-optimizations, or speculative large-scale list work.
- No SWR/React Query migration solely to solve current polling behavior.
- No Next.js/RSC/server-action guidance.
- No enterprise autosave, event bus, or replacement state-management framework.
- No mobile-layout rewrite without visual/runtime evidence of a separate defect.
- No contract redesign unless a finding explicitly requires a separately approved on-chain change.
