# Product Slice 1: Confident First Purchase

The outcome is simple:

> A new user can open StellarTickets, find an event, understand it, buy one ticket, receive an indisputable confirmation, and find that ticket again after refreshing or changing devices.

This slice establishes the identity, event-data, navigation, payment, transaction, and synchronization foundations that calendar, notifications, resale, and AI will later depend on.

---

# 1. Decisions to lock before writing code

These are product-level decisions. Changing them halfway through implementation would create rework across most of the application.

## Decision 1: One user account, not separate attendee and organizer identities

The current landing page asks users to choose “Attendee” or “Organizer,” and the application routes them into different experiences. Freighter users are also automatically routed to the organizer dashboard after refresh.  

That should not be the final model.

### Final model

A person has **one StellarTickets account**.

That account may have several capabilities:

* attend events;
* own tickets;
* organize events;
* operate check-in for an event;
* receive organizer settlements.

A person does not become a permanently different kind of user because they created an event.

### Final behavior

* Anyone can browse without signing in.
* Signing in creates or restores the attendee account and embedded wallet.
* “Organize an event” asks the user to connect an organizer wallet when organizer authority is needed.
* Connecting Freighter does not replace the attendee account.
* The organizer dashboard appears as an additional capability, not a separate product.
* Signing out of the human account does not destroy the wallet or make tickets unrecoverable.
* Disconnecting Freighter only disconnects the organizer wallet.

### Future-safe identity structure

The human identity must be separate from the wallet address:

* `user_id` identifies the person;
* `wallet_address` identifies an account that can own tickets or authorize actions;
* a user can have linked wallets;
* tickets remain owned by their on-chain wallet;
* profile, notification, calendar, support, and AI context belong to `user_id`.

Your present profile model is keyed directly by wallet address, and attendee login currently creates a local burner wallet plus a mock profile. Disconnecting deletes the burner secret. That is explicitly documented as a testnet-only compromise and cannot provide cross-device recovery.  

---

## Decision 2: Browsing is public; authentication happens only when required

The application should not ask a visitor to select a role or connect a wallet before they understand the product.

### Final entry experience

Opening the application takes the visitor directly to event discovery.

The primary navigation is:

* **Discover**
* **Marketplace**
* **My Tickets**
* **Account**

“Manage Events” appears only when the user enters the organizer area or has connected an organizer wallet.

The scanner must not appear in public attendee navigation. It belongs inside a particular organizer event:

> Manage Event → Check-in → Open Scanner

The current mobile navigation shows Scanner and Manage to everyone. That exposes operational tools as if they were ordinary attendee destinations. 

### Authentication trigger points

A visitor is asked to sign in only when attempting to:

* purchase a ticket;
* view My Tickets;
* list or buy a resale ticket;
* follow an organizer;
* configure reminders;
* create or manage an event.

After successful authentication, the user returns to the exact event or action they were attempting. They must never be sent back to a generic home page.

---

## Decision 3: Replace view-only navigation with URL-based navigation

Your current application uses an internal `AppView` state machine rather than URL routes. That means selected events and tickets are held in transient component state. 

A finished product needs durable, shareable routes.

### Final route behavior

Examples:

* `/events`
* `/events/:eventId`
* `/events/:eventId/checkout`
* `/tickets`
* `/tickets/:ticketId`
* `/marketplace`
* `/account`
* `/organizer/events`
* `/organizer/events/:eventId`
* `/organizer/events/:eventId/check-in`

This gives the product several important guarantees:

* browser Back and Forward work naturally;
* refreshing an event page keeps the user on that event;
* an event can be shared;
* a calendar entry can link back to the event;
* a notification can open the relevant ticket;
* authentication can return the user to the original destination;
* a transaction receipt can be reopened;
* future AI actions can navigate to real destinations.

This routing decision should happen before notifications, calendar integration, organizer announcements, or AI because all of them require durable links.

---

## Decision 4: Slice 1 supports one real ticket, not a fake quantity flow

The current checkout displays a two-step quantity-and-confirmation flow, but quantity is hardcoded to one, there is no quantity control, and “Continue to Payment” performs the transaction immediately. 

For this product slice, the honest behavior should be:

> **Buy one General Admission ticket per checkout.**

The interface should say exactly that.

Remove:

* “Select Quantity”;
* the fake `01` selector;
* the inactive second step;
* “Tier 1” unless tiers genuinely exist;
* quantity totals that always equal one.

Multiple quantities and ticket tiers should be designed as their own later contract change. We should not simulate them in the interface before the underlying model exists.

---

## Decision 5: Be explicitly testnet, not pretend-production payments

The Level 5 application is required to demonstrate real testnet activity. It does not need to pretend that test XLM is fiat.

### Final testnet behavior

A persistent but unobtrusive label states:

> **Stellar Testnet — balances and payments have no monetary value.**

The attendee experience should still feel complete:

* show the ticket price in XLM;
* optionally show an approximate local-currency reference;
* label the conversion as an estimate;
* show available test XLM;
* provide a clear “Get test funds” action when necessary;
* explain once that funds are for the demo;
* never silently create 10,000 XLM and announce it through an auto-disappearing transaction overlay.

Later, stablecoin or fiat support can replace the payment rail without changing the booking experience.

---

# 2. Final happy-path experience

This is the exact first-purchase journey we should design toward.

## Step 1: Visitor opens StellarTickets

The visitor lands on Discover, not on a role-selection page.

They can immediately:

* browse upcoming events;
* search by name, venue, or city;
* filter by date, location, and category;
* open an event without signing in.

The interface uses ordinary ticketing language. Blockchain is visible as a trust and verification benefit, not the main task.

Prefer:

> Secure digital tickets with protected resale and verified entry.

Avoid leading with:

> NFT passes on the blockchain.

---

## Step 2: Visitor opens an event

The event page answers the questions a real buyer needs before purchasing:

* What is the event?
* Who is organizing it?
* When does it begin?
* What timezone is shown?
* Where is it?
* How much is one ticket?
* How many tickets remain?
* Is the event active, sold out, cancelled, started, or completed?
* What is the refund policy?
* Is resale allowed?
* How will entry work?
* Who can I contact?

The page contains only actions that currently work.

For Slice 1:

* **Buy 1 ticket**
* **Share event**
* **Add to calendar**

Remove the Follow button until organizer following and notifications actually exist. The current event page also hardcodes “Time TBA,” a generic organizer avatar, “Floor Price,” “General Admission Available,” and a fixed blockchain fee. Those should all be replaced by real data or removed.  

---

## Step 3: User clicks “Buy 1 ticket”

Before checkout opens, the application verifies current authoritative sale conditions.

The read model can supply the event description, image, venue, and searchable information. Soroban must supply or confirm:

* event status;
* event start time;
* capacity;
* current supply;
* current price;
* organizer;
* whether purchase is still allowed.

This respects the existing project boundary:

> Soroban owns truth; Supabase makes truth discoverable. 

If the critical values have changed since the page loaded, checkout shows the updated state before the user confirms.

---

## Step 4: Authentication occurs without losing context

When an unauthenticated visitor clicks Buy:

1. An authentication sheet or page opens.
2. The user chooses Google or email sign-in.
3. The same event remains the pending destination.
4. A stable user profile is created or restored.
5. The attendee wallet is provisioned or restored.
6. The user returns to that event’s checkout.

### Final attendee wallet requirement

The implementation is not acceptable until it proves:

* the same user receives the same wallet after signing in on another browser or device;
* the user can recover access without a locally stored burner secret;
* signing out does not destroy access;
* the application does not store a recoverable raw secret in the profile database;
* the wallet can sign the existing Soroban transaction flow.

Selecting the provider is a technical decision. The product behavior above is non-negotiable.

---

## Step 5: Checkout presents one truthful review

The checkout has one review screen.

It shows:

* event name and image;
* exact date, time, and timezone;
* venue;
* **1 × General Admission ticket**;
* ticket price;
* estimated network fee from transaction preparation or simulation;
* total;
* available test balance;
* estimated balance after purchase;
* refund and resale summary;
* testnet disclosure.

Primary action:

> **Confirm and pay 25 XLM**

Secondary action:

> Return to event

There is no fake progress indicator and no “Continue to Payment” button that secretly performs the final purchase.

---

## Step 6: The transaction communicates its real state

After confirmation, the interface moves through observable states:

1. Preparing purchase
2. Waiting for approval, where relevant
3. Submitting to Stellar
4. Confirming on-chain
5. Ticket created
6. Syncing ticket details
7. Complete

The user should not be trapped behind an overlay that automatically disappears. They should see a durable result with an explicit action.

---

## Step 7: The user receives a persistent receipt

The success destination is a receipt page, not a 1.5-second success animation followed by an automatic redirect.

It shows:

* “Your ticket is confirmed”;
* event name;
* date and venue;
* ticket ID;
* owner account;
* amount paid;
* transaction hash;
* network;
* confirmation time;
* sync status.

Actions:

* **View ticket**
* **Add to calendar**
* **View transaction**
* **Back to events**

The transaction hash and ticket ID must remain accessible after refresh.

---

## Step 8: The ticket appears in My Tickets

The ticket appears under **Upcoming**, not merely under a generic Active tab.

The card shows:

* event name;
* event date and countdown;
* venue;
* ticket status;
* ticket type;
* calendar status;
* “View ticket.”

It must not label every ticket “VIP ACCESS,” because the current contract has no VIP ticket type. It should not describe the ticket as a “digital asset” when the user is simply trying to attend an event. 

---

# 3. Required event states

The purchase action must be derived from both on-chain status and time.

| Authoritative condition                     | Display state                | Primary action                     |
| ------------------------------------------- | ---------------------------- | ---------------------------------- |
| Active, before start, supply below capacity | On sale                      | Buy 1 ticket                       |
| Active, before start, capacity reached      | Sold out                     | Browse resale, when listings exist |
| Active, at or after event start             | Sales closed / Event started | No primary purchase                |
| Cancelled                                   | Event cancelled              | No purchase                        |
| Completed                                   | Event ended                  | No purchase                        |
| Critical state unavailable                  | Temporarily unavailable      | Retry                              |

## Important contract correction

The current `purchase` contract function checks whether the event is Active and whether capacity remains, but it does not reject a purchase after the event start time. 

That means a stale or malicious client could potentially purchase after the scheduled event time while the event remains Active.

The final product rule must be:

> **Primary ticket sales close at event start, and the contract—not only the UI—enforces this.**

For this slice, use the existing event timestamp as the authoritative sales cutoff. A separate configurable sale-closing time can be designed later.

This is one of the few contract changes that belongs in the first product slice because it affects the basic validity of a purchase.

---

# 4. Required purchase-state model

The current purchase flow treats the contract call, Supabase insert, supply mirror update, and local refresh as one `try/catch`. If Soroban succeeds but Supabase fails, the interface can report “Purchase failed” even though the user has already paid and owns a ticket. 

The finished product must distinguish these states.

| State                     | What it means                                         | What the user sees                       |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------- |
| `review`                  | No transaction submitted                              | Editable checkout                        |
| `authentication_required` | User identity unavailable                             | Sign-in action                           |
| `wallet_preparing`        | Wallet is being created/restored                      | Progress with recovery guidance          |
| `funding_required`        | Balance is too low                                    | Exact shortfall and test-funding action  |
| `preparing`               | Transaction is being built and simulated              | Preparing purchase                       |
| `approval_required`       | User approval/signature needed                        | Clear approval instruction               |
| `submitting`              | Transaction sent                                      | Do not close message                     |
| `confirming`              | Submitted but final result pending                    | Checking Stellar confirmation            |
| `status_unknown`          | Submission occurred but confirmation lookup timed out | Checking status; retry purchase disabled |
| `chain_failed`            | Soroban definitively rejected transaction             | No charge/ticket; clear cause and retry  |
| `chain_confirmed`         | Payment and ticket creation succeeded                 | Purchase confirmed                       |
| `mirror_syncing`          | Supabase/read model is being updated                  | Ticket confirmed; syncing details        |
| `sync_warning`            | Chain succeeded but read model is delayed             | Ticket is safe; retry sync               |
| `complete`                | Chain and read model agree                            | Receipt and ticket actions               |

## Non-negotiable rules

* Never show success before Soroban confirms success.
* Never label a chain-confirmed purchase as failed because Supabase synchronization failed.
* Never offer another Pay button while transaction status is unknown.
* Never rely on a three-second timeout as the final transaction state.
* Never hide the transaction hash after success.
* Never require the user to repeat a financial transaction to repair a display-layer problem.

A small local reconciliation record should survive refresh until the ticket mirror is synchronized. It should contain at least:

* operation ID;
* event ID;
* ticket ID;
* wallet address;
* transaction hash;
* chain status;
* mirror status.

This is not a second source of authority. It is recovery information.

---

# 5. Authentication states

Authentication must also have explicit product states.

| State                         | Expected experience                                                  |
| ----------------------------- | -------------------------------------------------------------------- |
| Visitor                       | Can browse and view events                                           |
| Signing in                    | Auth screen remains tied to the pending destination                  |
| Profile required              | Ask only for missing essentials such as display name                 |
| Wallet provisioning           | Explain that a secure ticket wallet is being prepared                |
| Wallet ready                  | User can continue checkout                                           |
| Wallet recovery required      | Give a clear recovery path; do not create a second identity silently |
| Organizer wallet disconnected | Attendee functions continue; organizer actions ask to reconnect      |
| Signed out                    | Tickets remain recoverable after signing back in                     |

The attendee-facing header should say **Sign in**, not **Connect Wallet**.

Wallet information belongs under:

> Account → Wallet and transactions

It can show the public address, network, balance, and transaction history for transparency. It should not be the user’s primary identity.

---

# 6. Minimum event-data contract

Calendar reminders, notifications, meaningful search, and AI support will all depend on consistent event data. Therefore, Slice 1 must establish this data contract even though those later features are not being built yet.

A public event needs:

* name;
* summary and full description;
* image;
* category;
* start date and time;
* end date and time;
* display timezone;
* venue name;
* address;
* city;
* organizer display name;
* organizer wallet;
* contact or support method;
* ticket price;
* capacity;
* refund summary;
* resale summary;
* entry instructions;
* publish state.

The on-chain timestamp remains authoritative for the event start. Timezone, end time, address, images, descriptions, and policies can remain in the read model.

## Publishing rule

An event with incomplete required metadata must not appear publicly as a finished listing.

Do not compensate with fabricated values such as:

* Time TBA;
* Anywhere;
* VIP Access;
* Tier 1;
* anonymous stock organizer portrait;
* fixed network fee;
* generic NFT pass text.

Either the information is known, or the interface honestly states that the organizer has not supplied it. For required publishing fields, the event should remain unpublished until they are complete.

---

# 7. Calendar behavior included in this slice

We should not build a full internal calendar product yet.

For this slice, calendar integration means:

* Add to Google Calendar;
* Add to Outlook;
* download an `.ics` file;
* open the venue in maps.

These actions appear:

* on the event page;
* on the purchase receipt;
* on the owned-ticket page.

The calendar record contains:

* event title;
* start and end time;
* timezone-correct date;
* venue and address;
* link back to the event;
* basic entry instructions.

This small integration is valuable immediately and forces us to correct the event time model. A richer in-app schedule can be considered later.

---

# 8. The four work packages for this slice

This is the complete scope to plan and execute before moving to organizer tools, notifications, or AI.

## Package A — Product shell and durable navigation

Final state:

* public Discover entry;
* no role-selection gate;
* URL routes for events, checkout, tickets, marketplace, account, and organizer areas;
* browser navigation and refresh work;
* protected routes preserve their intended destination;
* scanner is removed from public attendee navigation;
* testnet is visibly disclosed.

No smart-contract changes are needed for this package.

---

## Package B — Identity and wallet foundation

Final state:

* one human account;
* Google and email authentication;
* stable `user_id`;
* linked attendee wallet;
* same wallet recoverable on another device;
* attendee sign-out does not destroy the wallet;
* organizer Freighter connection is separate;
* authentication errors appear in the interface, not only in the console;
* balance and wallet readiness are available to checkout.

Before implementation, run one focused technical proof:

> Sign in on Browser A, create or restore the attendee wallet, sign a Soroban test transaction, then sign in on Browser B and confirm that the same address and signing capability are restored.

Do not build the full auth UI until that proof succeeds.

---

## Package C — Truthful event details and purchase eligibility

Final state:

* required event metadata is complete;
* exact date, time, timezone, and venue are shown;
* no dead Follow button;
* no fabricated ticket type or organizer identity;
* on-chain price, supply, status, and start time are revalidated;
* sold-out, cancelled, started, completed, unavailable, and on-sale states are distinct;
* purchase after event start is rejected by the contract;
* event page has a shareable URL;
* calendar export works.

---

## Package D — Checkout, confirmation, reconciliation, and owned ticket

Final state:

* honest one-ticket checkout;
* available balance and estimated fee;
* explicit test-funding recovery;
* real transaction state machine;
* durable status if the network result is temporarily unknown;
* chain success separated from mirror synchronization;
* persistent receipt;
* transaction hash;
* purchased ticket immediately discoverable;
* refresh does not erase the result;
* no automatic redirect that hides confirmation;
* no success shown before authority confirms it.

Once these four packages meet their completion criteria, the first slice is finished.

---

# 9. Explicitly out of scope for this slice

To prevent feature slop, do not add these yet:

* multiple ticket quantities;
* VIP, student, early-bird, or seat tiers;
* stablecoin or fiat payments;
* in-app notification center;
* organizer announcements;
* Follow organizer;
* waitlists;
* AI chat;
* detailed organizer analytics;
* marketplace policy redesign;
* scanner redesign;
* venue staff delegation;
* full in-app calendar.

Some of these are important, but none should be built on top of unstable identity, routing, event-time, or transaction-state foundations.

---

# 10. Definition of done

Product Slice 1 is complete only when all of the following are true:

### Visitor experience

* A new visitor can browse without authentication.
* A shared event URL opens the correct event.
* Refreshing the page preserves the destination.
* No public navigation exposes organizer-only scanner functions.
* No dead buttons or “coming soon” placeholders are visible.

### Event experience

* All displayed values come from real event data.
* Date, time, and timezone agree.
* Sold-out, cancelled, started, completed, and unavailable events cannot be purchased.
* The contract rejects purchases at or after event start.
* Every disabled action explains why it is disabled.

### Account experience

* A user can sign in with email or Google.
* Authentication returns the user to the pending checkout.
* The same attendee wallet can be restored on a second device.
* Sign-out does not destroy ticket access.
* Organizer wallet connection is separate from attendee identity.
* No user-facing auth failure exists only in the console.

### Checkout experience

* The screen truthfully represents one ticket.
* The user sees price, estimated fee, total, balance, and testnet disclosure.
* Insufficient balance has a recovery action.
* Changed price or availability requires reconfirmation.
* Cancelling authentication or approval does not create a ticket or charge.

### Transaction experience

* Success appears only after Soroban confirmation.
* A submitted-but-unresolved transaction blocks duplicate payment attempts.
* Chain failure and mirror failure are visibly different.
* Chain-confirmed purchases remain successful even when synchronization is delayed.
* The receipt contains the transaction hash and ticket ID.
* The receipt survives refresh.

### Ticket experience

* The ticket appears under Upcoming.
* The ticket uses real labels rather than VIP/Tier placeholders.
* The event can be added to a calendar.
* The user can reopen the ticket and receipt.
* The ticket remains recoverable after signing out and signing back in.

---

# What should come after this slice

Only after **Confident First Purchase** is complete should the next detailed specification begin.

The next product slice should be:

> **Professional Event Publishing and Organizer Operations**

That slice will define event drafts, publishing readiness, editing, organizer identity, sales overview, attendee records, cancellations, settlements, and announcements. Notifications should follow that because they need real organizer announcements and durable user accounts. AI should come after the underlying information and actions are reliable.
