# Slice 1 Current-to-Target Gap Map

## Purpose

This file maps the current repository to the approved **Confident First Purchase** outcome after the choices in [`slice-1-decision-register.md`](./slice-1-decision-register.md) have been settled.

It is organized in implementation order. It is not a screen backlog and does not repeat the full product specification. Soroban remains authoritative for sale conditions, payment, ticket creation, ownership, and ticket state.

Risk meanings:

- **Critical** — can orphan ticket access, duplicate payment, misstate chain outcome, or weaken authority.
- **High** — blocks the approved journey, refresh recovery, or truthful public data.
- **Medium** — material product-quality gap after foundations are stable.

## Baseline gate — Use one auditable source snapshot

**Implementation status:** Phase 4 coding is complete; its proof gate,
deployment, and end-to-end verification remain pending.

### At present

The uploaded source exports are not fully consistent. The integration export contains `readModelSync.ts`, while the frontend export still shows purchase logic from another revision. Documentation also claims Google/email sign-in and secure burner storage although the current frontend creates a local burner and mock wallet-address profile.

### Required state

Implementation starts from one named repository commit. Source, schema, generated bindings, tests, deployment scripts, and screenshots must all refer to that commit.

### Completion boundary

- Record the commit hash used for Slice 1.
- Re-export or inspect the complete repository from that commit.
- Resolve duplicated or stale implementations before assigning work.
- Treat code and tests as current behavior; update README and architecture only after behavior changes.

**Risk: Critical.** A mixed snapshot can make an implementation agent fix code that is not actually current.

---

## Package 1 — Account, recoverable wallet, and durable navigation

### At present

- `App.tsx` starts on a role-selection landing page and uses an in-memory `AppView` state machine.
- Event and ticket IDs live in component state; refresh, share, Back/Forward, and deep links are not durable.
- There is no human authentication session.
- `user_profiles` is keyed by wallet address.
- attendee connection creates a random burner secret in browser storage;
- disconnect deletes that secret;
- a new browser creates a different wallet;
- Freighter replaces attendee wallet state and can auto-route the user as an organizer;
- mobile navigation exposes Scanner and Manage to everyone.

### Required final state

- `/events` is the public entry.
- Discover and event details work without sign-in.
- Supabase Auth supplies a stable `user_id` through Google or email.
- The authenticated user restores one Dfns delegated Stellar attendee wallet.
- No raw attendee secret enters application storage.
- Attendee wallet and organizer Freighter connection coexist.
- Protected actions return to the exact validated route and action after authentication.
- Scanner is reachable only from `/organizer/events/:eventId/check-in`.
- Account exposes the public address, network, balance, recovery status, and purchase receipts.

### Required system changes

- Replace `AppView` transitions with URL routing and route loaders/guards.
- Add auth callback and validated pending-intent storage.
- Replace wallet-as-profile schema with `user_id` plus a separate wallet-link record.
- Replace the burner signer behind the existing signing boundary with the delegated-wallet adapter.
- Separate human sign-out from organizer-wallet disconnect.
- Replace public Connect Wallet language with Sign in; keep wallet detail inside Account.

### Proof gate

Browser A and Browser B must restore the same address and sign both a Soroban purchase and the current QR message. Authentication must return to an exact checkout route without submitting anything automatically. Failed restoration must stop at `wallet_recovery_required`, not create a replacement wallet.

### Complete when

A visitor can open or share an event URL, sign in only when buying, return to that checkout, refresh safely, sign out, sign back in elsewhere, and see the same attendee address. Organizer connection does not change that address or ticket context.

**Dependencies:** DR-01, DR-02. **Risk: Critical.**

---

## Package 2 — Truthful event data and authoritative sale eligibility

### At present

- On-chain event data contains organizer, name, start timestamp, capacity, price, supply, and status.
- Supabase adds only partial nullable metadata.
- Public discovery selects all event rows and has no publish-readiness rule.
- Event creation can expose an incomplete row immediately.
- Event detail shows placeholders and fabricated values such as `Time TBA`, fixed fee, stock organizer identity, Floor Price, and a dead Follow action.
- Event state is derived from mirrored status/supply rather than a fresh authoritative read.
- the contract does not reject primary purchase at or after the event start.

### Required final state

- Public discovery returns only complete, verified, published events that meet
  listing criteria such as Active/upcoming.
- Direct `/events/:eventId` access resolves every verified published event,
  including sold-out, started, cancelled, and completed events.
- Event details use real start, end, timezone, venue, address, organizer, support, price, supply, refund, resale, and entry data.
- The only Slice 1 actions are Buy 1 ticket, Share event, and Add to calendar.
- Before checkout and again before final confirmation, Soroban revalidates status, start, capacity, supply, price, and organizer.
- Critical changes require the buyer to review again.
- On sale, Sold out, Sales closed/Event started, Cancelled, Completed, and Temporarily unavailable are distinct states.
- `TicketContract::purchase` rejects at or after `date_unix` before any state or token effect.

### Required system changes

- Keep `events` as the trusted published read model and add a separate private
  `event_publication_drafts` table for complete metadata reservation and
  interrupted-publication recovery. Only the trusted publisher promotes or
  refreshes published event rows.
- Make one normalized event record power discovery, detail, receipt, ticket, calendar, and maps.
- Add an authoritative event loader through `lib/soroban.ts`.
- Add `EventSalesClosed`, tests, regenerated bindings, and frontend error mapping.
- Remove fabricated placeholders and dead controls rather than hiding missing data.

### Complete when

An event page answers the practical purchase questions using real data; unavailable events cannot enter checkout; stale mirrored state cannot authorize a purchase; calendar output is timezone-correct; and the contract itself closes sales at event start.

**Dependencies:** DR-02, DR-05, DR-07. **Risk: Critical.**

---

## Package 3 — One safe purchase operation and persistent receipt

### At present

- Checkout displays a fake quantity/progress flow although quantity is fixed to one.
- The final-looking Continue button immediately submits payment.
- Ticket ID is generated inside the click handler.
- transaction state is temporary and not persisted;
- the wrapper returns no durable transaction hash;
- timeout, pre-submit failure, approval rejection, chain rejection, and unknown submission collapse into a generic failure;
- success disappears and automatically redirects;
- refresh can lose the result and permit a new ticket ID and payment.

### Required final state

- One review screen states `1 × General Admission` and shows price, simulated fee, total, current test balance, estimated remaining balance, policy summary, and testnet disclosure.
- One `purchase_operation` and one ticket ID are allocated before preparation.
- User-visible states distinguish preparing, approval, submitting, confirming, unknown, failed, chain-confirmed, mirror-syncing, sync-warning, and complete.
- Once submission may have occurred, another Pay action is prohibited.
- The app resolves the existing hash/ticket instead of generating a fresh attempt.
- Chain confirmation opens a durable receipt; no timer hides it.
- Chain failure states no charge/ticket only when the failure is definitive.

### Required system changes

- Add the operation/receipt schema, ownership rules, unique constraints, and route.
- Return transaction hash and status information from the transaction adapter.
- Integrate delegated-wallet approval and wallet-provider idempotency using `operation_id`.
- Persist operation state before, during, and after submission.
- Replace the global auto-dismiss overlay with an in-flow state and persistent receipt.
- Keep local recovery data only as a crash bridge to the durable operation.

### Proof gate

Exercise double-click, approval rejection, refresh at every boundary, timeout after broadcast, same-ticket replay, browser close, and another-device receipt access. None may create a second payment while the first operation is unresolved.

### Complete when

A buyer can tell exactly whether payment was not submitted, is unresolved, failed authoritatively, or succeeded; the transaction hash and ticket ID survive refresh; and the only retry path is demonstrably safe.

**Dependencies:** DR-01, DR-02, DR-03, DR-06. **Risk: Critical.**

---

## Package 4 — Trusted synchronization and owned-ticket recovery

### At present

- Supabase permits anonymous insert/update for events, tickets, listings, and profiles.
- Browser code writes financial mirrors.
- ticket insertion and event-supply increment are separate operations.
- no durable sync attempt or background repair exists;
- ticket discovery queries by the currently active wallet address only;
- receipt and operation ownership do not exist;
- ticket cards use inaccurate labels such as VIP Access and lack durable URLs.

### Required final state

- Public reads are limited to publish-ready discovery data.
- Private account, wallet, operation, and receipt rows are owned by `auth.uid()`.
- Ticket and financial mirrors can be written only after a trusted service verifies chain state.
- One idempotent reconciliation operation updates ticket, authoritative event supply, purchase operation, and sync attempt.
- A browser may close after chain confirmation and synchronization can still be resumed.
- A chain-confirmed purchase remains successful during mirror delay.
- My Tickets resolves the restored attendee wallet, shows the ticket under Upcoming, and links to both ticket and receipt.
- QR generation uses the recoverable delegated signer and never requires a raw secret.

### Required system changes

- Replace permissive RLS with the DR-04 policy matrix.
- Add the Edge Function and an atomic database function/transaction for reconciliation.
- Make sync repair accept an operation/hash reference, then derive owner, event, ticket, status, and supply from the chain.
- Join tickets to complete event metadata for truthful cards and detail pages.
- Add durable ticket URLs and receipt links.
- Replace Active/History and VIP/digital-asset language with Upcoming and ordinary ticketing language.

### Proof gate

Forge every client-supplied field, fail each mirror write independently, repeat repair, switch users, close the browser, and restore the ticket from another device. The forged request must fail, the valid repair must be idempotent, and the user must never be asked to pay again.

### Complete when

The chain-confirmed ticket remains accessible through its operation even while discovery is delayed, synchronization can be safely repaired, another user cannot access private records, and My Tickets restores correctly after sign-out or device change.

**Dependencies:** DR-01, DR-03, DR-04. **Risk: Critical.**

---

## Package 5 — Testnet activation, reset, and reproducible deployment

### At present

- Attendee connection silently calls Friendbot and treats every HTTP 400 as acceptable.
- A temporary overlay claims 10,000 test XLM without proving the final balance.
- checkout has no funding-recovery state.
- Current burner-owned tickets cannot be linked safely to authenticated users.
- `deploy.sh` creates a new contract pair but does not own old-data treatment or every frontend environment value.
- README, decision records, QR description, and build target contain drift from current implementation.

### Required final state

- Wallet provisioning can finish before account activation.
- Checkout shows exact balance and offers explicit Get test XLM only when activation is required.
- The authenticated Edge Function rate-limits Friendbot, verifies the recorded wallet, and confirms the resulting account/balance.
- Existing hackathon evidence is exported before reset.
- Old burner application data is archived, not presented as migrated ownership.
- A fresh Ticket/Marketplace pair is deployed together after the cutoff change.
- Generated bindings, peer addresses, Vite/Supabase/Dfns environment values, explorer links, and docs all match the new deployment.

### Required execution sequence

1. Pin the source commit and export old contract/user evidence.
2. Apply the new schema and RLS without granting authority to legacy anonymous rows.
3. Pass the delegated-wallet and transaction proof.
4. Add and test the contract cutoff.
5. Reset disposable application rows.
6. Deploy and initialize the fresh contract pair.
7. Regenerate bindings and create complete environment templates.
8. Seed or create only publish-ready events.
9. Run one complete first-purchase smoke journey on desktop and mobile.

### Complete when

A new user can obtain test funds through an explicit truthful flow, buy from the fresh deployment, receive a durable receipt, and restore the ticket on another browser. Setup from documented environment files must reproduce the same application without hidden values or old contract references.

**Dependencies:** DR-01, DR-05, DR-06. **Risk: Critical.**

---

## Ordinary product work after the foundations

These tasks are not architectural decisions and should not be allowed to distract from the packages above:

- rename Browse to Discover;
- remove the role-selection landing page;
- remove fake quantity, Tier 1, VIP Access, Floor Price, fixed fee, and NFT-first copy;
- add distinct event-state labels and disabled explanations;
- add Share, Google Calendar, Outlook, `.ics`, and maps actions;
- add Account and truthful testnet disclosure;
- redesign ticket cards around event attendance rather than digital-asset language;
- remove automatic success redirects and dead Follow controls;
- make mobile navigation expose only attendee destinations unless organizer capability is active.

Implement these inside the relevant package, after its data and authority contracts are stable.

## Documentation corrections required at completion

- Revise canonical wallet decisions that still define browser burners as the attendee model.
- Remove the README claim that raw burner secrets are stored securely.
- Describe Google/email sign-in only after it is implemented.
- Align the QR payload description with `{wallet_address}:{ticket_id}:{timestamp}:{signature}`.
- Use the repository's actual contract build target.
- Document `readModelSync`/trusted reconciliation ownership accurately.
- Record the fresh contract pair, archived old pair, and reset policy.

## Slice 1 readiness conclusion

The slice is ready for implementation in the order above because the major product and architecture choices are now locked. The only remaining blockers are narrow proofs: delegated-wallet compatibility with the existing Soroban and QR flows, auth return, transaction recovery/idempotency, trusted reconciliation, contract cutoff, funding behavior, and timezone/calendar correctness.

Do not begin decorative checkout or account screens by inventing temporary identity, wallet, receipt, or synchronization behavior. Pass each proof at the start of its package, then build directly toward the final state.
