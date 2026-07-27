# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: capture.spec.ts >> event-detail-ready-mobile: Represents the public mobile event-detail surface when an event is available for purchase.
- Location: e2e\screenshots\capture.spec.ts:16:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('On sale').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('On sale').first()

```

```yaml
- banner:
  - button "Go back": arrow_back
  - link "StellarTickets":
    - /url: /events
  - button "Sign in"
- main:
  - img "Midnight Frequency"
  - text: Music Unavailable
  - heading "Midnight Frequency" [level=1]
  - paragraph: An electronic music showcase with live visual performances.
  - text: calendar_today
  - paragraph: Date and time
  - text: Sat, Sep 12 · 7:30 PM – Sat, Sep 12 · 11:00 PM GMT+5:30 schedule
  - paragraph: Timezone
  - text: Asia/Kolkata location_on
  - paragraph: Venue
  - text: The Foundry 12 Residency Road, Bengaluru group
  - paragraph: Availability
  - text: 286 of 500 remaining 43% sold
  - heading "About this event" [level=2]
  - paragraph: An electronic music showcase with live visual performances. This seeded event is used only for deterministic visual capture.
  - heading "Refunds" [level=3]
  - paragraph: If the organizer cancels the event, the current ticket owner can claim the original primary ticket price.
  - heading "Resale" [level=3]
  - paragraph: Eligible tickets may be listed through the StellarTickets marketplace. Listings do not reserve or lock a ticket.
  - heading "Entry" [level=3]
  - paragraph: Present the rotating ticket QR at the entrance.
  - heading "Support" [level=3]
  - paragraph: support@example.test
  - heading "Event actions" [level=2]
  - button "Share event"
  - link "Google Calendar":
    - /url: https://calendar.google.com/calendar/render?action=TEMPLATE&text=Midnight+Frequency&dates=20260912T140000Z%2F20260912T173000Z&ctz=Asia%2FKolkata&details=An+electronic+music+showcase+with+live+visual+performances.%0A%0AEntry%3A+Present+the+rotating+ticket+QR+at+the+entrance.%0A%0Ahttp%3A%2F%2Flocalhost%3A5173%2Fevents%2Fevent-seed-a-01&location=The+Foundry%2C+12+Residency+Road%2C+Bengaluru
  - link "Outlook":
    - /url: https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=Midnight+Frequency&startdt=2026-09-12T14%3A00%3A00.000Z&enddt=2026-09-12T17%3A30%3A00.000Z&body=An+electronic+music+showcase+with+live+visual+performances.%0A%0AEntry%3A+Present+the+rotating+ticket+QR+at+the+entrance.%0A%0Ahttp%3A%2F%2Flocalhost%3A5173%2Fevents%2Fevent-seed-a-01&location=The+Foundry%2C+12+Residency+Road%2C+Bengaluru
  - button "Download .ics"
  - link "Open in maps":
    - /url: https://www.google.com/maps/search/?api=1&query=The+Foundry%2C+12+Residency+Road%2C+Bengaluru
  - complementary:
    - paragraph: 1 General Admission ticket
    - text: 18.00 XLM
    - button "Unavailable" [disabled]
    - paragraph: invalid encoded string
    - button "Retry authoritative check"
    - paragraph: Organizer
    - paragraph: Stellar City Collective
    - paragraph: GAAZ...CCWN
- text: Stellar Testnet — balances and payments have no monetary value.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { SCREENSHOT_CAPTURES } from './capture-manifest';
  3  | import { installBrowseReadyMocks } from './helpers/install-browse-mocks';
  4  | import { installEventDetailReadyMocks } from './helpers/install-event-detail-mocks';
  5  | import { screenshotOutputPath } from './helpers/output-path';
  6  | import { stabilizePage } from './helpers/stabilize-page';
  7  | import { writeCaptureCatalog } from './helpers/write-catalog';
  8  | 
  9  | test.describe.configure({ mode: 'serial' });
  10 | 
  11 | test.afterAll(async () => {
  12 |   await writeCaptureCatalog(SCREENSHOT_CAPTURES);
  13 | });
  14 | 
  15 | for (const capture of SCREENSHOT_CAPTURES) {
  16 |   test(`${capture.id}: ${capture.purpose}`, async ({ page }, testInfo) => {
  17 |     await page.setViewportSize(capture.viewport);
  18 |     await page.clock.setFixedTime('2026-07-27T12:00:00+05:30');
  19 | 
  20 |     if (capture.id === 'browse-ready-desktop') {
  21 |       await installBrowseReadyMocks(page);
  22 |     } else if (capture.id === 'event-detail-ready-mobile') {
  23 |       await installEventDetailReadyMocks(page);
  24 |     } else {
  25 |       throw new Error(`No fixture installer exists for screenshot capture: ${capture.id}`);
  26 |     }
  27 | 
  28 |     await page.goto(capture.route, { waitUntil: 'domcontentloaded' });
  29 | 
  30 |     await expect(
  31 |       page.getByRole('heading', { name: capture.readyText }),
  32 |     ).toBeVisible();
  33 |     for (const text of capture.visibleTexts) {
> 34 |       await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
     |                                                                    ^ Error: expect(locator).toBeVisible() failed
  35 |     }
  36 |     for (const label of capture.visibleLabels ?? []) {
  37 |       await expect(page.getByLabel(label)).toBeVisible();
  38 |     }
  39 | 
  40 |     await stabilizePage(page);
  41 | 
  42 |     const outputPath = await screenshotOutputPath(capture);
  43 |     await page.screenshot({
  44 |       path: outputPath,
  45 |       fullPage: false,
  46 |       animations: 'disabled',
  47 |     });
  48 | 
  49 |     await testInfo.attach('approved-candidate', {
  50 |       path: outputPath,
  51 |       contentType: 'image/png',
  52 |     });
  53 |   });
  54 | }
  55 | 
```