# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: capture.spec.ts >> scanner-ready-mobile: Represents the authenticated organizer mobile check-in surface after ownership, authoritative event status, the door window, and the matching wallet are confirmed, before camera activation.
- Location: e2e\screenshots\capture.spec.ts:32:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Ready for check-in').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Ready for check-in').first()

```

```yaml
- banner:
  - button "Go back": arrow_back
  - link "StellarTickets":
    - /url: /events
  - button "Account"
- main:
  - text: Organizer Hub · Midnight Frequency · Check-in qr_code_scanner
  - paragraph: Event status unavailable
  - paragraph: This event belongs to a different TicketContract deployment.
  - paragraph: Midnight Frequency
  - paragraph: The Foundry · Sat, Sep 12 · 7:30 PM – Sat, Sep 12 · 11:00 PM GMT+5:30
  - complementary:
    - heading "Door Status" [level=2]
    - paragraph: Event status unavailable
    - paragraph: This event belongs to a different TicketContract deployment.
    - term: Sold
    - definition: "214"
    - term: Checked in
    - definition: "37"
    - term: Remaining
    - definition: "177"
    - term: Unresolved
    - definition: "0"
    - heading "Organizer Wallet" [level=2]
    - paragraph: GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP
    - button "Connect Freighter"
    - heading "Scanner" [level=2]
    - button "Enable camera" [disabled]
- text: Stellar Testnet — balances and payments have no monetary value.
```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | import { SCREENSHOT_CAPTURES } from './capture-manifest';
  3   | import { installBrowseReadyMocks } from './helpers/install-browse-mocks';
  4   | import { installEventDetailReadyMocks } from './helpers/install-event-detail-mocks';
  5   | import { installPurchaseReviewReadyMocks } from './helpers/install-purchase-review-mocks';
  6   | import { installPurchaseReceiptConfirmedMocks } from './helpers/install-purchase-receipt-mocks';
  7   | import { installMyTicketsUpcomingMocks } from './helpers/install-my-tickets-mocks';
  8   | import { installScannerReadyMocks } from './helpers/install-scanner-ready-mocks';
  9   | import { installEventDraftReadyMocks } from './helpers/install-event-draft-mocks';
  10  | import { installOrganizerEventReadyMocks } from './helpers/install-organizer-event-mocks';
  11  | import { installMarketplaceLoadedMocks } from './helpers/install-marketplace-loaded-mocks';
  12  | import { installQrDisplayActiveMocks, installTicketDetailReadyMocks } from './helpers/install-ticket-support-mocks';
  13  | import {
  14  |   installAuthDefaultMocks,
  15  |   installCreateEventPreparingMocks,
  16  |   installNotFoundMocks,
  17  |   installOrganizerDashboardPopulatedMocks,
  18  | } from './helpers/install-tier2-tier3-mocks';
  19  | import { installAuthCallbackErrorMocks } from './helpers/install-auth-callback-mocks';
  20  | import { installAccountWalletReadyMocks } from './helpers/install-account-wallet-ready-mocks';
  21  | import { screenshotOutputPath } from './helpers/output-path';
  22  | import { stabilizePage } from './helpers/stabilize-page';
  23  | import { writeCaptureCatalog } from './helpers/write-catalog';
  24  | 
  25  | test.describe.configure({ mode: 'serial' });
  26  | 
  27  | test.afterAll(async () => {
  28  |   await writeCaptureCatalog(SCREENSHOT_CAPTURES);
  29  | });
  30  | 
  31  | for (const capture of SCREENSHOT_CAPTURES) {
  32  |   test(`${capture.id}: ${capture.purpose}`, async ({ page }, testInfo) => {
  33  |     await page.setViewportSize(capture.viewport);
  34  |     await page.clock.setFixedTime(capture.fixedTime ?? '2026-07-27T12:00:00+05:30');
  35  | 
  36  |     if (capture.id === 'browse-ready-desktop') {
  37  |       await installBrowseReadyMocks(page);
  38  |     } else if (capture.id === 'event-detail-ready-mobile') {
  39  |       await installEventDetailReadyMocks(page);
  40  |     } else if (capture.id === 'purchase-review-ready-mobile') {
  41  |       await installPurchaseReviewReadyMocks(page);
  42  |     } else if (capture.id === 'purchase-receipt-confirmed-mobile') {
  43  |       await installPurchaseReceiptConfirmedMocks(page);
  44  |     } else if (capture.id === 'my-tickets-upcoming-mobile') {
  45  |       await installMyTicketsUpcomingMocks(page);
  46  |     } else if (capture.id === 'scanner-ready-mobile') {
  47  |       await installScannerReadyMocks(page);
  48  |     } else if (capture.id === 'organizer-event-draft-ready-desktop') {
  49  |       await installEventDraftReadyMocks(page);
  50  |     } else if (capture.id === 'organizer-event-ready-desktop') {
  51  |       await installOrganizerEventReadyMocks(page);
  52  |     } else if (capture.id === 'marketplace-listings-loaded-desktop') {
  53  |       await installMarketplaceLoadedMocks(page);
  54  |     } else if (capture.id === 'ticket-detail-ready-mobile') {
  55  |       await installTicketDetailReadyMocks(page);
  56  |     } else if (capture.id === 'qr-display-active-mobile') {
  57  |       await installQrDisplayActiveMocks(page);
  58  |     } else if (capture.id === 'organizer-dashboard-populated-desktop') {
  59  |       await installOrganizerDashboardPopulatedMocks(page);
  60  |     } else if (capture.id === 'auth-default-mobile') {
  61  |       await installAuthDefaultMocks(page);
  62  |     } else if (capture.id === 'create-event-preparing-desktop') {
  63  |       await installCreateEventPreparingMocks(page);
  64  |     } else if (capture.id === 'not-found-default-desktop') {
  65  |       await installNotFoundMocks(page);
  66  |     } else if (capture.id === 'auth-callback-error-mobile') {
  67  |       await installAuthCallbackErrorMocks(page);
  68  |     } else if (capture.id === 'account-wallet-ready-mobile') {
  69  |       await installAccountWalletReadyMocks(page);
  70  |     } else {
  71  |       throw new Error(`No fixture installer exists for screenshot capture: ${capture.id}`);
  72  |     }
  73  | 
  74  |     await page.goto(capture.route, { waitUntil: 'domcontentloaded' });
  75  | 
  76  |     const readyState = capture.readyRole === 'alert'
  77  | 
  78  |       ? page.getByRole('alert').filter({ hasText: capture.readyText })
  79  | 
  80  |       : page.getByRole('heading', { name: capture.readyText });
  81  | 
  82  |     await expect(readyState).toBeVisible();
  83  |     for (const text of capture.visibleTexts) {
> 84  |       await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
      |                                                                    ^ Error: expect(locator).toBeVisible() failed
  85  |     }
  86  |     for (const label of capture.visibleLabels ?? []) {
  87  |       await expect(page.getByLabel(label)).toBeVisible();
  88  |     }
  89  | 
  90  |     await stabilizePage(page);
  91  | 
  92  |     if (capture.id === 'account-wallet-ready-mobile') {
  93  | 
  94  |       await page.evaluate(() => window.scrollTo(0, 96));
  95  | 
  96  |     }
  97  | 
  98  |     if (capture.scrollToText) {
  99  |       const scrollTarget = page.getByText(capture.scrollToText, { exact: false }).first();
  100 |       await scrollTarget.evaluate((element) => {
  101 |         element.scrollIntoView({ block: 'center', inline: 'nearest' });
  102 |       });
  103 |     }
  104 | 
  105 |     const outputPath = await screenshotOutputPath(capture);
  106 |     await page.screenshot({
  107 |       path: outputPath,
  108 |       fullPage: false,
  109 |       animations: 'disabled',
  110 |     });
  111 | 
  112 |     await testInfo.attach('approved-candidate', {
  113 |       path: outputPath,
  114 |       contentType: 'image/png',
  115 |     });
  116 |   });
  117 | }
  118 | 
```