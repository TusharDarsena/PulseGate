# PulseGate claim-to-evidence matrix

This matrix controls judge-facing and in-product wording. A claim may be
promoted from **code-complete** to **live** only after every required deployed
boundary and proof in its row has been verified together.

## Wording rules

- **Current/confirmed:** backed by a fresh authoritative contract read or
  successful transaction simulation on the screen where it appears.
- **Historical:** backed by a recorded exact contract event, confirmed
  transaction receipt, or durable operation whose chain identity was verified.
- **Unavailable:** the authoritative read or resolution failed; the affected
  action is disabled.
- **Preview/discoverable:** backed only by the Supabase read model. Never style
  this as contract confirmation.
- **Code-complete:** implementation exists in the repository. This does not mean deployed.
- **Demonstrated:** a reproducible public proof exists for the exact deployed flow.

## Product claims

| User-facing claim | Authority source | Required deployment | Screen/test proof | Explorer/public proof | Wording if unverified |
|---|---|---|---|---|---|
| Current tickets are available | TicketContract `get_event` supply, capacity, lifecycle, price | Current TicketContract; matching frontend ID | Event detail and checkout; event-model tests | Current contract explorer | “Preview availability—confirm on event page” or “Live sale status could not be verified” |
| Purchase confirmed on Stellar | Exact `tk_buy` event plus transaction result | Current TicketContract; `purchase-operation`; purchase migrations | Durable purchase receipt tests | Transaction link on receipt | “Purchase confirmation pending” or “Purchase status unavailable”; second payment disabled |
| Payments are recoverable | Persisted signed hash and deterministic operation resolution | `purchase-operation`, `ticket-operation`, required migrations and secrets | Pending/unknown/sync-warning tests | Durable operation transaction link | “Signed status is unresolved—do not repeat” |
| Protected resale | MarketplaceContract listing plus TicketContract owner/status/event checks | Both synchronized contracts; `ticket-operation`; listing migration | Marketplace review after simulation; operation recovery tests | Listing/buy/cancel transaction links | “Eligibility rechecked before signing”; never call a mirror row confirmed |
| Refund is confirmed | Exact `tk_refund` event and current ticket status | Current TicketContract; `ticket-operation`; migration | Refund result/recovery states | Refund transaction link | “Refund status unresolved” or “Mirror synchronization delayed” |
| QR is currently valid | Fresh TicketContract owner and `Active` status read, then local signature | Current TicketContract; attendee-wallet service | `QRDisplayPage.test.tsx` and active/unavailable captures | Contract explorer plus eventual check-in receipt | “Current owner and Active status could not be verified. No entry QR is available.” |
| Venue entry is verified | Local QR signature/age, current event/ticket reads, organizer signer, door window, confirmed `mark_used` | Current four-argument ABI; `check-in-operation`; check-in migration/secrets | Scanner ready/result/unavailable states and tests | `tk_used` transaction link | “Check-in unavailable—do not admit” or “Signed check-in status unknown—resolve before rescanning” |
| Organizer funds were released | TicketContract lifecycle, escrow, exact `ev_rel` event | Current TicketContract; organizer-operation service/migration | Organizer operation receipt | Release transaction link | “Release confirmation pending”; never infer from mirrored revenue |
| Royalties are enforced | MarketplaceContract `buy_listing` and TicketContract restricted transfer | Both contracts with synchronized peers | Marketplace contract tests and review simulation | Resale transaction showing split | “Marketplace contract supports royalties”; do not claim a particular sale paid one without receipt proof |

## Current deployment audit

As of 2026-07-30, the repository and `frontend/.env.local` point to:

- TicketContract:
  `CDO4I4NMRXSTKBL3K7D3WWGRTVNRAUVOMKPKA6X726SY6SYQRBPQIDDQ`
- MarketplaceContract:
  `CC34MVNENC3VD26RJ42SVQXPDZ3JYZJBBNIHHXCX4EDIGUSPZOPDBC6M`
- Network: Stellar Testnet

The checked-in Testnet worker documents that this deployed TicketContract
exposes an older check-in argument shape than the current source. Therefore:

- purchase activity may be described as automated Testnet evidence;
- the three worker identities must not be described as PulseGate users;
- current four-argument check-in must not be described as deployed or live;
- durable refund/resale wording remains conditional on live service, migration,
  secret, and end-to-end verification.

The [2026-07-30 deployment audit](deployment-audit-2026-07-30.md) additionally
confirms that all local migrations are applied, all seven required Edge
Functions are active, and the current ticket/marketplace IDs are present in
service secrets. This makes the durable service boundary deployed, but it does
not repair the older TicketContract check-in ABI or demonstrate the flows end
to end.

## Deployment readiness checklist

- [ ] Deploy TicketContract and MarketplaceContract together from current source.
- [ ] Regenerate both TypeScript binding packages from the deployed WASM.
- [ ] Confirm `mark_used(event_id, ticket_id, expected_owner, organizer)`.
- [ ] Confirm TicketContract’s stored marketplace address.
- [ ] Confirm MarketplaceContract’s stored ticket address through deployment
      initialization/ledger inspection.
- [ ] Synchronize frontend environment values and Supabase secrets.
- [x] Apply purchase, organizer, ticket-operation, listing-visibility, and
      check-in migrations (CLI-verified 2026-07-30).
- [x] Deploy and inspect required Edge Functions (all active 2026-07-30).
- [ ] Complete a real deployed purchase.
- [ ] Complete a real deployed refund.
- [ ] Complete listing creation and either cancellation or resale.
- [ ] Complete an organizer-signed check-in.
- [ ] Complete fund release when a valid event lifecycle permits it.
- [ ] Capture the fixed nine-image evidence set.
- [ ] Publish a refreshed 1–2 minute walkthrough.
- [ ] Publish only privacy-reviewed genuine-user and feedback evidence.

Until a box is checked with a dated proof link, it is a release requirement—not
a marketing claim.
