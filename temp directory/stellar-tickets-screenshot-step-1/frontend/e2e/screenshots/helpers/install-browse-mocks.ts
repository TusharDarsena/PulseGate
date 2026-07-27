import type { Page, Route } from '@playwright/test';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';

const jsonHeaders = {
  'access-control-allow-origin': '*',
  'content-profile': 'public',
  'content-type': 'application/json; charset=utf-8',
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}

/**
 * Keeps the public Browse capture offline and deterministic.
 * The app currently mounts listing reads globally, even while /events is open,
 * so listings must be answered as well as the discovery view.
 */
export async function installBrowseReadyMocks(page: Page): Promise<void> {
  await page.route('**/rest/v1/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (
      pathname.endsWith('/rest/v1/discoverable_events') ||
      pathname.endsWith('/rest/v1/published_events')
    ) {
      await fulfillJson(route, BROWSE_READY_EVENTS);
      return;
    }

    if (pathname.endsWith('/rest/v1/listings')) {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, []);
  });
}
