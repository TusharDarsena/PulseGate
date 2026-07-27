import { test, expect } from '@playwright/test';
import { SCREENSHOT_CAPTURES } from './capture-manifest';
import { installBrowseReadyMocks } from './helpers/install-browse-mocks';
import { installEventDetailReadyMocks } from './helpers/install-event-detail-mocks';
import { installPurchaseReviewReadyMocks } from './helpers/install-purchase-review-mocks';
import { installPurchaseReceiptConfirmedMocks } from './helpers/install-purchase-receipt-mocks';
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
    await page.clock.setFixedTime('2026-07-27T12:00:00+05:30');

    if (capture.id === 'browse-ready-desktop') {
      await installBrowseReadyMocks(page);
    } else if (capture.id === 'event-detail-ready-mobile') {
      await installEventDetailReadyMocks(page);
    } else if (capture.id === 'purchase-review-ready-mobile') {
      await installPurchaseReviewReadyMocks(page);
    } else if (capture.id === 'purchase-receipt-confirmed-mobile') {
      await installPurchaseReceiptConfirmedMocks(page);
    } else {
      throw new Error(`No fixture installer exists for screenshot capture: ${capture.id}`);
    }

    await page.goto(capture.route, { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('heading', { name: capture.readyText }),
    ).toBeVisible();
    for (const text of capture.visibleTexts) {
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    }
    for (const label of capture.visibleLabels ?? []) {
      await expect(page.getByLabel(label)).toBeVisible();
    }

    await stabilizePage(page);

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
