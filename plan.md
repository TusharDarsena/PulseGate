# Engineering Plan: Stellar Tickets — Full Remediation

> Historical plan. Its identity and navigation sections are superseded by the
> Slice 1 product specification and decision register. The current attendee model
> is Supabase Auth plus a Dfns delegated wallet, and React Router owns navigation.

## Architectural Principles

**Supabase is the read index. The contract is the financial authority.** No display string lives on-chain. No financial amount is trusted from Supabase. These two systems never overlap responsibilities.

**Supabase schema is the backbone of all discovery.** `useEvents` and `useTickets` both start with a Supabase query, then hydrate on-chain state in parallel. RPC event scanning is eliminated as a primary discovery mechanism.
*Error Handling:* No fallback RPC for list discovery. If Supabase is down or unreachable, the app explicitly shows a "Service Unavailable / Database unreachable" state rather than failing silently or falling back to slow RPC scans.

---

## Phase 0: Supabase Schema — Build the Foundation First

Everything else depends on this. Define these before touching frontend code. We already have the `events` table partially defined; we need to alter it to include mirror columns.

### Table: `events`
*Current state: Exists but needs mirror columns.*
| Column | Type | Source of truth |
|---|---|---|
| `event_id` | text PK | Written at `createEvent` |
| `organizer_address` | text | Written at `createEvent` |
| `name` | text | Written at `createEvent` |
| `description` | text | Written at `createEvent` |
| `image_url` | text | Written at `createEvent` |
| `venue` | text | Written at `createEvent` |
| `city` | text | Written at `createEvent` |
| `category` | text | Written at `createEvent` |
| `status` | text | **Mirrored** — written on cancel/complete |
| `current_supply` | int | **Mirrored** — incremented on each purchase |
| `created_at` | timestamptz | Auto |

### Table: `tickets` (New)
| Column | Type | Source of truth |
|---|---|---|
| `ticket_id` | text PK | Written at `purchaseTicket` |
| `event_id` | text FK → events | Written at `purchaseTicket` |
| `owner_address` | text | Written at `purchaseTicket`, updated on resale `buy_listing` |
| `status` | text | Mirrored — updated on `markUsed` and `refundTicket` |
| `purchased_at` | timestamptz | Auto |

### Table: `listings` (New)
| Column | Type | Source of truth |
|---|---|---|
| `listing_id` | text PK | Written at `listTicket` |
| `seller_address` | text | Written at `listTicket` |
| `ticket_id` | text FK → tickets | Written at `listTicket` |
| `event_id` | text FK → events | Written at `listTicket` |
| `ask_price_stroops` | bigint | Written at `listTicket` |
| `status` | text | `Open` → `Sold` or `Cancelled` |
| `listed_at` | timestamptz | Auto |

### Table: `user_profiles` (New)
| Column | Type | Notes |
|---|---|---|
| `wallet_address` | text PK | Stellar G... address |
| `display_name` | text | From Google login or user-set |
| `email` | text | Optional |
| `avatar_url` | text | Optional |
| `created_at` | timestamptz | Auto |

### Table: `app_cache` (New - For XLM Price)
| Column | Type | Notes |
|---|---|---|
| `key` | text PK | e.g. "xlm_usd_price" |
| `value` | jsonb | e.g. `{"price": 0.15, "updated_at": "..."}` |
| `updated_at` | timestamptz | Auto |

*Writer constraints:* A Supabase Edge Function running on a `pg_cron` schedule (every 5 mins) acts as the exclusive writer to `app_cache`. The frontend acts strictly as a reader to avoid race conditions and to keep CoinGecko API integration out of the client.

---

## Phase 1: Reliable Discovery — `useEvents` and `useTickets`

### 1.1 Refactor `supabase.ts`
- Read existing `.env.local` for credentials.
- Add queries: `fetchAllEvents()`, `fetchTicketsByOwner(walletAddress)`.
- Add targeted query: `fetchOpenListingByTicket(ticketId)` (for `MyTicketsPage` "Cancel Listing" UI).
- Add explicit error checks: If Supabase returns an error, throw it so the UI can catch it and display "Supabase not working".

### 1.2 Rewrite `useEvents.ts`
- Replace RPC `ev_create` scan with `fetchAllEvents()` from Supabase.
- Add error state to hook (`isError`, `errorMessage`) to handle DB downtime.
- Expose `invalidate()` function.

### 1.3 Rewrite `useTickets.ts`
- Replace RPC `tk_buy` event scan with `fetchTicketsByOwner(wallet)`.
- Handle Supabase errors similarly to `useEvents`.

### 1.4 Wire Supabase writes to state-changing calls
*Location:* Write-backs belong in the UI call sites (Pages/Components), not within `soroban.ts` (which remains exclusively for contract binding).
- `PurchasePage`: `purchaseTicket` success → `INSERT INTO tickets` & `UPDATE events`
- `OrganizerEventRow`: `cancelEvent` success → `UPDATE events SET status = 'Cancelled'`
- `OrganizerEventRow`: `releaseFunds` success → `UPDATE events SET status = 'Completed'`
- `ScannerPage`: `markUsed` success → `UPDATE tickets SET status = 'Used'`
- `MyTicketsPage/TicketCard`: `refundTicket` success → `UPDATE tickets SET status = 'Refunded'`
- Marketplace pages: `listTicket`, `buyListing`, `cancelListing` marketplace updates.

### 1.5 Hook Invalidation Architecture
- Lift `invalidate()` calls from `useEvents`, `useTickets`, and (later) `useListings` into a global context or root component (`App.tsx`).
- Pass the invalidation callbacks down to pages that perform write operations so that all relevant lists refresh synchronously upon state changes.

---

## Phase 2: Identity — User Profiles

### 2a: Scanner & Profiles (Immediate)
- Superseded: do not restore the browser-local attendee wallet.
- Implement `upsertUserProfile` and `fetchUserProfile` in Supabase.
- Fix `ScannerPage`: Remove hardcoded identity UI (`"Marcus Sterling"`). Fetch and display real attendee data from `user_profiles` upon successful scan verification. Show truncated wallet address if profile is missing.

### 2b: Web3Auth (Deferred)
- Superseded: Slice 1 selected Supabase Auth and Dfns delegated attendee signing.

---

## Phase 3: Dynamic UI & Global Cache

### 3.1 Fix `PurchasePage`
- Remove hardcoded `"Oct 24, 2024"` and `"Crypto Arena"`.
- Replace with `formatEventDate(event.dateUnix)` and dynamic venue data from the `event` object.

### 3.2 Fix `DashboardPage`
- Correct the total escrow calculation by filtering to only `status === 'Active'` events.

### 3.3 Dynamic XLM Pricing
- Build `useXlmPrice` hook targeting the `app_cache` table.
- **Scope constraint:** Use this hook exclusively in `PurchasePage` to replace the hardcoded `$15.20`. Do not inject speculatively into other pages.

---

## Phase 4: Missing Contract UI Features

### 4.1 Cancel Event
- Add "Cancel Event" button to `OrganizerEventRow`.
- Implement confirmation modal and wire to `cancelEvent` binding.

### 4.2 Claim Refund
- Add "Claim Refund" to `TicketCard` on `MyTicketsPage` if the parent event is cancelled. Wire to `refundTicket` binding.

### 4.3 Resale Marketplace
- **Sell:** Add "List for Sale" to active tickets.
- **Browse:** Create `MarketplacePage.tsx` and `useListings` hook.
- **Buy:** Implement purchase logic using `getTicket` verification -> `buyListing`.
- **Cancel:** Allow sellers to cancel their open listings using `fetchOpenListingByTicket` in `MyTicketsPage`.
