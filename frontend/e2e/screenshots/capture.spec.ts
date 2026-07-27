import { test, expect } from '@playwright/test';
import { SCREENSHOT_CAPTURES } from './capture-manifest';
import { installBrowseReadyMocks } from './helpers/install-browse-mocks';
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
    } else {
      throw new Error(`No fixture installer exists for screenshot capture: ${capture.id}`);
    }

    await page.goto(capture.route, { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByRole('heading', { name: capture.readyText }),
    ).toBeVisible();
    await expect(page.getByText('Midnight Frequency')).toBeVisible();
    await expect(page.getByText('Builders on Stellar')).toBeVisible();

    await stabilizePage(page);

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