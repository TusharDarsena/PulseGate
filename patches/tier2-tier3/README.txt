StellarTickets combined screenshot patch

Adds four captures without replacing the existing manifest or runner:
- Tier 2 organizer dashboard, populated, desktop
- Tier 3 auth default, mobile
- Tier 3 create-event preparing, desktop
- Tier 3 not-found default, desktop

Apply from repository root:
  node .\patches\tier2-tier3\apply-captures.mjs

Then run from frontend:
  npx playwright test --config=playwright.screenshots.config.ts --grep "organizer-dashboard-populated-desktop|auth-default-mobile|create-event-preparing-desktop|not-found-default-desktop"
