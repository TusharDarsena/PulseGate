import { Buffer } from 'node:buffer';
import type { Page, Route } from '@playwright/test';
import { Keypair } from '@stellar/stellar-sdk';
import { loadEnv } from 'vite';
import { BROWSE_READY_EVENTS } from '../fixtures/browse-ready';

const EVENT_ID = 'event-seed-a-01';
const TICKET_ID = 'ticket-seed-a-01';
const OPERATION_ID = '00000000-0000-4000-8000-000000000401';
const USER_ID = '00000000-0000-4000-8000-000000000302';
const USER_EMAIL = 'attendee@example.test';
const EXPIRES_AT = 1_893_456_000;
const QR_TIMESTAMP = Math.floor(Date.parse('2026-07-27T12:00:00+05:30') / 1000);
const QR_KEYPAIR = Keypair.fromRawEd25519Seed(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
export const TIER2_ATTENDEE_ADDRESS = QR_KEYPAIR.publicKey();

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

function ticketRow() {
  return {
    ticket_id: TICKET_ID,
    event_id: EVENT_ID,
    owner_address: TIER2_ATTENDEE_ADDRESS,
    status: 'Active',
    purchased_at: '2026-07-27T07:00:00.000Z',
    receipt_operation_id: OPERATION_ID,
  };
}

function receiptOperation(ticketContractId: string) {
  const event = BROWSE_READY_EVENTS.find((candidate) => candidate.event_id === EVENT_ID);
  if (!event) throw new Error(`Browse seed event not found: ${EVENT_ID}`);
  return {
    operation: {
      operation_id: OPERATION_ID,
      user_id: USER_ID,
      request_idempotency_key: '00000000-0000-4000-8000-000000000402',
      ticket_id: TICKET_ID,
      event_id: EVENT_ID,
      attendee_wallet_address: TIER2_ATTENDEE_ADDRESS,
      expected_price_stroops: event.price_per_ticket,
      estimated_fee_stroops: 100_000,
      confirmed_fee_stroops: 100_000,
      network: 'StellarTestnet',
      ticket_contract_id: ticketContractId,
      state: 'complete',
      failure_category: null,
      failure_detail: null,
      current_attempt_number: 1,
      transaction_hash: '8'.repeat(64),
      ledger_sequence: 900_321,
      ledger_closed_at: '2026-07-27T07:00:00.000Z',
      receipt_event_name: event.name,
      receipt_event_start_unix: event.date_unix,
      receipt_event_timezone: event.timezone,
      receipt_venue: `${event.venue}, ${event.city}`,
      receipt_owner_address: TIER2_ATTENDEE_ADDRESS,
      receipt_amount_stroops: event.price_per_ticket,
      created_at: '2026-07-27T06:55:00.000Z',
      updated_at: '2026-07-27T07:00:00.000Z',
      confirmed_at: '2026-07-27T07:00:00.000Z',
    },
    attempt: null,
  };
}

function activeQrPayload(): string {
  const message = `${TIER2_ATTENDEE_ADDRESS}:${TICKET_ID}:${QR_TIMESTAMP}`;
  const signature = QR_KEYPAIR.sign(Buffer.from(message, 'utf8'));
  return `${message}:${Buffer.from(signature).toString('base64')}`;
}

async function installAuthenticatedTicketMocks(page: Page, includeQrPayload: boolean): Promise<void> {
  const environment = loadEnv('development', process.cwd(), '');
  const supabaseUrl = environment.VITE_SUPABASE_URL;
  const ticketContractId = environment.VITE_TICKET_CONTRACT_ID;
  if (!supabaseUrl || !ticketContractId) {
    throw new Error('VITE_SUPABASE_URL and VITE_TICKET_CONTRACT_ID are required for Tier 2 captures.');
  }

  const event = BROWSE_READY_EVENTS.find((candidate) => candidate.event_id === EVENT_ID);
  if (!event) throw new Error(`Browse seed event not found: ${EVENT_ID}`);
  const session = screenshotSession();
  const receipt = receiptOperation(ticketContractId);

  await page.addInitScript(
    ({ authKey, sessionValue, qrPayload }) => {
      localStorage.setItem(authKey, JSON.stringify(sessionValue));
      if (qrPayload) {
        (window as Window & { __STELLAR_TICKETS_SCREENSHOT_QR_PAYLOAD__?: string })
          .__STELLAR_TICKETS_SCREENSHOT_QR_PAYLOAD__ = qrPayload;
      }
    },
    {
      authKey: authStorageKey(supabaseUrl),
      sessionValue: session,
      qrPayload: includeQrPayload ? activeQrPayload() : null,
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
        address: TIER2_ATTENDEE_ADDRESS,
        network: 'StellarTestnet',
        readiness: 'ready',
      }]);
      return;
    }
    if (pathname.endsWith('/rest/v1/rpc/get_my_tickets')) {
      await fulfillJson(route, [ticketRow()]);
      return;
    }
    if (pathname.endsWith('/rest/v1/rpc/get_my_ticket')) {
      await fulfillJson(route, [ticketRow()]);
      return;
    }
    if (pathname.endsWith('/rest/v1/published_events')) {
      await fulfillJson(route, [event]);
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
    const body = route.request().postDataJSON() as {
      action?: string;
      operationId?: string;
    } | null;
    if (body?.action === 'list-pending-sync') {
      await fulfillJson(route, { operations: [] });
      return;
    }
    if (body?.action === 'get' && body.operationId === OPERATION_ID) {
      await fulfillJson(route, receipt);
      return;
    }
    if (body?.action === 'get-ticket-operation') {
      await fulfillJson(route, { result: receipt });
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

export async function installTicketDetailReadyMocks(page: Page): Promise<void> {
  await installAuthenticatedTicketMocks(page, false);
}

export async function installQrDisplayActiveMocks(page: Page): Promise<void> {
  await installAuthenticatedTicketMocks(page, true);
}
