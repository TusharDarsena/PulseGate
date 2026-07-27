import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { loadEnv } from 'vite';

const USER_ID = '00000000-0000-4000-8000-000000000302';
const USER_EMAIL = 'attendee@example.test';
const ATTENDEE_ADDRESS = 'GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP';
const EXPIRES_AT = 1_893_456_000;

const jsonHeaders = {
  'access-control-allow-headers': 'authorization, apikey, content-profile, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
  'content-profile': 'public',
  'content-type': 'application/json; charset=utf-8',
};

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
 * Restores the human session and attendee wallet needed by AccountPage. The
 * organizer wallet deliberately remains disconnected so its independent
 * Connect Freighter control is visible without invoking the extension.
 */
export async function installAccountWalletReadyMocks(page: Page): Promise<void> {
  const environment = loadEnv('development', process.cwd(), '');
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is required for the account screenshot capture.');
  }

  const session = screenshotSession();

  await page.addInitScript(
    ({ authKey, sessionValue }) => {
      localStorage.setItem(authKey, JSON.stringify(sessionValue));
      localStorage.removeItem('stellar-tickets-store-v2');
    },
    {
      authKey: authStorageKey(supabaseUrl),
      sessionValue: session,
    },
  );

  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }

    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/rest/v1/rpc/get_my_attendee_wallet')) {
      await fulfillJson(route, [{
        address: ATTENDEE_ADDRESS,
        network: 'StellarTestnet',
        readiness: 'ready',
      }]);
      return;
    }
    if (pathname.endsWith('/rest/v1/rpc/get_my_tickets')) {
      await fulfillJson(route, []);
      return;
    }
    if (pathname.endsWith('/rest/v1/listings')) {
      await fulfillJson(route, []);
      return;
    }

    await fulfillJson(route, []);
  });

  await page.route('**/functions/v1/purchase-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action === 'list-pending-sync') {
      await fulfillJson(route, { operations: [] });
      return;
    }
    throw new Error(`Unexpected purchase-operation action: ${body?.action ?? 'missing'}`);
  });

  await page.route('**/auth/v1/user**', async (route) => {
    await fulfillJson(route, session.user);
  });
  await page.route('**/auth/v1/token**', async (route) => {
    await fulfillJson(route, session);
  });
}
