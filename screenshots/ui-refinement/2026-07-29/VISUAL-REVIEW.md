# Visual review — 2026-07-29

The Playwright catalog captured 17 deterministic UI states. Contract reads,
wallet verification, passkey signing, Horizon, and Supabase were mocked at their
real browser boundaries; no live blockchain transactions were submitted.

## Highest-priority findings

1. **Material icon names render as visible text when Google Fonts is blocked.**
   Examples include `arrow_back`, `location_on`, `calendar_today`,
   `shopping_cart`, `qr_code_2`, `storefront`, `draft`, and
   `event_available`. This affects navigation, event cards, marketplace cards,
   ticket actions, and organizer metrics. Self-host the icon font or replace
   ligature-based icons with local SVG components.

2. **Fixed mobile chrome obscures page content and actions.** The Testnet banner
   overlaps content on Event Detail and QR Display, and its combination with the
   bottom navigation clips the Purchase Receipt, My Tickets, and Account
   screens. Reserve bottom space for both fixed elements and keep the banner
   positioned above the navigation.

3. **The mobile ticket-detail poster crops its embedded title.** Only
   `idnight Frequency` is visible. Avoid baking essential text into
   `object-cover` artwork, or change the poster crop/position.

## Secondary findings

- The Event Detail purchase action is not visible in the initial mobile
  viewport after the hero and metadata cards. Consider a sticky purchase action
  or a denser above-the-fold summary.
- Marketplace cards repeat the event title in the artwork and the card body.
  The artwork title has poor contrast, while the first card's ask-price/XLM
  label sits too close to the Buy Now button.
- The scanner displays the full organizer address across two lines. A truncated
  address with copy/reveal affordances would scan better.
- The Create Event preparing state and the 404 state leave very large empty
  desktop areas. They are clear, but could use stronger visual anchoring.

## Blockchain follow-up

Live-chain execution is unnecessary for screenshot-based visual review.
Before a release, run a separate, small Testnet smoke pass for primary purchase,
QR owner/status revalidation, organizer wallet verification, and
organizer-signed `mark_used()`. Keep that pass separate from this deterministic
catalog so visual captures remain fast and repeatable.
