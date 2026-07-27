# Product Slice 2: Professional Event Publishing and Organizer Operations

## Product outcome

An organizer can prepare a complete event as a recoverable private draft, publish it exactly once to Stellar, manage the resulting public event from a durable route, view truthful sales and escrow state, cancel safely, and complete the event after it ends.

The finished organizer lifecycle is:

**Draft → Review → Publish → Manage → Cancel or Complete**

This slice is not a visual redesign of the event form. It completes the organizer journey and makes every irreversible action truthful, recoverable, and tied to one authoritative owner.

---

## 1. Starting point

Slice 2 begins after Slice 1 and the later publication and purchase work have already established:

- one durable signed-in human account;
- a separately connected organizer wallet through Freighter;
- URL-based navigation;
- a trusted separation between Soroban authority and the Supabase read model;
- an existing `event_publication_drafts` table;
- an existing `event-publication` service that verifies a confirmed Stellar transaction before promoting a draft into the public event record;
- service-owned public event writes rather than unrestricted browser writes;
- a stable organizer event route at `/organizer/events/:eventId`;
- recoverable operation patterns for externally submitted transactions.

The current publication foundation is useful but incomplete:

- `/organizer/events/new` has no durable draft identifier;
- the frontend loads one latest unpublished row rather than opening a selected draft by ID;
- the publication draft currently behaves as a complete submission record rather than a real incomplete drafting workspace;
- only one unpublished draft is allowed per user;
- draft updates do not use an atomic expected-revision save;
- the transaction hash is normally learned only after `signAndSend()` returns;
- publication verification checks successful chain state but does not yet bind every receipt to the specific emitted contract event;
- organizer event discovery still depends too heavily on the connected wallet;
- cancellation and completion are direct frontend actions without durable operation records, cross-operation locking, or refresh-safe receipts;
- the contract stores one event timestamp, not separate authoritative start and end times;
- a zero-sale event cannot be completed;
- the dashboard estimates escrow instead of reading the actual contract balance;
- marketplace purchase and check-in mutation do not consistently reject every terminal event state.

Slice 2 must extend the existing draft, publication, contract-wrapper, route, and read-model boundaries. It must not create a second draft system, a second publication service, a second published-event ownership record, a backend transaction relayer, or another transaction controller.

---

## 2. Decisions to lock before implementation

### Decision 1: The existing publication draft becomes the only event-draft and human-ownership record

#### At present

`event_publication_drafts` already reserves a stable event ID and supports verified promotion into the public event record. However:

- it requires complete event data;
- only one open draft is allowed per user;
- `/organizer/events/new` does not identify a particular draft;
- the frontend loads one latest unpublished row;
- direct row updates do not provide server-enforced compare-and-swap protection.

Its present state model is focused on final publication rather than the entire drafting journey.

#### Final model

The existing row is evolved into the canonical private event workspace and remains the durable human-ownership record after publication.

An unpublished draft:

- belongs to the signed-in human account;
- is private and never discoverable publicly;
- does not exist on-chain;
- may be incomplete;
- has a stable `draft_id`;
- receives a stable future `event_id` when first created;
- may coexist with the same user’s other drafts;
- records a revision number and last-saved time;
- may be deleted only before publication;
- becomes frozen for publication-critical edits once chain submission may have occurred.

A published draft:

- remains stored with `user_id`, `event_id`, intended organizer wallet, transaction hash, verification time, and `state = 'published'`;
- cannot be deleted;
- is the durable private relationship proving which signed-in user owns organizer-product access to the published event;
- is joined to `published_events` through protected owner-derived reads.

No separate published-event ownership table is introduced in this slice.

The existing `event-publication` service remains the only owner of publication verification and public-record promotion.

#### Durable draft routes

Selecting **Create event** creates the draft first and then navigates to:

`/organizer/drafts/:draftId`

The organizer home lists drafts and opens them by ID. The singular “latest open draft” lookup is retired in favor of:

- list drafts owned by the signed-in user;
- fetch one draft by ID;
- save one draft by ID;
- delete one eligible unpublished draft by ID.

`/organizer/events/new` may remain only as the create-and-redirect entry point. It is not the editor’s durable URL.

#### Server-enforced revision saving

All draft saves use one trusted database compare-and-swap operation that:

1. derives the user from `auth.uid()`;
2. verifies that the draft belongs to that user;
3. verifies that the draft is still editable;
4. accepts `expected_revision`;
5. updates only when the stored revision matches;
6. increments the revision atomically;
7. returns a conflict without overwriting when the revision does not match.

A React revision check is not treated as concurrency protection.

#### Final behavior

When the organizer selects **Create event**:

1. A private draft is created immediately.
2. A stable event ID is reserved.
3. The application navigates to `/organizer/drafts/:draftId`.
4. The organizer may enter only part of the event information.
5. Every successful save updates the same row through the atomic revision operation.
6. The organizer may leave and reopen that exact draft from the dashboard, a direct URL, or another device.
7. Publication uses the draft’s reserved event ID.
8. A refresh, retry, delayed response, or second browser tab cannot create a second on-chain event for the same draft.

Deleting an unpublished draft abandons its reserved event ID. That ID is never silently reassigned to another event.

The new route is added consistently to the route tree, protected auth-intent validation, navigation handling, SPA fallback expectations, and direct-link tests.

#### Why this prevents rework

This preserves the publication and ownership evidence already present in the repository while making it useful throughout the organizer journey. It prevents lost drafts, ambiguous reopening, silent concurrent overwrites, duplicate ownership records, and inconsistent event IDs.

---

### Decision 2: Human product ownership and wallet contract authority remain separate

#### At present

The signed-in user owns the publication draft, but published organizer events are primarily discovered by filtering public events through the connected organizer wallet.

The published draft already retains the user, reserved event, intended organizer wallet, transaction hash, and publication state. Creating another ownership table would duplicate that relationship.

#### Final model

The signed-in human account owns:

- unpublished drafts;
- published draft records;
- organizer profile information;
- organizer-product access to published events;
- editable public metadata;
- durable publication, cancellation, and settlement records.

The organizer wallet owns authoritative contract actions:

- publishing the event;
- cancelling the event;
- completing the event and releasing escrow.

Protected organizer reads derive `auth.uid()` and join that user’s published draft records to `published_events`. They do not accept a client-supplied wallet address as the ownership selector.

Published draft records are undeletable. Only unpublished drafts may be deleted.

#### Final behavior

A signed-in organizer can:

- see all owned drafts and published events without Freighter connected;
- open `/organizer/drafts/:draftId` and `/organizer/events/:eventId` directly;
- edit eligible public metadata without signing a Stellar transaction;
- open historical publication, cancellation, and settlement receipts.

To publish, cancel, or complete an event:

- the exact organizer wallet must be connected;
- the wallet must match the organizer stored or expected for the event;
- the operation must be signed by that wallet.

When the wrong wallet is connected, the page says:

> This event belongs to GABC…1234. Switch to the correct organizer wallet to continue.

The user sees this before attempting the transaction. A generic contract failure is not used as wallet guidance.

#### Why this prevents rework

The published draft remains the single durable human-ownership record. Freighter remains the only signer for organizer contract authority. Neither identity replaces the other, and no second ownership lifecycle can disagree with publication history.

---

### Decision 3: Publication locks contract terms but not all public information

#### Final model

Before publication, every draft field is editable.

After publication, fields are divided into three classes.

#### Class A — Locked contract terms

These cannot be changed through ordinary event settings:

- event ID;
- organizer wallet;
- event title;
- start time;
- end time;
- capacity;
- ticket price.

The payment asset remains the deployment-level trusted XLM token for this slice. It does not need to be duplicated as a field in every event record.

The product supports one General Admission capacity and price. “General Admission” is a product rule, not another on-chain event field.

#### Class B — Editable supporting information

These may be updated after publication:

- short summary;
- full description;
- poster;
- organizer display information;
- support contact;
- entry instructions;
- accessibility notes;
- age restriction;
- prohibited-item or venue notes;
- public links.

Each successful update records:

- metadata revision;
- update time;
- signed-in user responsible for the update.

#### Class C — Venue information

Before the first ticket sale, the organizer may correct:

- venue name;
- address;
- city;
- map location.

After the first authoritative sale, these fields are locked in Slice 2.

The trusted metadata-update path must read the current event from Soroban before accepting a venue change. A disabled frontend control alone is not enforcement.

#### Unsupported material changes

Slice 2 does not disguise the following as normal metadata edits:

- rescheduling;
- changing venue after tickets have been sold;
- reducing capacity;
- changing ticket price;
- changing organizer;
- changing payment asset.

#### Final behavior

The event settings screen labels fields as:

- **Editable**
- **Locked after publication**
- **Locked after first sale**

A control is not shown as editable unless the trusted update path can actually save it.

Metadata saves use ordinary save states, not wallet-signing or blockchain transaction states. The previous public revision remains visible until the new revision is successfully stored.

---

### Decision 4: The product lifecycle is richer than the contract enum

#### At present

The TicketContract has three event statuses:

- `Active`
- `Cancelled`
- `Completed`

The current organizer interface can label every active event as upcoming, even after it starts or ends.

#### Final model

The small contract enum remains authoritative, while the product derives useful display states from:

- draft state;
- publication operation state;
- contract status;
- current time;
- authoritative start time;
- authoritative end time;
- current supply and capacity;
- cancellation or completion operation state;
- mirror synchronization state.

“Active” is never used as the only organizer-facing lifecycle label.

---

### Decision 5: Start and end time become authoritative, and terminal status closes mutation paths

#### At present

The contract stores one `date_unix` value. Primary sales close at that time, and escrow becomes releasable after that same time. A zero-sale event cannot be completed because release currently rejects an escrow balance of zero.

Two existing terminal-state gaps also remain:

- Marketplace resale purchase rejects `Cancelled` but not every non-Active event;
- `mark_used` verifies organizer and ticket state but does not require the event itself to remain Active.

#### Final model

A published event contains:

- authoritative `start_unix`;
- authoritative `end_unix`.

The TicketContract requires:

- start time is in the future when the event is created;
- end time is later than start time;
- primary sales close at start time;
- completion becomes available only at or after end time;
- cancellation is valid only from `Active`;
- completion is valid only from `Active`;
- `mark_used` is valid only while the associated event is `Active`.

The MarketplaceContract requires `event.status == Active` when buying a listing. It does not merely reject `Cancelled`; it also rejects `Completed`.

The organizer explicitly completes the event. Completion is not automatic.

For completion:

- when escrow is greater than zero, the contract marks the event Completed and releases the full eligible escrow;
- when escrow is zero, the contract marks the event Completed without attempting a zero-value transfer;
- both paths emit the same completion event with the exact released amount, including `0`.

The accepted stale-listing model remains. Listing creation does not need a new lock because authoritative purchase-time rejection is sufficient.

#### Why this prevents rework

One authoritative schedule and one Active-only mutation rule support sales closure, check-in safety, resale safety, settlement, history, and future notification work without conflicting definitions. Cancellation preserves refund eligibility, and completion truly makes the event historical.

---

### Decision 6: Soroban remains the financial authority

#### At present

The organizer dashboard derives escrow from mirrored supply multiplied by the original price. This is not the actual held balance after refunds or settlement.

#### Final model

Supabase may answer:

- which events belong in organizer lists;
- public metadata;
- durable operation and receipt discovery;
- last synchronized display state.

Soroban must answer:

- organizer wallet;
- event status;
- current supply;
- capacity;
- ticket price;
- start and end times;
- actual escrow balance;
- whether cancellation is allowed;
- whether completion is allowed.

The TicketContract exposes a public keyed escrow read for an event.

#### Final metrics

The organizer may see:

- **Published events** — count of user-owned published events;
- **Tickets sold** — authoritative current supply;
- **Gross primary sales** — ticket price × tickets sold, clearly labelled as derived;
- **Held in escrow** — authoritative contract escrow balance;
- **Available for settlement** — authoritative escrow for active events whose end time has passed;
- **Sell-through** — authoritative supply divided by capacity.

Gross sales and current escrow are never presented as the same value.

Slice 2 does not calculate “refunded amount” as gross sales minus escrow. That formula becomes false after settlement. A refunded-total metric is omitted unless a complete trusted refund source exists.

When Soroban is unavailable, mirrored financial values may be shown only as stale or unavailable display data. They are never labelled confirmed and never enable cancellation or completion.

---

### Decision 7: Event management remains event-specific

#### At present

The durable route `/organizer/events/:eventId` already exists, but the page is currently a thin check-in entry point. Destructive and financial actions still appear directly in the dashboard rows.

#### Final model

`/organizer/events/:eventId` becomes the operational home for one published event.

It contains:

- **Overview**
- **Public listing**
- **Sales and funds**
- **Event settings**
- **Activity**

The Activity section is deliberately bounded to operations Slice 2 can prove:

- event published;
- public metadata updated;
- event cancelled;
- event completed;
- escrow released.

Per-ticket purchases, refund claims, and resale events are not promised as a complete timeline in this slice.

The dashboard row primarily provides **Manage event**. Cancellation and completion occur inside the event context, where the organizer can review consequences and receipts.

---

### Decision 8: Cancellation and completion share one terminal-operation owner and one event-level lock

#### At present

Cancellation and release are frontend-triggered contract actions followed by mirror synchronization. They do not have durable operation routes or refresh-safe receipts.

Treating cancellation and completion as independently locked actions is insufficient. They are competing terminal transitions for the same Active event.

#### Final model

One organizer lifecycle operation model owns both:

- `cancel_event`;
- `complete_event`.

It does not replace the existing publication service. It provides the same recovery discipline for later organizer actions.

Each operation records:

- operation ID;
- signed-in user ID;
- event ID;
- operation type;
- expected organizer wallet;
- cancellation reason when applicable;
- state;
- signed transaction hash;
- confirmed contract event proof;
- confirmed released amount when applicable;
- chain confirmation time;
- mirror synchronization state;
- last error and timestamps.

The cancellation reason is saved privately before the wallet signature is requested. It becomes public only after authoritative cancellation succeeds.

#### One unresolved terminal operation per event

The server-side operation allocator enforces one unresolved terminal operation per event across both cancellation and completion.

Allocation uses:

- one server-side transaction or equivalent event-scoped advisory lock;
- a partial uniqueness rule on `event_id` covering unresolved and nonterminal terminal-operation states;
- an eligibility check that returns or blocks on the existing unresolved operation regardless of its type.

A definitive pre-submission failure or authoritative failure may release the event for a new operation. These states continue to block both cancellation and completion:

- approval completed and signed hash persisted;
- submitting;
- confirmation pending;
- status unknown;
- authoritative success;
- mirror syncing;
- sync warning.

The product never presents simultaneous cancellation and completion wallet flows for the same event.

#### Why this prevents rework

Cancellation and completion have one durable owner, one cross-operation exclusion rule, and one safe recovery path. The contract remains the final transition authority, but the product does not create contradictory pending workflows or receipts.

---

### Decision 9: Signed-hash persistence and contract-event proof define transaction recovery

#### Signed hash before submission

For publication, cancellation, and completion, the transaction hash becomes durable before the SDK can submit the signed transaction:

1. `lib/soroban.ts` prepares the generated `AssembledTransaction`.
2. A wrapped organizer `SignFn` requests Freighter approval.
3. After Freighter returns `signedTxXdr`, the application computes the transaction hash.
4. The hash is persisted against the publication draft or lifecycle operation.
5. Only after persistence succeeds does the wrapper return the signed XDR to `signAndSend()`.
6. If hash persistence fails, the wrapper throws before the SDK receives the signed XDR, so submission cannot begin.

After the signed hash is stored, transport loss or timeout becomes **Status unknown**. A replacement attempt is allowed only after authoritative failure or provable expiration/non-submission.

This uses the existing generated transaction lifecycle. Slice 2 does not add a backend XDR builder, relayer, or second submitter.

#### Every receipt proves its specific action

A successful transaction and current contract state are both necessary, but neither alone is enough to prove the receipt’s action.

The trusted verifier binds each receipt to the configured network, configured contract ID, and matching emitted contract event:

- publication: `ev_create` with the reserved event ID;
- cancellation: `ev_cancel` with the event ID;
- completion: `ev_rel` with the event ID and released amount;
- zero-escrow completion: `ev_rel` with the event ID and amount `0`.

The verifier validates:

- configured network;
- configured contract ID;
- transaction success;
- organizer source where applicable;
- matching event topic and event ID;
- matching operation type;
- released amount for completion;
- resulting current contract state.

Current-state verification remains required. It is not used as a substitute for transaction-specific proof.

#### Why this prevents rework

The product can recover from a lost SDK response using a known transaction identity, and every durable receipt proves the exact operation it represents rather than an unrelated successful transaction from the same wallet.

---

### Decision 10: Contract ABI changes use a coordinated testnet deployment

Adding authoritative end time changes the serialized Event structure. That affects:

- TicketContract storage and tests;
- MarketplaceContract’s mirrored TicketContract interface;
- generated TypeScript bindings;
- `lib/soroban.ts` wrappers and conversions;
- Supabase event mappings;
- deployment IDs and environment values;
- architecture and decision documentation.

For the current Testnet product, Slice 2 uses a coordinated deployment of the updated TicketContract and MarketplaceContract, regenerates both bindings, updates their mutually stored addresses, and updates the frontend environment from the same deployment.

Old testnet data may remain historical but is not silently mixed with the new deployment. The active read model is scoped to the configured network and contract IDs.

---

## 3. Final organizer experience

### Step 1: Enter the organizer area

The signed-in user selects **Organize events** from the account or primary navigation.

The organizer home shows:

- Drafts
- Published
- Completed
- Cancelled

Drafts are loaded by authenticated owner. Published, completed, and cancelled events are loaded by joining that user’s published draft records to the public event records. These lists do not depend on whether Freighter is currently connected.

A user with no events sees a useful empty state and one primary action:

**Create your first event**

The empty state does not lead with meaningless zero-value analytics cards.

---

### Step 2: Create and open a recoverable draft

Selecting **Create event** immediately creates a private draft containing:

- stable draft ID;
- stable future event ID;
- owner user ID;
- draft state;
- revision number;
- created time;
- updated time.

The application then navigates to:

`/organizer/drafts/:draftId`

No contract transaction occurs.

The organizer dashboard lists every eligible unpublished draft and reopens the selected draft by ID. A direct URL or refresh returns to the same draft, subject to owner authorization.

The editor contains five real sections:

1. Event details
2. Schedule and location
3. Ticketing
4. Policies and entry
5. Review

The section indicator reflects saved completion. It is not a decorative progress animation.

---

### Step 3: Save and resume truthfully

The editor shows one of these save states:

- **Saving**
- **Saved at [time]**
- **Unsaved changes**
- **Could not save**
- **Offline**
- **Newer version detected**

Every save sends the last accepted revision to the trusted compare-and-swap operation. The server derives `auth.uid()`, verifies ownership and editable state, updates only when the stored revision matches, and increments the revision atomically.

When a conflict is detected:

- the stale save does not overwrite the newer draft;
- the organizer’s current unsaved values remain visible;
- the page explains that a newer server revision exists;
- the organizer may preserve local text and reload the latest version.

An offline browser keeps the current local changes and does not claim they are saved to the account.

---

### Step 4: Complete the real event information

#### Event details

Required:

- title;
- category;
- short summary;
- full description;
- poster;
- organizer display name.

No generic stock poster is published. A draft preview may show a clearly marked placeholder, but publication remains unavailable until a real poster is supplied.

#### Schedule and location

Required:

- start date and time;
- end date and time;
- IANA timezone;
- venue name;
- full address;
- city;
- map location or a functional map-search action.

Slice 2 supports physical events only.

#### Ticketing

The editor shows only what the contract supports:

- General Admission;
- total capacity;
- one price in XLM;
- sales close at event start;
- Stellar Testnet disclosure.

It does not show unsupported options for VIP, early bird, reserved seating, multiple tiers, discount codes, or per-user quantities.

#### Policies and entry

The organizer reviews the platform rules that are actually enforced:

- primary-sale funds remain in escrow until completion;
- cancellation enables pull-based attendee refunds at the original mint price;
- resale uses the platform marketplace;
- entry uses a rotating signed QR;
- free owner transfer outside the marketplace is not supported.

The organizer supplies:

- support contact;
- entry instructions;
- accessibility notes when applicable;
- age restriction when applicable;
- prohibited-item or venue notes when applicable.

The organizer cannot invent a custom refund policy that the contract does not enforce.

---

### Step 5: Review publication readiness

The Review section provides:

- attendee-facing preview;
- contract-term summary;
- supporting metadata summary;
- exact completeness checklist;
- immutable-term warning;
- connected organizer wallet;
- estimated network fee from the real transaction preparation flow;
- testnet disclosure.

Each incomplete checklist item links back to the correct editor section.

The organizer acknowledges:

> Event title, start and end time, capacity, ticket price, and organizer wallet cannot be changed through ordinary editing after publication.

**Publish event** remains unavailable until every requirement is satisfied.

---

### Step 6: Run publication preflight

Before opening Freighter, the application verifies:

- the user is authenticated;
- the draft belongs to that user;
- the draft revision is current;
- the correct organizer wallet is connected;
- the wallet can sign;
- the start time remains in the future;
- the end time is later than the start time;
- capacity and price are valid;
- required metadata is complete;
- the reserved event ID is not already published;
- no previous publication submission is unresolved;
- the configured Stellar network and TicketContract match the draft;
- the wallet has enough XLM for the network operation.

When a preflight check fails, no wallet approval is requested.

---

### Step 7: Publish exactly once

The publication experience reflects real boundaries:

1. **Preparing event**
2. **Waiting for wallet approval**
3. **Recording signed transaction**
4. **Submitting to Stellar**
5. **Confirming event creation**
6. **Creating public listing**
7. **Published**

If the organizer rejects wallet approval, the draft returns safely to review and no signed hash or submission is recorded.

After Freighter returns the signed XDR:

- the application computes the transaction hash;
- the existing publication owner stores that hash against the draft;
- the signed XDR is returned to `signAndSend()` only after persistence succeeds;
- failure to persist stops submission before it begins.

If submission may have occurred but the result is unknown:

- the draft shows **Publication status unknown**;
- another Publish submission is blocked;
- the only action is **Check publication status**.

The publication verifier accepts the receipt only when the configured TicketContract emitted `ev_create` for the draft’s reserved event ID and the resulting current contract state matches.

If the chain confirms creation but public promotion is delayed:

- publication remains successful;
- the event shows **Publication needs attention**;
- the existing event ID and transaction hash remain attached;
- the only recovery action is **Retry public listing sync**;
- `create_event` is never submitted again.

The durable publication result shows:

- event ID;
- organizer wallet;
- transaction hash;
- verified `ev_create` proof;
- publication time;
- public event link;
- metadata synchronization status.

It remains accessible after refresh and does not auto-dismiss.

Actions:

- View public event
- Manage event
- Copy event link
- View transaction

---

### Step 8: Manage the published event

The event route shows a status header derived from current authoritative state:

- On sale
- Sold out
- In progress
- Awaiting completion
- Completed
- Cancelled
- Publication needs attention
- Cancellation status unknown
- Settlement status unknown

The Overview contains:

- event start and end;
- public event link;
- organizer wallet;
- latest metadata revision;
- current supply and capacity;
- gross primary sales;
- actual escrow;
- settlement eligibility;
- latest confirmed organizer activity.

The page reads current Soroban event and escrow values before enabling any lifecycle action.

---

### Step 9: Update eligible public information

The organizer edits only the fields that remain supported.

Before saving, the page distinguishes:

- public and editable information;
- contract terms locked after publication;
- venue fields locked after the first authoritative sale.

The trusted update path derives the signed-in user, verifies event ownership, reads current authoritative supply when venue fields change, and applies the next metadata revision only when the supplied revision is current.

After success:

- the public page shows the new revision;
- the update time is recorded;
- the organizer remains on the event route;
- Activity records **Public information updated**.

After failure:

- the previous public revision remains visible;
- unsaved edits remain available;
- the page does not display a false success state.

---

### Step 10: Monitor sales and escrow

The Sales and funds section distinguishes:

#### Sales

- tickets sold;
- tickets remaining;
- sell-through percentage;
- gross primary sales.

#### Escrow

- actual held XLM balance;
- settlement eligibility;
- settlement destination;
- latest authoritative confirmation time;
- confirmed completion receipt when available.

No refunded-total metric is shown unless supported by complete trusted refund data.

If Supabase is unavailable, the organizer route may still read authoritative event and escrow state by event ID.

If Soroban is unavailable, financial values are marked unavailable or stale and lifecycle actions remain disabled.

---

### Step 11A: Cancel the event

**Cancel event** is available only when:

- the current event is authoritatively Active;
- the correct organizer wallet is connected;
- no unresolved cancellation or completion operation exists for that event.

The cancellation review shows:

- event name;
- start and end time;
- tickets sold;
- actual remaining escrow;
- attendee refund consequence;
- resale consequence;
- irreversibility;
- organizer wallet.

The organizer provides a public cancellation reason. That reason is stored privately with the operation before wallet approval.

The organizer deliberately confirms by typing the event name or using an equivalently explicit confirmation.

When the cancellation operation begins:

1. The server allocates or resumes the one unresolved terminal-operation slot for the event.
2. Freighter returns the signed XDR.
3. The application computes and persists the signed transaction hash before submission can begin.
4. Transport uncertainty after that point becomes **Cancellation status unknown** and continues blocking both cancellation and completion.

The cancellation receipt is confirmed only when the configured TicketContract emitted `ev_cancel` for that event and current contract state is Cancelled.

After authoritative confirmation:

- the event displays Cancelled;
- primary sales stop;
- Marketplace resale purchases fail because purchase requires an Active event;
- check-in mutation fails because `mark_used` requires an Active event;
- active ticket holders retain cancellation refund eligibility;
- the public event displays the cancellation reason;
- completion remains permanently disabled;
- a durable cancellation receipt is available.

If public synchronization is delayed:

- the page says **Cancellation confirmed — public status syncing**;
- neither cancellation nor completion can be submitted;
- only synchronization may be retried.

---

### Step 11B: Complete the event

After authoritative end time, an Active event displays **Awaiting completion**.

**Complete event** is available only when:

- the event remains authoritatively Active;
- authoritative end time has passed;
- the correct organizer wallet is connected;
- no unresolved cancellation or completion operation exists for that event.

The completion review shows:

- event name;
- authoritative end time;
- tickets sold;
- gross primary sales;
- actual escrow to release;
- destination organizer wallet;
- network fee estimate.

When escrow is greater than zero, the action is:

**Complete event and release [amount] XLM**

When escrow is zero, the action is:

**Complete event**

When the completion operation begins:

1. The server allocates or resumes the one unresolved terminal-operation slot for the event.
2. Freighter returns the signed XDR.
3. The application computes and persists the signed transaction hash before submission can begin.
4. Transport uncertainty after that point becomes **Settlement status unknown** and continues blocking both completion and cancellation.

The settlement receipt is confirmed only when the configured TicketContract emitted `ev_rel` for the event with the exact released amount. Zero-escrow completion must emit and verify `ev_rel` with amount `0`.

After authoritative confirmation:

- event status becomes Completed;
- positive escrow is transferred to the organizer;
- zero-escrow completion performs no zero-value transfer;
- the confirmed released amount is stored;
- cancellation and another completion are disabled;
- Marketplace resale purchases fail because purchase requires an Active event;
- check-in mutation fails because `mark_used` requires an Active event;
- a durable settlement receipt is available;
- the organizer page reloads current chain state.

---

## 4. Required state models

### 4.1 Draft lifecycle

| State | Authority and meaning | Primary action | Prohibited behavior |
|---|---|---|---|
| Draft | Private server record; incomplete or complete | Continue editing | Public discovery |
| Ready to publish | Completeness checks pass | Review and publish | Silent publication |
| Publication review | No transaction submitted | Confirm or leave | Wallet prompt before preflight |
| Publishing | Submission workflow is active | View status | Duplicate Publish |
| Publication status unknown | Submission may have occurred | Check status | New `create_event` submission |
| Publication needs attention | Chain event exists; public promotion incomplete | Retry public sync | Recreate event |
| Published | Chain and public record agree | View or manage | Edit locked terms |
| Deleted | Unpublished draft removed | None | Reuse abandoned event ID |

### 4.2 Draft save states

| State | Meaning | User experience |
|---|---|---|
| Saved | Server has the current revision | Saved time is shown |
| Saving | A revision is being written | Non-blocking indicator |
| Unsaved changes | Local form is newer than server | Leave warning |
| Save failed | Server rejected or could not store revision | Edits remain; retry available |
| Newer version detected | Another save has a higher revision | Current edits remain visible; reload required before saving |
| Offline | Server cannot be reached | Local changes are preserved but not described as account-saved |

### 4.3 Published-event display states

| Condition | Organizer display | Public effect |
|---|---|---|
| Active, before start, supply below capacity | On sale | Purchasable |
| Active, before start, capacity reached | Sold out | Primary purchase unavailable |
| Active, start reached, end not reached | In progress | Primary sales closed |
| Active, end reached | Awaiting completion | Event ended |
| Completion unresolved | Settlement status unknown | No duplicate completion |
| Completed | Completed | Historical event |
| Cancellation unresolved | Cancellation status unknown | No duplicate cancellation |
| Cancelled | Cancelled | Primary and resale purchase blocked |
| Authoritative read unavailable | Status unavailable | No financial or lifecycle action enabled |

### 4.4 Organizer chain-operation states

Publication, cancellation, and completion use these externally meaningful states:

| State | Meaning | Required behavior |
|---|---|---|
| Review | Nothing submitted | User may confirm or leave |
| Preparing | Inputs and authority are being checked | No wallet prompt yet |
| Approval required | Correct wallet must approve | Clear wallet instruction |
| Recording signed transaction | Freighter returned signed XDR; hash must be stored before submission | If persistence fails, do not return XDR to the SDK |
| Submitting | Signed hash is durable and the transaction is being sent | Action disabled |
| Confirmation pending | Transaction hash exists; final result pending | Durable pending state |
| Status unknown | Submission may have occurred but outcome is unresolved | Block replacement submission; allow status check |
| Authoritative failure | Contract rejected or confirmed transaction failed | Show exact actionable reason; release lock when safe |
| Authoritative success | Matching emitted event and resulting state are verified | Operation remains successful |
| Mirror syncing | Public/read-model state is catching up | Do not relabel as failure |
| Sync warning | Authority succeeded but mirror remains delayed | Retry only synchronization |
| Complete | Authority, action-specific receipt proof, and required read model agree | Show durable receipt |

For cancellation and completion, one unresolved event-level terminal-operation slot covers both operation types. `Status unknown`, confirmation pending, mirror syncing, and sync warning continue blocking both actions.

Metadata updates do not use this chain-operation model. They use the draft-style revision save states.

---

## 5. Permission states

| State | Experience |
|---|---|
| Signed out | Public events remain visible; organizer area requests sign-in |
| Signed in, no Freighter connection | Drafts and owned published events remain visible; chain actions request wallet connection |
| Correct wallet connected | Eligible chain actions may be enabled after authoritative checks |
| Wrong wallet connected | Event remains readable; Switch wallet action is shown |
| Wallet approval rejected | No state change; return safely to review |
| Wallet unavailable | Explain installation, connection, or account problem |
| Event belongs to another user | No organizer management access |
| Signed-in owner with wrong organizer wallet | Metadata access may remain; chain controls stay disabled |
| Staff member | Not supported; no implied access |

---

## 6. Minimum data and authority contract

### 6.1 Authoritative TicketContract event data

The event record contains:

- organizer wallet;
- event title;
- start timestamp;
- end timestamp;
- capacity;
- ticket price;
- current supply;
- event status.

The event ID remains the storage key.

Escrow remains keyed separately and is available through an authoritative public read.

The trusted XLM token remains contract configuration rather than a caller-supplied or per-event authority field.

### 6.2 Private and published event draft

The existing draft record contains:

- draft ID;
- owner user ID;
- stable event ID;
- intended organizer wallet when selected;
- all editor values, including incomplete values;
- draft lifecycle state;
- completeness result;
- revision number;
- created time;
- updated time;
- publication operation reference;
- signed publication transaction hash when approved;
- verified `ev_create` proof;
- chain verification and publication timestamps;
- last error.

Unpublished rows may be deleted by their authenticated owner when no submission is unresolved.

Published rows:

- remain stored;
- are undeletable;
- retain `user_id`, `event_id`, intended organizer wallet, transaction hash, verification time, and `state = 'published'`;
- serve as the durable human-ownership record for organizer-product access.

### 6.3 Owner-derived organizer reads

A protected RPC or view:

- derives `auth.uid()`;
- lists the user’s unpublished drafts;
- fetches a selected draft by ID;
- joins the user’s published draft records to `published_events`;
- never accepts a client-supplied wallet as a replacement for human ownership.

No second published-event ownership table is added.

### 6.4 Public metadata

Public metadata may include:

- category;
- short summary;
- full description;
- poster;
- venue name;
- address;
- city;
- timezone;
- map location;
- organizer display identity;
- support contact;
- entry instructions;
- accessibility notes;
- age restriction;
- prohibited-item information;
- cancellation reason after confirmed cancellation;
- metadata revision;
- last updated time.

### 6.5 Organizer profile

The existing human-owned profile model is extended rather than creating another competing profile system.

Required before publication:

- organizer display name;
- support contact;
- linked publishing wallet for the current draft.

Optional:

- avatar or logo;
- biography;
- website;
- social links.

No Verified Organizer badge appears until a real verification process exists.

### 6.6 Organizer lifecycle operation

A cancellation or completion operation records:

- operation ID;
- user ID;
- event ID;
- operation type;
- expected organizer wallet;
- cancellation reason when applicable;
- state;
- signed transaction hash;
- configured network and contract ID;
- verified emitted event topic and event ID;
- confirmed released amount when applicable;
- chain confirmation time;
- mirror state;
- created and updated times;
- last error.

The operation store enforces one unresolved terminal operation per `event_id` across both cancellation and completion. A server-side allocation lock and partial uniqueness rule prevent competing records from being created concurrently.

---

### 6.7 Derived presentation values

The application may derive:

- tickets remaining;
- sell-through percentage;
- gross primary sales;
- event countdown;
- event duration;
- display lifecycle state;
- settlement eligibility.

Derived values improve presentation. They never authorize a contract action.

### 6.8 Values that must never authorize actions

Supabase copies of the following may support discovery but never authorize publishing, cancellation, completion, refunds, resale, or entry:

- organizer wallet;
- event status;
- current supply;
- capacity;
- ticket price;
- start and end time;
- escrow balance;
- settlement eligibility.

---

## 7. Publication completeness rule

An event may not be published until it has:

- title;
- category;
- short summary;
- full description;
- real poster;
- organizer display identity;
- support contact;
- future start time;
- valid end time;
- valid timezone;
- venue;
- full address;
- city;
- capacity;
- price;
- entry instructions;
- visible platform cancellation and resale policy summaries;
- correct connected organizer wallet.

The public listing must not use fabricated completion defaults such as:

- Venue TBA;
- Time TBA;
- Unnamed Event;
- generic stock poster;
- anonymous organizer;
- fabricated map location.

An incomplete event remains a draft.

---

## 8. Work packages

### Package A — Authoritative schedule, terminal guards, receipt events, and deployment foundation

#### Final state

The contracts support:

- authoritative start and end times;
- sales closure at start;
- completion only after end;
- zero-sale completion;
- active-only cancellation and completion;
- public keyed escrow reads;
- Marketplace purchase only while the event is Active;
- `mark_used` only while the event is Active;
- `ev_rel` emission for both positive and zero-value completion.

#### System guarantee

TicketContract, MarketplaceContract interface, generated bindings, frontend wrappers, read-model mappings, emitted-event verification, and deployment IDs all represent the same Event ABI and active testnet deployment.

#### Completion boundary

This package is complete when the paired contracts are deployed together, their stored addresses agree, bindings are regenerated, and focused contract tests prove schedule rules, terminal transitions, resale rejection, check-in rejection, refund preservation, escrow reads, and zero-value completion proof.

---

### Package B — Durable draft workspace, published-draft ownership, and one-time publication

#### Final state

An organizer can:

- create multiple incomplete drafts;
- open each draft through `/organizer/drafts/:draftId`;
- save through an atomic expected-revision operation;
- reopen a selected draft from another device;
- review the attendee-facing result;
- publish the reserved event ID exactly once through the existing publication owner;
- continue seeing the published event through the preserved published-draft record.

#### System guarantee

Refresh, stale saves, wallet rejection, signed-hash persistence failure, network interruption, delayed response, repeated service calls, and metadata failure cannot lose newer draft work or create a duplicate event. Publication receipts are accepted only with matching `ev_create` proof.

#### Completion boundary

This package is complete when a user can create several drafts, deep-link to one, encounter a two-tab save conflict without data loss, publish, refresh during the operation, and recover to either safe review, unresolved status, public-sync repair, or a durable action-specific publication receipt.

---

### Package C — Event-specific management and truthful operational data

#### Final state

Every published event has a complete management page with:

- derived lifecycle state;
- public listing link;
- safe metadata editing;
- authoritative sales values;
- authoritative escrow;
- settlement readiness;
- bounded confirmed organizer activity.

#### System guarantee

Human ownership controls access to organizer records. Soroban controls financial and lifecycle truth. Venue edits are server-enforced against authoritative supply.

#### Completion boundary

This package is complete when the organizer can deep-link or refresh the event route and independently verify its current public, operational, and financial state without relying on a connected wallet merely to discover it.

---

### Package D — Safe, mutually exclusive cancellation and completion

#### Final state

The organizer can:

- cancel an eligible event through deliberate review;
- provide a public reason;
- see attendee and resale consequences;
- complete an ended event;
- release real escrow;
- complete a zero-sale event;
- retain durable cancellation and settlement receipts.

#### System guarantee

Only one unresolved terminal operation exists for an event across cancellation and completion. The signed hash is stored before submission. Possible submission is never treated as ordinary failure. Receipts require matching `ev_cancel` or `ev_rel` proof. Chain success remains success when public synchronization is delayed. Retrying synchronization never repeats cancellation or completion.

#### Completion boundary

This package is complete when cancellation and completion remain mutually exclusive and correct across two tabs, refresh, wallet rejection, hash-persistence failure, delayed confirmation, initially unknown status, mirror failure, and zero-value settlement.

---

## 9. Corrected implementation order

1. **Contract correctness**
   - authoritative start and end schedule;
   - keyed escrow read;
   - zero-value completion with `ev_rel(..., 0)`;
   - active-only cancellation and completion;
   - Active-event guards for Marketplace purchase and `mark_used`;
   - action-specific emitted events and focused tests.

2. **ABI and coordinated deployment**
   - Marketplace mirrored Event interface;
   - regenerated bindings;
   - `lib/soroban.ts`;
   - frontend models and read-model mappings;
   - deployment script and environment output;
   - active deployment scoping.

3. **Publication proof and recovery**
   - wrapped organizer `SignFn`;
   - signed-hash persistence before `signAndSend()` can submit;
   - `ev_create` transaction binding;
   - truthful non-submitted, status-unknown, authoritative-failure, and success states.

4. **Draft migration and ownership**
   - relax draft completeness constraints;
   - remove the one-open-draft restriction;
   - add revision and deletion rules;
   - preserve published drafts as human ownership;
   - add owner-derived list, fetch, atomic save, delete, and published-event read operations.

5. **Draft routes and editor**
   - create-and-redirect entry;
   - `/organizer/drafts/:draftId`;
   - multiple-draft dashboard;
   - compare-and-swap save states;
   - auth-intent and direct-link handling;
   - review and publication preflight.

6. **Organizer lifecycle operations**
   - one cross-type unresolved-operation lock;
   - pre-submission signed-hash persistence;
   - cancellation and completion event proof;
   - mirror-only retry;
   - durable receipts.

7. **Management experience**
   - authoritative event and escrow reads;
   - metadata revision updates;
   - lifecycle labels;
   - bounded Activity;
   - removal of direct dashboard cancellation and release paths.

8. **Final verification**
   - direct links and refresh;
   - two-tab draft saves;
   - competing cancellation/completion attempts;
   - wrong-wallet behavior;
   - unknown submission recovery;
   - mirror failure;
   - terminal resale and check-in rejection;
   - paired deployment;
   - architecture and decision documentation.

---

## 10. Explicitly out of scope

Do not add these during Slice 2:

- ticket tiers;
- multiple ticket quantities;
- reserved seating;
- early-bird pricing;
- promotion codes;
- custom refund policies;
- rescheduling after publication;
- venue relocation after the first sale;
- organizer staff and delegated permissions;
- full attendee lists;
- scanner redesign;
- check-in analytics;
- organizer announcements;
- notification delivery;
- stablecoin or fiat settlement;
- automatic escrow release;
- dispute resolution;
- bulk organizer-triggered refunds;
- complete purchase/refund/resale activity indexing;
- advanced revenue charts;
- generic AI organizer assistant.

These features require separate product models or depend on the organizer foundations completed here.

---

## 11. Definition of done

### Organizer entry and ownership

- A signed-in user enters the organizer area without replacing attendee identity.
- Drafts and owned published events are visible without Freighter connected.
- A useful empty state replaces meaningless zero analytics.
- Published organizer access is derived from the signed-in user’s undeletable published draft record.
- A protected owner-derived read joins published drafts to public events.
- No separate published-event ownership table exists.
- Chain actions require the exact on-chain organizer wallet.
- A wrong wallet produces an actionable Switch wallet state before submission.

### Drafting

- Selecting Create event immediately creates a private draft and redirects to `/organizer/drafts/:draftId`.
- The dashboard lists and opens drafts by ID.
- More than one unpublished draft may exist for the same user.
- No contract event is created while editing.
- The draft route survives refresh, Back/Forward navigation, and direct opening.
- The draft can be reopened on another device.
- Saved, unsaved, failed, offline, and conflict states are truthful.
- Every save derives `auth.uid()`, verifies ownership and editable state, checks `expected_revision`, and increments revision atomically.
- Two tabs cannot silently overwrite one another.
- A failed save preserves the organizer’s current work.
- Only unpublished drafts may be deleted.
- Required fields have concrete validation.
- No incomplete draft appears publicly.
- No fabricated event content is silently published.

### Publication

- The organizer sees the attendee-facing result before publication.
- Locked terms are identified before wallet approval.
- Publish remains unavailable until completeness passes.
- Start and end times are timezone-correct.
- The contract rejects invalid schedules.
- The expected organizer wallet is visible before confirmation.
- One draft cannot create two on-chain events.
- Refresh during publication preserves the operation.
- Wallet rejection returns safely to review.
- After Freighter signs, the transaction hash is computed and persisted before signed XDR is returned to `signAndSend()`.
- Failure to persist the signed hash prevents submission.
- Possible submission becomes Status unknown and blocks another Publish.
- A publication receipt is accepted only when the configured TicketContract emitted `ev_create` for the reserved event ID.
- Authoritative failure creates no public event.
- Chain success followed by public-sync failure remains successful.
- Sync repair never calls `create_event` again.
- The durable publication result contains event ID, transaction hash, and verified action proof.
- The published draft remains stored and undeletable as the human-ownership record.
- The public event has a durable URL.

### Published event management

- Each event has a durable `/organizer/events/:eventId` management route.
- Browser Back, Forward, refresh, and direct links work.
- Public metadata and contract terms are visibly distinguished.
- Locked fields do not appear editable.
- Metadata edits use user-account authorization and revision checks.
- Venue edits are rejected server-side after authoritative supply exceeds zero.
- The previous public revision remains visible until a new revision saves successfully.
- Active, On sale, Sold out, In progress, Awaiting completion, Completed, and Cancelled are not conflated.
- Cancelled events never display a generic Pending label.
- Activity shows only confirmed operations the slice actually records, or the section is omitted.
- No “coming soon” transaction-history placeholder remains.

### Financial truth

- Tickets sold comes from authoritative current supply.
- Actual escrow comes from the TicketContract.
- Gross primary sales and current escrow are separate metrics.
- No false refunded-total calculation is shown.
- Financial values identify when they were last confirmed.
- Supabase values never enable cancellation or completion.
- When Soroban is unavailable, financial actions remain disabled and mirrored values are not labelled confirmed.

### Cancellation

- Only the authoritative organizer wallet can cancel.
- Cancellation is allowed only from Active.
- Cancellation is unavailable whenever any unresolved cancellation or completion operation exists for the event.
- Allocation enforces one unresolved terminal operation per event across both action types.
- The review shows event, ticket, escrow, refund, resale, and irreversibility consequences.
- A public cancellation reason is saved privately before wallet approval and published only after chain success.
- Cancellation requires deliberate confirmation.
- The signed transaction hash is persisted before submission can begin.
- Success appears only after `ev_cancel` for the event and resulting Cancelled state are verified.
- A possible submission becomes Status unknown and blocks both cancellation and completion.
- Cancelled events cannot accept primary or resale purchases.
- `mark_used` cannot mutate tickets after cancellation.
- Active tickets retain refund eligibility after cancellation.
- Completion remains disabled after cancellation.
- Attendee refund eligibility becomes visible.
- Mirror delay does not turn confirmed cancellation into failure.
- A durable cancellation receipt remains accessible.

### Completion and settlement

- Funds cannot be released at event start.
- Completion is available only after authoritative end time.
- Completion is unavailable whenever any unresolved cancellation or completion operation exists for the event.
- The organizer sees the exact destination wallet and escrow amount.
- A zero-sale event can be completed.
- Positive escrow release and Completed status occur in one authoritative operation.
- No zero-value token transfer is attempted.
- Both positive and zero-value completion emit `ev_rel` with the exact released amount.
- The signed transaction hash is persisted before submission can begin.
- Success appears only after matching `ev_rel`, released amount, and resulting Completed state are verified.
- A possible submission becomes Status unknown and blocks both completion and cancellation.
- A completed event cannot be cancelled or completed again.
- Marketplace resale purchase and `mark_used` reject a Completed event.
- The released amount and transaction hash remain accessible.
- The event route refreshes from confirmed chain state.

### Contract and deployment integrity

- TicketContract tests cover schedule validation, sales cutoff, active-only cancellation, end-time completion, positive escrow release, zero-escrow completion, duplicate terminal actions, escrow reads, and `mark_used` rejection after cancellation and completion.
- MarketplaceContract tests cover resale purchase after cancellation and after completion.
- Refund remains available for eligible active tickets after cancellation.
- Zero-escrow completion emits `ev_rel` with amount `0`.
- Receipt verification binds network, configured contract ID, transaction success, event topic, event ID, operation type, organizer source where applicable, released amount, and resulting current state.
- MarketplaceContract remains compatible with the revised Event structure.
- Generated bindings are regenerated rather than hand-edited.
- `lib/soroban.ts`, application models, Supabase mappings, and UI guards use the revised ABI.
- TicketContract and MarketplaceContract are deployed as a coordinated pair.
- Both contracts store the correct counterpart address.
- Frontend environment values point to the same active deployment.
- Architecture and significant decision documentation are updated.

### Product integrity

- No dead organizer control remains.
- No fake progress step remains.
- No irreversible success appears before authoritative confirmation.
- No read-model failure causes repetition of a successful contract action.
- No unsupported feature appears as a selectable option.
- No new service duplicates the existing publication owner.
- No second published-event ownership lifecycle exists.
- No backend XDR builder, relayer, or competing submitter is introduced.
- No draft, operation, or receipt can be opened by another signed-in user.
- No cancellation and completion workflow can remain unresolved simultaneously for the same event.
- No receipt is accepted without proof of the specific emitted contract action.

---

## 12. What comes next

The next recommended slice is:

**Reliable Venue Check-in**

Slice 2 leaves the organizer with durable event ownership, authoritative schedules, event-specific routes, and trustworthy lifecycle operations. Those foundations allow scanner access, venue staff permissions, admission confirmation, duplicate-scan handling, and live check-in counts to be designed as a coherent next slice rather than remaining a global demo screen.
