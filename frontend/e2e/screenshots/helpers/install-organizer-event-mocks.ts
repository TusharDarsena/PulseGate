import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { loadEnv } from 'vite';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';
import { installEventDetailReadyMocks } from './install-event-detail-mocks';

const EVENT_ID = 'event-seed-a-01';
const ORGANIZER_ADDRESS = 'GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP';
const USER_ID = '00000000-0000-4000-8000-000000000808';
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
 * Renders the real organizer management page while replacing account, owner,
 * and operation services with deterministic screenshot fixtures. The existing
 * event-detail fixture continues to supply the authoritative event and escrow
 * reads, so no organizer transaction is built, signed, or submitted.
 */
export async function installOrganizerEventReadyMocks(page: Page): Promise<void> {
  const environment = screenshotEnvironment();
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  const ticketContractId = environment.VITE_TICKET_CONTRACT_ID;
  if (!supabaseUrl || !ticketContractId) {
    throw new Error('VITE_SUPABASE_URL and VITE_TICKET_CONTRACT_ID are required for organizer capture.');
  }

  const browseSeed = BROWSE_READY_EVENTS.find((event) => event.event_id === EVENT_ID);
  if (!browseSeed) throw new Error(`Browse seed event not found: ${EVENT_ID}`);

  const event = {
    ...browseSeed,
    organizer_address: ORGANIZER_ADDRESS,
    ticket_contract_id: ticketContractId,
    accessibility_notes: 'Step-free entrance and accessible seating are available.',
    age_restriction: '18+ after 9 PM',
    prohibited_items: 'Outside food, professional camera rigs, and hazardous items.',
    map_url: 'https://maps.example.test/the-foundry',
    public_links: [],
    metadata_revision: 4,
    metadata_updated_at: '2026-07-27T06:45:00.000Z',
    metadata_updated_by: USER_ID,
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-27T06:45:00.000Z',
    draft_id: '00000000-0000-4000-8000-000000000807',
    publication_state: 'published',
    publication_updated_at: '2026-07-20T08:15:00.000Z',
  };
  const session = screenshotSession();

  // Reuse the already-approved public event fixture for the published-event,
  // get_event, get_escrow_balance, and global listing reads.
  await installEventDetailReadyMocks(page);

  await page.addInitScript(
    ({ authKey, authSession, organizerAddress }) => {
      localStorage.setItem(authKey, JSON.stringify(authSession));
      localStorage.setItem('stellar-tickets-store-v2', JSON.stringify({
        state: {
          organizerWallet: {
            isConnected: true,
            publicKey: organizerAddress,
            xlmBalance: '250.00',
            signFn: null,
          },
        },
        version: 0,
      }));
    },
    {
      authKey: authStorageKey(supabaseUrl),
      authSession: session,
      organizerAddress: ORGANIZER_ADDRESS,
    },
  );

  await page.route('**/functions/v1/event-publication', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string; eventId?: string } | null;
    if (body?.action !== 'get-owned-event' || body.eventId !== EVENT_ID) {
      throw new Error(`Unexpected event-publication request: ${body?.action ?? 'missing action'}`);
    }
    await fulfillJson(route, { event });
  });

  await page.route('**/functions/v1/organizer-event-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string; eventId?: string } | null;
    if (body?.action !== 'list' || body.eventId !== EVENT_ID) {
      throw new Error(`Unexpected organizer operation request: ${body?.action ?? 'missing action'}`);
    }
    await fulfillJson(route, { operations: [] });
  });

  await page.route('**/functions/v1/purchase-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action !== 'list-pending-sync') {
      throw new Error(`Unexpected purchase-operation request: ${body?.action ?? 'missing action'}`);
    }
    await fulfillJson(route, { operations: [] });
  });

  // These specific routes are registered after the broad public-event REST
  // fixture, so Playwright resolves them first.
  await page.route('**/rest/v1/rpc/get_my_attendee_wallet**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    await fulfillJson(route, []);
  });

  await page.route('**/rest/v1/rpc/get_my_tickets**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    await fulfillJson(route, []);
  });

  await page.route('**/auth/v1/user**', async (route) => {
    await fulfillJson(route, session.user);
  });

  await page.route('**/auth/v1/token**', async (route) => {
    await fulfillJson(route, session);
  });
}
