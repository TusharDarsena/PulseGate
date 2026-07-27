# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: capture.spec.ts >> scanner-ready-mobile: Represents the authenticated organizer mobile check-in surface after ownership, authoritative event status, the door window, and the matching wallet are confirmed, before camera activation.
- Location: e2e\screenshots\capture.spec.ts:20:3

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
  - text: qr_code_scanner
  - paragraph: Event status unavailable
  - paragraph: invalid encoded string
  - paragraph: Midnight Frequency
  - paragraph: The Foundry · Sat, Sep 12 · 7:30 PM – Sat, Sep 12 · 11:00 PM GMT+5:30
  - complementary:
    - heading "Door Status" [level=2]
    - paragraph: Event status unavailable
    - paragraph: invalid encoded string
    - term: Sold
    - definition: "214"
    - term: Checked in
    - definition: "37"
    - term: Remaining
    - definition: "177"
    - term: Unresolved
    - definition: "0"
    - heading "Organizer Wallet" [level=2]
    - paragraph: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
    - paragraph: "Connected: GBBE...FZSP"
    - heading "Scanner" [level=2]
    - button "Enable camera" [disabled]
- text: Stellar Testnet — balances and payments have no monetary value.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { SCREENSHOT_CAPTURES } from './capture-manifest';
  3  | import { installBrowseReadyMocks } from './helpers/install-browse-mocks';
  4  | import { installEventDetailReadyMocks } from './helpers/install-event-detail-mocks';
  5  | import { installPurchaseReviewReadyMocks } from './helpers/install-purchase-review-mocks';
  6  | import { installPurchaseReceiptConfirmedMocks } from './helpers/install-purchase-receipt-mocks';
  7  | import { installMyTicketsUpcomingMocks } from './helpers/install-my-tickets-mocks';
  8  | import { installScannerReadyMocks } from './helpers/install-scanner-ready-mocks';
  9  | import { screenshotOutputPath } from './helpers/output-path';
  10 | import { stabilizePage } from './helpers/stabilize-page';
  11 | import { writeCaptureCatalog } from './helpers/write-catalog';
  12 | 
  13 | test.describe.configure({ mode: 'serial' });
  14 | 
  15 | test.afterAll(async () => {
  16 |   await writeCaptureCatalog(SCREENSHOT_CAPTURES);
  17 | });
  18 | 
  19 | for (const capture of SCREENSHOT_CAPTURES) {
  20 |   test(`${capture.id}: ${capture.purpose}`, async ({ page }, testInfo) => {
  21 |     await page.setViewportSize(capture.viewport);
  22 |     await page.clock.setFixedTime(capture.fixedTime ?? '2026-07-27T12:00:00+05:30');
  23 | 
  24 |     if (capture.id === 'browse-ready-desktop') {
  25 |       await installBrowseReadyMocks(page);
  26 |     } else if (capture.id === 'event-detail-ready-mobile') {
  27 |       await installEventDetailReadyMocks(page);
  28 |     } else if (capture.id === 'purchase-review-ready-mobile') {
  29 |       await installPurchaseReviewReadyMocks(page);
  30 |     } else if (capture.id === 'purchase-receipt-confirmed-mobile') {
  31 |       await installPurchaseReceiptConfirmedMocks(page);
  32 |     } else if (capture.id === 'my-tickets-upcoming-mobile') {
  33 |       await installMyTicketsUpcomingMocks(page);
  34 |     } else if (capture.id === 'scanner-ready-mobile') {
  35 |       await installScannerReadyMocks(page);
  36 |     } else {
  37 |       throw new Error(`No fixture installer exists for screenshot capture: ${capture.id}`);
  38 |     }
  39 | 
  40 |     await page.goto(capture.route, { waitUntil: 'domcontentloaded' });
  41 | 
  42 |     await expect(
  43 |       page.getByRole('heading', { name: capture.readyText }),
  44 |     ).toBeVisible();
  45 |     for (const text of capture.visibleTexts) {
> 46 |       await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
     |                                                                    ^ Error: expect(locator).toBeVisible() failed
  47 |     }
  48 |     for (const label of capture.visibleLabels ?? []) {
  49 |       await expect(page.getByLabel(label)).toBeVisible();
  50 |     }
  51 | 
  52 |     await stabilizePage(page);
  53 | 
  54 |     if (capture.scrollToText) {
  55 |       const scrollTarget = page.getByText(capture.scrollToText, { exact: false }).first();
  56 |       await scrollTarget.evaluate((element) => {
  57 |         element.scrollIntoView({ block: 'center', inline: 'nearest' });
  58 |       });
  59 |     }
  60 | 
  61 |     const outputPath = await screenshotOutputPath(capture);
  62 |     await page.screenshot({
  63 |       path: outputPath,
  64 |       fullPage: false,
  65 |       animations: 'disabled',
  66 |     });
  67 | 
  68 |     await testInfo.attach('approved-candidate', {
  69 |       path: outputPath,
  70 |       contentType: 'image/png',
  71 |     });
  72 |   });
  73 | }
  74 | 
```