import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { loadEnv } from 'vite';
import { installEventDetailReadyMocks } from './install-event-detail-mocks';

const ATTENDEE_ADDRESS = 'GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP';
const USER_ID = '00000000-0000-4000-8000-000000000302';
const USER_EMAIL = 'attendee@example.test';
const EXPIRES_AT = 1_893_456_000;
const SCREENSHOT_REVIEW_STORAGE_KEY = 'stellar-tickets:screenshot-purchase-review';

const jsonHeaders = {
  'access-control-allow-headers': 'authorization, apikey, content-profile, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
  'content-profile': 'public',
  'content-type': 'application/json; charset=utf-8',
};

function screenshotEnvironment(): Record<string, string> {
  return loadEnv('development', process.cwd(), '');
}

function base64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function screenshotSession() {
  const user = {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: USER_EMAIL,
    email_confirmed_at: '2026-07-27T06:00:00.000Z',
    phone: '',
    confirmed_at: '2026-07-27T06:00:00.000Z',
    last_sign_in_at: '2026-07-27T06:15:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { email: USER_EMAIL, email_verified: true },
    identities: [],
    created_at: '2026-07-27T06:00:00.000Z',
    updated_at: '2026-07-27T06:15:00.000Z',
    is_anonymous: false,
  };
  const accessToken = [
    base64Url({ alg: 'HS256', typ: 'JWT' }),
    base64Url({
      aud: 'authenticated',
      exp: EXPIRES_AT,
      iat: 1_775_000_000,
      role: 'authenticated',
      sub: USER_ID,
      email: USER_EMAIL,
    }),
    'screenshot-fixture',
  ].join('.');

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3_600,
    expires_at: EXPIRES_AT,
    refresh_token: 'screenshot-refresh-token',
    user,
  };
}

function authStorageKey(supabaseUrl: string): string {
  const projectReference = new URL(supabaseUrl).hostname.split('.')[0];
  if (!projectReference) throw new Error('Could not derive the Supabase auth storage key.');
  return `sb-${projectReference}-auth-token`;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    headers: jsonHeaders,
    body: status === 204 ? '' : JSON.stringify(body),
  });
}

/**
 * Seeds only the browser-facing prerequisites for a truthful checkout review.
 * PurchasePage's dev-only screenshot controller supplies the already-simulated
 * fee and durable review operation, so no wallet approval or Stellar mutation
 * is attempted during capture.
 */
export async function installPurchaseReviewReadyMocks(page: Page): Promise<void> {
  const environment = screenshotEnvironment();
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  const horizonUrl = environment.VITE_HORIZON_URL;
  if (!supabaseUrl || !horizonUrl) {
    throw new Error('VITE_SUPABASE_URL and VITE_HORIZON_URL are required for checkout capture.');
  }

  const session = screenshotSession();
  await page.addInitScript(
    ({ authKey, reviewKey, value }) => {
      localStorage.setItem(authKey, JSON.stringify(value));
      sessionStorage.setItem(reviewKey, 'ready');
    },
    {
      authKey: authStorageKey(supabaseUrl),
      reviewKey: SCREENSHOT_REVIEW_STORAGE_KEY,
      value: session,
    },
  );

  // Reuse the proven seedA published-event and authoritative read fixture.
  await installEventDetailReadyMocks(page);

  await page.route('**/rest/v1/rpc/get_my_attendee_wallet**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    await fulfillJson(route, [{
      address: ATTENDEE_ADDRESS,
      network: 'StellarTestnet',
      readiness: 'ready',
    }]);
  });

  await page.route('**/rest/v1/rpc/get_my_tickets**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    await fulfillJson(route, []);
  });

  await page.route('**/rest/v1/app_cache**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    await fulfillJson(route, { value: { price: 0.12 } });
  });

  await page.route('**/functions/v1/purchase-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action !== 'list-pending-sync') {
      throw new Error(`Unexpected purchase-operation action during screenshot: ${body?.action ?? 'missing'}`);
    }
    await fulfillJson(route, { operations: [] });
  });

  await page.route('**/auth/v1/user**', async (route) => {
    await fulfillJson(route, session.user);
  });

  await page.route('**/auth/v1/token**', async (route) => {
    await fulfillJson(route, session);
  });

  await page.route(
    (url) => url.toString().startsWith(`${horizonUrl.replace(/\/+$/, '')}/accounts/`),
    async (route) => {
      await fulfillJson(route, {
        id: ATTENDEE_ADDRESS,
        account_id: ATTENDEE_ADDRESS,
        sequence: '1',
        balances: [{ asset_type: 'native', balance: '50.0000000' }],
      });
    },
  );
}
