import { test, expect } from '@playwright/test';
import { SCREENSHOT_CAPTURES } from './capture-manifest';
import { installBrowseReadyMocks } from './helpers/install-browse-mocks';
import { installEventDetailReadyMocks } from './helpers/install-event-detail-mocks';
import { installPurchaseReviewReadyMocks } from './helpers/install-purchase-review-mocks';
import { installPurchaseReceiptConfirmedMocks } from './helpers/install-purchase-receipt-mocks';
import { installMyTicketsUpcomingMocks } from './helpers/install-my-tickets-mocks';
import { installScannerReadyMocks } from './helpers/install-scanner-ready-mocks';
import { installEventDraftReadyMocks } from './helpers/install-event-draft-mocks';
import { installOrganizerEventReadyMocks } from './helpers/install-organizer-event-mocks';
import { installMarketplaceLoadedMocks } from './helpers/install-marketplace-loaded-mocks';
import { installQrDisplayActiveMocks, installTicketDetailReadyMocks } from './helpers/install-ticket-support-mocks';
import {
  installAuthDefaultMocks,
  installCreateEventPreparingMocks,
  installNotFoundMocks,
  installOrganizerDashboardPopulatedMocks,
} from './helpers/install-tier2-tier3-mocks';
import { installAuthCallbackErrorMocks } from './helpers/install-auth-callback-mocks';
import { installAccountWalletReadyMocks } from './helpers/install-account-wallet-ready-mocks';
import { screenshotOutputPath } from './helpers/output-path';
import { stabilizePage } from './helpers/stabilize-page';
import { writeCaptureCatalog } from './helpers/write-catalog';

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await writeCaptureCatalog(SCREENSHOT_CAPTURES);
});

for (const capture of SCREENSHOT_CAPTURES) {
  test(`${capture.id}: ${capture.purpose}`, async ({ page }, testInfo) => {
    await page.setViewportSize(capture.viewport);
    await page.clock.setFixedTime(capture.fixedTime ?? '2026-07-27T12:00:00+05:30');

    if (capture.id === 'browse-ready-desktop') {
      await installBrowseReadyMocks(page);
    } else if (capture.id === 'event-detail-ready-mobile') {
      await installEventDetailReadyMocks(page);
    } else if (capture.id === 'purchase-review-ready-mobile') {
      await installPurchaseReviewReadyMocks(page);
    } else if (capture.id === 'purchase-receipt-confirmed-mobile') {
      await installPurchaseReceiptConfirmedMocks(page);
    } else if (capture.id === 'my-tickets-upcoming-mobile') {
      await installMyTicketsUpcomingMocks(page);
    } else if (capture.id === 'scanner-ready-mobile') {
      await installScannerReadyMocks(page);
    } else if (capture.id === 'organizer-event-draft-ready-desktop') {
      await installEventDraftReadyMocks(page);
    } else if (capture.id === 'organizer-event-ready-desktop') {
      await installOrganizerEventReadyMocks(page);
    } else if (capture.id === 'marketplace-listings-loaded-desktop') {
      await installMarketplaceLoadedMocks(page);
    } else if (capture.id === 'ticket-detail-ready-mobile') {
      await installTicketDetailReadyMocks(page);
    } else if (capture.id === 'qr-display-active-mobile') {
      await installQrDisplayActiveMocks(page);
    } else if (capture.id === 'organizer-dashboard-populated-desktop') {
      await installOrganizerDashboardPopulatedMocks(page);
    } else if (capture.id === 'auth-default-mobile') {
      await installAuthDefaultMocks(page);
    } else if (capture.id === 'create-event-preparing-desktop') {
      await installCreateEventPreparingMocks(page);
    } else if (capture.id === 'not-found-default-desktop') {
      await installNotFoundMocks(page);
    } else if (capture.id === 'auth-callback-error-mobile') {
      await installAuthCallbackErrorMocks(page);
    } else if (capture.id === 'account-wallet-ready-mobile') {
      await installAccountWalletReadyMocks(page);
    } else {
      throw new Error(`No fixture installer exists for screenshot capture: ${capture.id}`);
    }

    await page.goto(capture.route, { waitUntil: 'domcontentloaded' });

    const readyState = capture.readyRole === 'alert'

      ? page.getByRole('alert').filter({ hasText: capture.readyText })

      : page.getByRole('heading', { name: capture.readyText, exact: true });

    await expect(readyState).toBeVisible();
    for (const text of capture.visibleTexts) {
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    }
    for (const label of capture.visibleLabels ?? []) {
      await expect(page.getByLabel(label)).toBeVisible();
    }

    await stabilizePage(page);

    if (capture.id === 'account-wallet-ready-mobile') {

      await page.evaluate(() => window.scrollTo(0, 96));

    }

    if (capture.scrollToText) {
      const scrollTarget = page.getByText(capture.scrollToText, { exact: false }).first();
      await scrollTarget.evaluate((element) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
      });
    }

    const outputPath = await screenshotOutputPath(capture);
    await page.screenshot({
      path: outputPath,
      fullPage: false,
      animations: 'disabled',
    });

    await testInfo.attach('approved-candidate', {
      path: outputPath,
      contentType: 'image/png',
    });
  });
}
