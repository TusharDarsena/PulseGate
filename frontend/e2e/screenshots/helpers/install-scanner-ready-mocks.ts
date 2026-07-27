import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { loadEnv } from 'vite';
import { installEventDetailReadyMocks } from './install-event-detail-mocks';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';

const EVENT_ID = 'event-seed-a-01';
const ORGANIZER_ADDRESS = 'GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP';
const USER_ID = '00000000-0000-4000-8000-000000000602';
const USER_EMAIL = 'organizer@example.test';
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
 * Opens the real ScannerPage in its stable pre-camera state. The fixture proves
 * signed-in ownership, matching organizer wallet, authoritative event status,
 * door-window eligibility, and useful check-in statistics without touching a
 * camera, QR payload, passkey, Soroban write, or synchronization operation.
 */
export async function installScannerReadyMocks(page: Page): Promise<void> {
  const environment = screenshotEnvironment();
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  const ticketContractId = environment.VITE_TICKET_CONTRACT_ID;
  if (!supabaseUrl || !ticketContractId) {
    throw new Error('VITE_SUPABASE_URL and VITE_TICKET_CONTRACT_ID are required for Scanner capture.');
  }

  const seedEvent = BROWSE_READY_EVENTS.find((candidate) => candidate.event_id === EVENT_ID);
  if (!seedEvent) throw new Error(`Browse seed event not found: ${EVENT_ID}`);

  // Reuse the existing deterministic published-event and Soroban read fixture.
  await installEventDetailReadyMocks(page);

  const session = screenshotSession();
  const ownedEvent = {
    ...seedEvent,
    organizer_address: ORGANIZER_ADDRESS,
    ticket_contract_id: ticketContractId,
    draft_id: '00000000-0000-4000-8000-000000000603',
    publication_state: 'published',
    publication_updated_at: '2026-07-27T06:30:00.000Z',
  };

  await page.addInitScript(
    ({ authKey, sessionValue, organizerAddress }) => {
      localStorage.setItem(authKey, JSON.stringify(sessionValue));
      localStorage.setItem('stellar-tickets-store-v2', JSON.stringify({
        state: {
          organizerWallet: {
            isConnected: true,
            publicKey: organizerAddress,
            xlmBalance: '50.00',
            signFn: null,
          },
        },
        version: 0,
      }));
    },
    {
      authKey: authStorageKey(supabaseUrl),
      sessionValue: session,
      organizerAddress: ORGANIZER_ADDRESS,
    },
  );

  await page.route('**/rest/v1/rpc/get_my_attendee_wallet**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    await fulfillJson(route, [{
      address: ORGANIZER_ADDRESS,
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

  await page.route('**/functions/v1/purchase-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action !== 'list-pending-sync') {
      throw new Error(
        `Unexpected purchase-operation action during Scanner capture: ${body?.action ?? 'missing'}`,
      );
    }
    await fulfillJson(route, { operations: [] });
  });

  await page.route('**/functions/v1/event-publication', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string; eventId?: string } | null;
    if (body?.action !== 'get-owned-event' || body.eventId !== EVENT_ID) {
      throw new Error(
        `Unexpected event-publication request during Scanner capture: ${JSON.stringify(body)}`,
      );
    }
    await fulfillJson(route, { event: ownedEvent });
  });

  await page.route('**/functions/v1/check-in-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string; eventId?: string } | null;
    if (body?.eventId !== EVENT_ID) {
      throw new Error(`Unexpected Scanner event ID: ${body?.eventId ?? 'missing'}`);
    }
    if (body.action === 'list') {
      await fulfillJson(route, { operations: [] });
      return;
    }
    if (body.action === 'stats') {
      await fulfillJson(route, {
        stats: {
          sold: seedEvent.current_supply,
          checkedIn: 37,
          remaining: seedEvent.current_supply - 37,
          unresolved: 0,
        },
      });
      return;
    }
    throw new Error(`Unexpected check-in action during Scanner capture: ${body?.action ?? 'missing'}`);
  });

  await page.route('**/auth/v1/user**', async (route) => {
    await fulfillJson(route, session.user);
  });

  await page.route('**/auth/v1/token**', async (route) => {
    await fulfillJson(route, session);
  });
}
