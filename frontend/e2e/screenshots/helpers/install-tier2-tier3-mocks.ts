import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { loadEnv } from 'vite';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';

const USER_ID = '00000000-0000-4000-8000-000000000820';
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

async function installGuestShellMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await page.route('**/rest/v1/listings**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    await fulfillJson(route, []);
  });

  await page.route('**/auth/v1/user**', async (route) => {
    await fulfillJson(route, { message: 'No active screenshot session.' }, 401);
  });
}

async function installAuthenticatedShellMocks(page: Page): Promise<ReturnType<typeof screenshotSession>> {
  const environment = screenshotEnvironment();
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('VITE_SUPABASE_URL is required for authenticated screenshot capture.');
  }

  const session = screenshotSession();
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

  await page.route('**/functions/v1/purchase-operation', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action !== 'list-pending-sync') {
      throw new Error(
        `Unexpected purchase-operation request during organizer capture: ${body?.action ?? 'missing'}`,
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

  return session;
}

function dashboardDrafts(ticketContractId: string) {
  const eventOne = BROWSE_READY_EVENTS[0];
  const eventThree = BROWSE_READY_EVENTS[2];
  return [
    {
      draft_id: 'draft-seed-a-dashboard-01',
      user_id: USER_ID,
      event_id: eventThree.event_id,
      intended_organizer_address: ORGANIZER_ADDRESS,
      expected_name: eventThree.name,
      expected_date_unix: eventThree.date_unix,
      expected_capacity: eventThree.capacity,
      expected_price_per_ticket: eventThree.price_per_ticket,
      network: 'StellarTestnet',
      ticket_contract_id: ticketContractId,
      summary: eventThree.summary,
      description: eventThree.description,
      image_url: eventThree.image_url,
      category: eventThree.category,
      timezone: eventThree.timezone,
      end_unix: eventThree.end_unix,
      venue: eventThree.venue,
      address: eventThree.address,
      city: eventThree.city,
      organizer_display_name: eventThree.organizer_display_name,
      support_contact: eventThree.support_contact,
      refund_policy_code: eventThree.refund_policy_code,
      resale_policy_code: eventThree.resale_policy_code,
      entry_instructions: eventThree.entry_instructions,
      accessibility_notes: null,
      age_restriction: null,
      prohibited_items: null,
      map_url: null,
      public_links: [],
      revision: 3,
      state: 'prepared',
      creation_tx_hash: null,
      chain_verified_at: null,
      last_error: null,
      created_at: '2026-07-26T09:00:00.000Z',
      updated_at: '2026-07-27T06:40:00.000Z',
    },
    {
      draft_id: 'draft-seed-a-dashboard-02',
      user_id: USER_ID,
      event_id: 'event-seed-a-dashboard-new',
      intended_organizer_address: null,
      expected_name: 'Rooftop Film Sessions',
      expected_date_unix: null,
      expected_capacity: null,
      expected_price_per_ticket: null,
      network: 'StellarTestnet',
      ticket_contract_id: ticketContractId,
      summary: 'An early private draft for an outdoor film series.',
      description: null,
      image_url: null,
      category: 'Festivals',
      timezone: 'Asia/Kolkata',
      end_unix: null,
      venue: null,
      address: null,
      city: 'Bengaluru',
      organizer_display_name: eventOne.organizer_display_name,
      support_contact: eventOne.support_contact,
      refund_policy_code: eventOne.refund_policy_code,
      resale_policy_code: eventOne.resale_policy_code,
      entry_instructions: null,
      accessibility_notes: null,
      age_restriction: null,
      prohibited_items: null,
      map_url: null,
      public_links: [],
      revision: 1,
      state: 'prepared',
      creation_tx_hash: null,
      chain_verified_at: null,
      last_error: null,
      created_at: '2026-07-27T05:30:00.000Z',
      updated_at: '2026-07-27T06:20:00.000Z',
    },
  ];
}

function dashboardEvents() {
  return BROWSE_READY_EVENTS.slice(0, 2).map((event, index) => ({
    ...event,
    organizer_address: ORGANIZER_ADDRESS,
    draft_id: `published-draft-seed-a-0${index + 1}`,
    publication_state: 'published',
    publication_updated_at: '2026-07-27T06:30:00.000Z',
  }));
}

/** Populates both organizer dashboard sections without Freighter or Soroban. */
export async function installOrganizerDashboardPopulatedMocks(page: Page): Promise<void> {
  const environment = screenshotEnvironment();
  const ticketContractId = environment.VITE_TICKET_CONTRACT_ID;
  if (!ticketContractId) {
    throw new Error('VITE_TICKET_CONTRACT_ID is required for organizer dashboard capture.');
  }

  await installAuthenticatedShellMocks(page);
  const drafts = dashboardDrafts(ticketContractId);
  const events = dashboardEvents();

  await page.route('**/functions/v1/event-publication', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action === 'list-drafts') {
      await fulfillJson(route, { drafts });
      return;
    }
    if (body?.action === 'list-owned-events') {
      await fulfillJson(route, { events });
      return;
    }
    throw new Error(
      `Unexpected event-publication request during dashboard capture: ${body?.action ?? 'missing'}`,
    );
  });
}

/** Leaves the real create-draft request pending so the transition UI remains visible. */
export async function installCreateEventPreparingMocks(page: Page): Promise<void> {
  await installAuthenticatedShellMocks(page);

  await page.route('**/functions/v1/event-publication', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    const body = route.request().postDataJSON() as { action?: string } | null;
    if (body?.action !== 'create-draft') {
      throw new Error(
        `Unexpected event-publication request during create-event capture: ${body?.action ?? 'missing'}`,
      );
    }
    // Deliberately do not continue, abort, or fulfill. The screenshot captures
    // the truthful in-progress route before a private draft is created.
  });
}

export async function installAuthDefaultMocks(page: Page): Promise<void> {
  await installGuestShellMocks(page);
}

export async function installNotFoundMocks(page: Page): Promise<void> {
  await installGuestShellMocks(page);
}
