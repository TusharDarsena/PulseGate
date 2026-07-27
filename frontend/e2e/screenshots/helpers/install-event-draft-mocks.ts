import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { loadEnv } from 'vite';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';

const DRAFT_ID = 'draft-seed-a-07';
const EVENT_ID = 'event-seed-a-01';
const USER_ID = '00000000-0000-4000-8000-000000000707';
const USER_EMAIL = 'organizer@example.test';
const ORGANIZER_ADDRESS = 'GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP';
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
 * Renders one durable, editable organizer draft without exercising Freighter,
 * Soroban publication, conflict handling, or background synchronization.
 */
export async function installEventDraftReadyMocks(page: Page): Promise<void> {
  const environment = screenshotEnvironment();
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  const ticketContractId = environment.VITE_TICKET_CONTRACT_ID;
  if (!supabaseUrl || !ticketContractId) {
    throw new Error('VITE_SUPABASE_URL and VITE_TICKET_CONTRACT_ID are required for draft capture.');
  }

  const event = BROWSE_READY_EVENTS.find((candidate) => candidate.event_id === EVENT_ID);
  if (!event) throw new Error(`Browse seed event not found: ${EVENT_ID}`);

  const session = screenshotSession();
  const draft = {
    draft_id: DRAFT_ID,
    user_id: USER_ID,
    event_id: EVENT_ID,
    intended_organizer_address: ORGANIZER_ADDRESS,
    expected_name: event.name,
    expected_date_unix: event.date_unix,
    expected_capacity: event.capacity,
    expected_price_per_ticket: event.price_per_ticket,
    network: 'StellarTestnet' as const,
    ticket_contract_id: ticketContractId,
    summary: event.summary,
    description: event.description,
    image_url: event.image_url,
    category: event.category,
    timezone: event.timezone,
    end_unix: event.end_unix,
    venue: event.venue,
    address: event.address,
    city: event.city,
    organizer_display_name: event.organizer_display_name,
    support_contact: event.support_contact,
    refund_policy_code: event.refund_policy_code,
    resale_policy_code: event.resale_policy_code,
    entry_instructions: event.entry_instructions,
    accessibility_notes: 'Step-free entrance and accessible seating are available on request.',
    age_restriction: '18+ after 9:00 PM',
    prohibited_items: 'No outside alcohol or professional recording equipment.',
    map_url: 'https://www.google.com/maps/search/?api=1&query=The+Foundry+Bengaluru',
    public_links: ['https://example.test/midnight-frequency'],
    revision: 4,
    state: 'prepared' as const,
    creation_tx_hash: null,
    chain_verified_at: null,
    last_error: null,
    created_at: '2026-07-27T06:20:00.000Z',
    updated_at: '2026-07-27T06:45:00.000Z',
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

  await page.route('**/functions/v1/event-publication', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as {
      action?: string;
      draftId?: string;
    } | null;
    if (body?.action !== 'get-draft' || body.draftId !== DRAFT_ID) {
      throw new Error(
        `Unexpected event-publication request during draft capture: ${body?.action ?? 'missing'}`,
      );
    }
    await fulfillJson(route, { draft });
  });

  await page.route('**/functions/v1/purchase-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action !== 'list-pending-sync') {
      throw new Error(
        `Unexpected purchase-operation request during draft capture: ${body?.action ?? 'missing'}`,
      );
    }
    await fulfillJson(route, { operations: [] });
  });

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

  await page.route('**/rest/v1/listings**', async (route) => {
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
