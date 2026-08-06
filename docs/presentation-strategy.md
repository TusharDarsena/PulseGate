# PulseGate presentation strategy

## Purpose

Create an audience-winning presentation that makes PulseGate feel like a
relevant, usable ticketing product while proving that its blockchain layer
solves real trust problems rather than serving as a showcase feature.

## Source boundary

This strategy is grounded only in:

- [`README.md`](../README.md)
- [`docs/architecture.md`](architecture.md)
- [`docs/agent-handbook.md`](agent-handbook.md)

Do not use unverified adoption metrics, market-size figures, or claims outside
these sources. Be explicit that the deployed contracts currently run on Stellar
Testnet.

## Communication contract

| Field | Strategy |
| --- | --- |
| Audience | Prospective users, hackathon judges, Stellar ecosystem participants, and potential product partners who need to see both product quality and credible blockchain utility. |
| Intent | Persuade the audience that PulseGate is a real event-ticketing product whose trust-critical actions are meaningfully improved by Stellar and Soroban. |
| Desired outcome | The audience understands that ticket ownership, payment escrow, resale settlement, refunds, and venue entry are enforced by authoritative on-chain rules, and wants to see or try the product. |
| Core message | PulseGate uses blockchain only where ticketing needs enforceable truth: tickets should be easy to use and hard to fake. |
| Delivery | Presenter-led, with enough on-slide evidence to remain useful as a follow-up deck. |
| Recommended length | 12 slides, delivered in 8–10 minutes. |
| Narrative mode | Narrative: situation -> tension -> resolution -> proof. |
| Reading mode | Balanced: concise claims and visual evidence on the slide; explanation and transitions delivered by the presenter. |

## Story rules

- Lead with the human ticketing problem, not the chain, contracts, or wallets.
- Translate every technical mechanism into a concrete outcome for an attendee,
  organizer, or venue.
- Use blockchain as proof of enforcement, not as a decorative theme.
- Show that the app handles unhappy paths: interrupted payments, stale resale
  listings, cancellation refunds, delayed mirrors, and invalid QR entry.
- Maintain credibility by clearly labelling Testnet proof and MVP boundaries.
- Avoid contract code, long API names, and feature dumps.

## Slide structure

| # | Title | Key content | Audience move |
| ---: | --- | --- | --- |
| 1 | **Event tickets should be easy to use—and hard to fake.** | A strong product promise and a visual of a real event moment, ticket, or entry experience. | Understand the problem PulseGate exists to solve. |
| 2 | **Ticketing breaks at the moments that matter most.** | Frame the high-trust moments: purchase, resale, refunds, and venue entry. | Feel the stakes behind a seemingly ordinary ticket. |
| 3 | **Blockchain belongs behind the moments that require proof.** | Reframe the technology: people do not need crypto features; they need enforceable ownership, settlement, and admission. | See why blockchain is relevant to this product. |
| 4 | **PulseGate feels like a modern event app.** | Attendee journey: discovery, event details, checkout, receipts, My Tickets, resale, and QR entry. | Recognize a complete, familiar product experience. |
| 5 | **Organizers get one operating system for the event lifecycle.** | Draft, publish, manage event terms, track sales and escrow, cancel or complete, and operate check-in. | See a practical organizer workflow rather than a narrow demo. |
| 6 | **Every purchase is protected beyond the payment click.** | Contract simulation, delegated signing, persisted transaction identity, on-chain confirmation, escrow, and durable receipts. | Trust that a payment is recoverable and not blindly repeated. |
| 7 | **Resale is not a marketplace promise—it is an atomic rule.** | The resale contract checks owner and event state, then settles organizer royalty, seller proceeds, and ownership transfer together. | Understand why resale is safer than a database-only listing. |
| 8 | **A QR code is not enough. Verified entry is.** | Fresh signed QR, local validation, on-chain owner/status check, and organizer-signed `mark_used()` before admission. | Believe that venue entry is resistant to copied, expired, transferred, or refunded tickets. |
| 9 | **One product, clear boundaries of trust.** | Simple architecture diagram: Soroban contracts authorize economic and entry actions; Supabase supports discovery, recovery, and read models. | Understand that no convenient off-chain system can override authoritative ticket state. |
| 10 | **Designed for real-world failure, not just a happy-path demo.** | Interrupted submissions, `sync_warning` reconciliation, wallet recovery, pull-based refunds, stale resale rejection, and recoverable check-in operations. | Gain confidence that the product anticipates operational reality. |
| 11 | **This is running on Stellar Testnet today.** | Deployed TicketContract and MarketplaceContract, verified activity and transaction links, passing checks, and hosted product proof. State clearly that Testnet XLM has no monetary value. | Treat the product as implemented and evidenced, while trusting its transparency about current maturity. |
| 12 | **PulseGate turns tickets into verifiable rights.** | Closing synthesis: confidence for attendees, control for organizers, trustworthy entry for venues. Include a direct app or demo call to action. | Leave with the core message and an immediate next action. |

## Evidence and visual approach

- Use product UI and flow visuals to establish usability before introducing
  system architecture.
- Use one simplified lifecycle visual: publish -> purchase -> escrow -> resale,
  refund, or verified entry -> release remaining funds.
- Use one simplified authority visual: **Soroban owns truth; Supabase makes it
  discoverable.**
- Use a single purchase or resale sequence to demonstrate how on-chain rules
  create an outcome that the UI alone cannot guarantee.
- Reserve detailed contract addresses, transaction hashes, and verification
  links for the Testnet proof slide or appendix so they validate the story
  without overwhelming it.

## Claims to make carefully

- Say that Soroban contracts are authoritative for purchase, transfer, refund,
  fund release, and venue entry.
- Say that Supabase is a searchable read model and does not authorize those
  actions.
- Say that QR entry requires local signature validation, an on-chain owner and
  status check, and a successful organizer-authorized `mark_used()` call.
- Say that the current deployment is on Stellar Testnet; do not imply mainnet
  production readiness.
- Do not present unverified market traction, revenue, or adoption figures.

## Closing line

> PulseGate makes tickets easy to use, while making the moments that matter
> enforceable.
