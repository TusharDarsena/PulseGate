import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { loadEnv } from 'vite';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';

const EVENT_ID = 'event-seed-a-01';
const OPERATION_ID = '00000000-0000-4000-8000-000000000401';
const TICKET_ID = 'ticket-seed-a-01';
const ATTENDEE_ADDRESS = 'GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP';
const USER_ID = '00000000-0000-4000-8000-000000000302';
const USER_EMAIL = 'attendee@example.test';
const EXPIRES_AT = 1_893_456_000;

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
 * Supplies one synchronized, currently owned ticket and its event metadata.
 * No contract, wallet-signing, transaction, or marketplace action is executed.
 */
export async function installMyTicketsUpcomingMocks(page: Page): Promise<void> {
  const environment = screenshotEnvironment();
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is required for My Tickets capture.');
  }

  const event = BROWSE_READY_EVENTS.find((candidate) => candidate.event_id === EVENT_ID);
  if (!event) throw new Error(`Browse seed event not found: ${EVENT_ID}`);

  const session = screenshotSession();
  const ticket = {
    ticket_id: TICKET_ID,
    event_id: EVENT_ID,
    owner_address: ATTENDEE_ADDRESS,
    status: 'Active',
    purchased_at: '2026-07-27T07:00:00.000Z',
    receipt_operation_id: OPERATION_ID,
  };

  await page.addInitScript(
    ({ authKey, value }) => {
      localStorage.setItem(authKey, JSON.stringify(value));
    },
    {
      authKey: authStorageKey(supabaseUrl),
      value: session,
    },
  );

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
    await fulfillJson(route, [ticket]);
  });

  await page.route('**/rest/v1/published_events**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const requested = new URL(route.request().url()).searchParams.get('event_id');
    if (!requested?.includes(EVENT_ID)) {
      throw new Error(`Unexpected My Tickets event lookup: ${requested ?? 'missing event_id'}`);
    }
    await fulfillJson(route, [event]);
  });

  await page.route('**/rest/v1/listings**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
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
    if (body?.action !== 'list-pending-sync') {
      throw new Error(
        `Unexpected purchase-operation action during My Tickets capture: ${body?.action ?? 'missing'}`,
      );
    }
    await fulfillJson(route, { operations: [] });
  });

  await page.route('**/auth/v1/user**', async (route) => {
    await fulfillJson(route, session.user);
  });

  await page.route('**/auth/v1/token**', async (route) => {
    await fulfillJson(route, session);
  });
}
