import type { Page, Route } from '@playwright/test';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';

const jsonHeaders = {
  'access-control-allow-headers': 'authorization, apikey, content-profile, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
  'content-profile': 'public',
  'content-type': 'application/json; charset=utf-8',
};

const SELLERS = [
  'GCKFBEIYTKP4U4Z4V3QH6Q52I5K4N6DJH7N2GJFXWFIOL7ZQOWR4BZ7A',
  'GBO2ESMNMHOQZRTEFGMPHOMHIHSEMV6BWCGSSVHZQXM6FCK5M5KUN5QY',
  'GD4I3WJAVK76Z47EFPGL3M44IWN5VGI7JJJGXEFJYEQ3Y3ENZ6HWQ6TZ',
] as const;

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    headers: jsonHeaders,
    body: status === 204 ? '' : JSON.stringify(body),
  });
}

/** Populates the public secondary market without invoking any wallet or contract flow. */
export async function installMarketplaceLoadedMocks(page: Page): Promise<void> {
  const events = BROWSE_READY_EVENTS.slice(0, 3);
  const listings = events.map((event, index) => ({
    listing_id: `listing-seed-a-0${index + 1}`,
    seller_address: SELLERS[index],
    ticket_id: `resale-ticket-seed-a-0${index + 1}`,
    event_id: event.event_id,
    ask_price_stroops: [210_000_000, 105_000_000, 140_000_000][index].toString(),
    status: 'Open',
    listed_at: `2026-07-2${7 - index}T08:00:00.000Z`,
  }));

  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/rest/v1/listings')) {
      await fulfillJson(route, listings);
      return;
    }
    if (pathname.endsWith('/rest/v1/published_events')) {
      await fulfillJson(route, events);
      return;
    }
    await fulfillJson(route, []);
  });
}
