# Phase 3 — Safe Purchase Operation and Durable Receipt

## Outcome

An authenticated attendee can review and pay for exactly one General Admission ticket, understand the real transaction state, recover an interrupted purchase without paying twice, and reopen a trustworthy receipt after refresh or on another device.

## Current implementation boundary

Phase 3 must build on the existing architecture rather than replacing it:

* React Router continues to own navigation.
* `PurchasePage` continues to orchestrate the purchase experience.
* `useEvent` and the Phase 2 authoritative event model continue to provide purchase eligibility.
* `lib/soroban.ts` remains the only handwritten frontend module that interacts with generated contract bindings.
* The generated `AssembledTransaction` flow, simulation and `signAndSend()` remain in use.
* `lib/dfns.ts` and the authenticated attendee-wallet Edge Function remain the delegated signing boundary.
* Public balance reads remain in `lib/stellar.ts`.
* Supabase stores the durable purchase operation and receipt state, but Soroban remains authoritative for payment and ticket creation.
* The global `TxOverlay` remains available for organizer and marketplace actions. Only the primary purchase journey stops using it.

The TicketContract already enforces active event status, remaining capacity, unique ticket IDs and the event-start sales cutoff. Phase 3 does not require another contract change.

---

## 1. Honest one-ticket checkout

Replace the current purchase presentation with one review screen for:

> 1 × General Admission ticket

The screen must show:

* event name, image, date, time, timezone and venue;
* ticket price in XLM;
* simulated network fee;
* total required balance;
* current attendee-wallet balance;
* exact shortfall, when underfunded;
* estimated remaining balance;
* refund and resale summaries from the normalized event model;
* the persistent Stellar Testnet disclosure.

There must be no quantity selector, fake progress steps, ticket tiers or final-looking button that performs an unexpected action.

The primary action should clearly state the real payment:

> Confirm and pay [total] XLM

The secondary action returns to the event page.

---

## 2. Reuse Phase 2 purchase eligibility

Phase 3 must not create another interpretation of event availability.

Use the existing Phase 2 authoritative event loader, sales-state derivation and reviewed-event fingerprint.

The sequence is:

1. Load the published metadata and current Soroban event snapshot.
2. Block checkout when the event is unavailable, cancelled, completed, sold out or at/after its start time.
3. Create or resume the purchase operation.
4. Prepare and simulate the transaction.
5. Immediately before final confirmation, reload the authoritative event snapshot.
6. Compare status, organizer, start time, price, capacity and supply with the reviewed snapshot.
7. If a material value changed, update the review and require a second explicit confirmation.
8. Never submit automatically after reconfirmation.

The Soroban contract remains the final race-condition guard even after frontend revalidation.

---

## 3. Durable purchase operation

Add one private `purchase_operations` record owned by `auth.uid()`.

Allocate it only after:

* the user is authenticated;
* the attendee wallet is restored and ready;
* the event is authoritatively eligible;
* the wallet account is activated or has a valid funding path.

The operation must be created before the first final transaction simulation so that the same operation and ticket ID are used throughout preparation.

Minimum durable fields:

* `operation_id`;
* `user_id`;
* stable idempotency key;
* reserved `ticket_id`;
* `event_id`;
* attendee wallet address;
* expected price in stroops;
* estimated fee in stroops;
* confirmed fee when available;
* network;
* TicketContract ID;
* transaction hash when known;
* operation state;
* failure category and safe user-facing detail;
* created, updated and confirmed timestamps.

Do not store:

* authentication tokens;
* Dfns credentials;
* recovery credentials;
* passkey data;
* raw secrets;
* signed transaction XDR.

The operation allocator must atomically create or return the existing operation for the same idempotency key. UI button disabling alone is not sufficient protection against multiple tabs, double clicks or request retries.

A new operation may be created only when the previous attempt is known to have failed before submission or failed authoritatively on-chain. An unresolved or confirmed operation must never produce a second payable attempt.

---

## 4. Purchase-operation states

Use one explicit state model:

| State               | Meaning                                                      | Allowed user action                                 |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| `review`            | Operation and ticket ID reserved; nothing submitted          | Review or leave checkout                            |
| `preparing`         | Transaction is being built and simulated                     | Wait or return after definitive preparation failure |
| `approval_required` | Dfns/passkey approval is required                            | Approve or reject                                   |
| `submitting`        | Signed transaction is being submitted                        | No second Pay action                                |
| `confirming`        | Transaction hash exists and confirmation is pending          | Recheck status                                      |
| `status_unknown`    | Submission may have occurred but final status is unavailable | Resume status check only                            |
| `chain_failed`      | Stellar/Soroban definitively rejected the transaction        | Safe retry using a new operation                    |
| `chain_confirmed`   | Payment and ticket creation are verified                     | Open receipt                                        |
| `mirror_syncing`    | Reserved for Phase 4 ticket/read-model reconciliation        | Purchase remains successful                         |
| `sync_warning`      | Reserved for delayed Phase 4 reconciliation                  | Retry synchronization, never payment                |
| `complete`          | Chain confirmation and later reconciliation agree            | View receipt and ticket                             |

Approval rejection and definitive pre-submission failure may return the same operation to a safe non-submitted failure state or allow a replacement attempt. They must not be labelled `chain_failed`.

A timeout, connection loss or browser close after possible submission must become `status_unknown`, not an ordinary failure.

---

## 5. Preserve the current Stellar transaction architecture

Do not create a backend XDR builder, backend signer, relayer or custom transaction submission service.

Continue using the current flow:

* `PurchasePage` calls the purchase adapter;
* the adapter lives in `lib/soroban.ts`;
* generated bindings assemble and simulate the transaction;
* Dfns provides the attendee signature through the current signer boundary;
* `signAndSend()` submits and confirms through the Stellar SDK.

Extend the current wrapper so it reports structured lifecycle information to the purchase operation:

* simulation prepared;
* approval requested;
* approval rejected;
* submission started;
* transaction hash received;
* confirmation pending;
* definitive success;
* definitive chain failure;
* timeout or unresolved result.

Use the existing SDK transaction progress/submission hooks where supported. Do not manually rebuild the transaction pipeline merely to obtain the hash.

Persist the transaction hash as soon as the current SDK flow exposes it. Once a hash or possible-submission state exists, the Pay action remains disabled.

`lib/soroban.ts` should return a structured result or purchase controller rather than a generic `void` success/error. Pages and components must not import generated bindings or Stellar RPC directly.

---

## 6. Dfns integration

Extend the existing transaction-signing request so the stable `operation_id` is passed as the Dfns `externalId` where supported.

This is used to prevent duplicate Dfns signature requests. It is not the complete payment-idempotency mechanism.

Actual duplicate-payment prevention comes from:

* the stable operation;
* the stable ticket ID;
* the atomic operation lock;
* the persisted transaction hash;
* prohibiting a new Pay action while the outcome is unresolved;
* authoritative recovery through transaction and ticket lookup.

Keep all provider identifiers, challenges, authentication material and audit data inside the existing attendee-wallet Edge Function and service-role tables.

Preserve distinct Dfns outcomes:

* user/passkey rejection;
* expired approval challenge;
* provider failure before signing;
* successful signature;
* uncertain client interruption.

Do not create another Dfns adapter or switch to a new custody/submission model during Phase 3.

---

## 7. Narrow trusted purchase service

Add a trusted purchase-operation Edge Function using the same narrow architectural style as the existing event-publication service.

It may:

* authenticate the Supabase user;
* derive the attendee address from the server-controlled wallet mapping;
* create or resume the user’s purchase operation;
* validate operation ownership and allowed state transitions;
* record the transaction hash and submission state;
* check transaction status through configured Stellar RPC;
* read the ticket through the configured TicketContract;
* verify ticket ID, owner, event ID and Active status;
* verify the successful transaction belongs to the expected network and contract;
* mark the operation `chain_confirmed`;
* expose the durable receipt.

The browser may submit an operation ID and candidate transaction hash, but these are untrusted inputs until verified.

The service must derive from server configuration:

* authenticated `user_id`;
* attendee wallet;
* network;
* RPC endpoint;
* TicketContract ID.

It must not accept client-controlled replacements for those values.

It must not:

* build the transaction;
* sign for the attendee;
* submit the transaction;
* write the ticket mirror;
* increment or overwrite mirrored event supply;
* perform full ticket reconciliation.

Ticket and event mirror repair remain Phase 4.

---

## 8. Recovery and duplicate-payment prevention

The application must recover the existing operation by:

1. transaction hash when present;
2. reserved ticket ID when the hash is missing or confirmation lookup is inconclusive;
3. operation state and trusted service verification.

A missing ticket during an early lookup is not proof that submission never occurred. The operation remains unresolved until the transaction is authoritatively failed or the bounded confirmation/recovery process determines the outcome.

On checkout load:

* find the current user’s unresolved operation for that event;
* restore the same operation and ticket ID;
* show its current state;
* resume confirmation rather than showing a new Pay button.

On `/purchases/:operationId`:

* authenticate the user;
* confirm that the operation belongs to `auth.uid()`;
* resume trusted status resolution when unresolved;
* display the durable receipt when confirmed.

A minimal local crash bridge may contain:

* operation ID;
* event ID;
* ticket ID;
* transaction hash, when known.

It must not contain credentials, tokens, secrets or signed XDR. The server operation remains the durable record.

---

## 9. Testnet funding

Add one authenticated, rate-limited test-funding Edge Function.

It must:

* derive the wallet from the authenticated user’s server-side attendee-wallet record;
* confirm the application is configured for Stellar Testnet;
* check whether the Stellar account exists;
* call Friendbot only when the account is unactivated;
* verify the resulting account and balance before reporting success;
* return structured activation, rate-limit and provider errors.

Do not:

* silently fund during wallet provisioning or checkout;
* automatically invoke Friendbot;
* accept an arbitrary wallet address from the browser;
* treat every HTTP 400 response as success;
* replace the attendee wallet when it is activated but underfunded.

For an unactivated wallet, show:

> Get test XLM

For an activated wallet with insufficient balance, show the exact shortfall and a support/demo recovery state. “Reset” must never imply creating another wallet or migrating existing ticket ownership.

After successful activation, refresh the balance through the existing Horizon balance adapter.

---

## 10. Inline checkout and receipt experience

The primary purchase journey must stop using the global `TxOverlay`.

Render operation progress directly inside the checkout or receipt page:

* Preparing purchase
* Waiting for approval
* Submitting to Stellar
* Confirming on-chain
* Purchase status temporarily unavailable
* Purchase rejected
* Ticket confirmed

Do not remove `TxOverlay` globally because organizer, refund, marketplace and check-in actions still use the existing global transaction state.

After chain confirmation, navigate explicitly to:

`/purchases/:operationId`

Do not use a timer or automatic redirect to My Tickets.

The receipt must display:

* confirmed heading;
* event name, date and venue;
* `1 × General Admission`;
* ticket ID;
* owner address;
* amount paid;
* estimated or confirmed network fee, labelled accurately;
* transaction hash;
* Stellar Testnet;
* confirmation time;
* synchronization state.

Receipt actions:

* **Add to calendar** — reuse the existing `EventActions` utilities;
* **View transaction** — open the configured Stellar explorer;
* **Back to events** — return to `/events`;
* **View ticket** — show only when it leads to a working, authoritative ticket route.

The current ticket-detail path depends on the Supabase ticket mirror. Until Phase 4 makes that mirror recoverable and trusted, the receipt must not claim that `View Ticket` is available merely because the route exists.

The receipt should be derived from the confirmed purchase operation plus the normalized published event model. Do not add a second independent receipt table unless a concrete access or immutability requirement cannot be met by the operation record.

---

## 11. Routing and frontend boundaries

Add the protected route:

`/purchases/:operationId`

Update the current auth-intent route validation so an authenticated user can return to the exact receipt.

Keep implementation responsibilities aligned with the current code:

* `PurchasePage`: checkout orchestration and inline operation UI;
* new receipt page: durable receipt rendering and status recovery;
* `lib/soroban.ts`: contract preparation, transaction execution and structured transaction results;
* `lib/dfns.ts`: attendee signing adapter;
* `lib/stellar.ts`: public balance reads;
* `lib/supabase.ts`: typed purchase-operation calls and queries;
* purchase Edge Function: authentication, operation transitions and authoritative chain verification;
* Zustand: do not persist the purchase operation as a second durable source.

Do not introduce another router, global transaction library, generic workflow framework or SDK import inside pages/components.

---

## 12. Phase boundary

Phase 3 includes:

* safe one-ticket checkout;
* fee and balance review;
* explicit account activation;
* one durable operation;
* duplicate-payment prevention;
* transaction outcome recovery;
* authoritative chain confirmation;
* durable protected receipt;
* purchase-specific inline states.

Phase 3 does not include:

* trusted ticket mirror creation or repair;
* authoritative event-supply mirror reconciliation;
* My Tickets cross-device restoration;
* global replacement of permissive ticket/listing RLS;
* QR ownership hardening;
* scanner redesign;
* marketplace transaction migration;
* refunds or organizer settlement redesign;
* a generic transaction framework for every application action.

Those remain Phase 4 or later work.

---

## Definition of done

Phase 3 is complete when:

* checkout truthfully represents one General Admission ticket;
* all prices and fees are stored in stroops and displayed accurately;
* the simulated fee, total, current balance, shortfall and estimated remaining balance are visible;
* the final event state is revalidated and changed values require explicit reconfirmation;
* one operation and ticket ID are reused through preparation, approval and submission;
* double click, multiple tabs and request replay cannot allocate two payable attempts;
* Dfns rejection is visibly different from chain rejection;
* a possible submission disables further payment;
* the transaction hash is persisted as soon as the existing SDK lifecycle exposes it;
* refresh and browser closure restore the same operation;
* another signed-in device can open the same protected operation;
* unresolved submission is recovered by hash or reserved ticket ID;
* only authoritative Stellar/Soroban verification marks the purchase confirmed;
* a mirror failure cannot turn a confirmed purchase into a failed purchase;
* no browser path writes ticket ownership or event supply during Phase 3;
* the receipt survives refresh and exposes its hash, ticket ID, network and confirmation state;
* the purchase journey no longer depends on the auto-dismiss transaction overlay;
* no new transaction, wallet, routing or reconciliation framework has been introduced unnecessarily.
