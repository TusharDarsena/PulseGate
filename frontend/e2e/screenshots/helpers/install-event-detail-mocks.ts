import { Buffer } from 'node:buffer';
import type { Page, Request, Route } from '@playwright/test';
import { loadEnv } from 'vite';
import {
  Client as TicketClient,
  Keypair,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from 'ticket';
import { BROWSE_READY_EVENTS, type DiscoverableEventFixture } from '../fixtures/browse-ready';

const EVENT_ID = 'event-seed-a-01';
const READ_ONLY_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const LATEST_LEDGER = 900_000;

const jsonHeaders = {
  'access-control-allow-headers': 'authorization, apikey, content-profile, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-origin': '*',
  'content-profile': 'public',
  'content-type': 'application/json; charset=utf-8',
};

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

function screenshotEnvironment(): Record<string, string> {
  return loadEnv('development', process.cwd(), '');
}

function eventDetailFixture(): DiscoverableEventFixture {
  const environment = screenshotEnvironment();
  const ticketContractId = environment.VITE_TICKET_CONTRACT_ID;
  if (!ticketContractId) {
    throw new Error('VITE_TICKET_CONTRACT_ID is required for the event-detail screenshot fixture.');
  }

  const browseSeed = BROWSE_READY_EVENTS.find((event) => event.event_id === EVENT_ID);
  if (!browseSeed) throw new Error(`Browse seed event not found: ${EVENT_ID}`);

  return {
    ...browseSeed,
    // The authoritative Event value must contain a checksum-valid Stellar address
    // so the generated binding can encode it as XDR. All visible event content is
    // still reused from the Browse seed.
    organizer_address: READ_ONLY_KEY,
    ticket_contract_id: ticketContractId,
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    headers: jsonHeaders,
    body: status === 204 ? '' : JSON.stringify(body),
  });
}

function parseJsonRpcRequest(request: Request): JsonRpcRequest {
  const postData = request.postData();
  if (!postData) throw new Error('Soroban RPC request did not contain a JSON body.');
  const parsed = JSON.parse(postData) as Partial<JsonRpcRequest>;
  if (parsed.jsonrpc !== '2.0' || parsed.id === undefined || !parsed.method) {
    throw new Error(`Unexpected Soroban RPC request: ${postData}`);
  }
  return parsed as JsonRpcRequest;
}

function accountLedgerEntryData(): string {
  const account = new xdr.AccountEntry({
    accountId: Keypair.fromPublicKey(READ_ONLY_KEY).xdrAccountId(),
    balance: xdr.Int64.fromString('1000000000'),
    seqNum: xdr.SequenceNumber.fromString('1'),
    numSubEntries: 0,
    inflationDest: null,
    flags: 0,
    homeDomain: Buffer.alloc(0),
    thresholds: Buffer.from([1, 0, 0, 0]),
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  });
  return xdr.LedgerEntryData.account(account).toXDR('base64');
}

function invokedMethod(transactionXdr: unknown): string {
  if (typeof transactionXdr !== 'string') {
    throw new Error('Soroban simulation request is missing transaction XDR.');
  }
  const transaction = TransactionBuilder.fromXDR(transactionXdr, NETWORK_PASSPHRASE);
  const operation = transaction.operations[0] as unknown as {
    func?: { value?: () => xdr.InvokeContractArgs };
  };
  const invokeArgs = operation.func?.value?.();
  if (!invokeArgs) throw new Error('Expected an invoke-contract operation in screenshot RPC fixture.');
  return invokeArgs.functionName().toString();
}

function successfulReturnValue(
  ticketClient: TicketClient,
  method: 'get_event' | 'get_escrow_balance',
  event: DiscoverableEventFixture,
): string {
  const output = ticketClient.spec.getFunc(method).outputs()[0];
  const okType = output.result().okType();
  const native = method === 'get_event'
    ? {
        capacity: BigInt(event.capacity),
        current_supply: BigInt(event.current_supply),
        date_unix: BigInt(event.date_unix),
        end_unix: BigInt(event.end_unix),
        name: event.name,
        organizer: event.organizer_address,
        price_per_ticket: BigInt(event.price_per_ticket),
        status: { tag: event.status },
      }
    : BigInt(event.current_supply) * BigInt(event.price_per_ticket);

  return ticketClient.spec.nativeToScVal(native, okType).toXDR('base64');
}

function rpcResult(
  rpcRequest: JsonRpcRequest,
  event: DiscoverableEventFixture,
  ticketClient: TicketClient,
): unknown {
  if (rpcRequest.method === 'getLedgerEntries') {
    const keys = rpcRequest.params?.keys;
    if (!Array.isArray(keys) || keys.length !== 1 || typeof keys[0] !== 'string') {
      throw new Error('getLedgerEntries screenshot fixture expected one account key.');
    }
    return {
      latestLedger: LATEST_LEDGER,
      entries: [{
        key: keys[0],
        xdr: accountLedgerEntryData(),
        lastModifiedLedgerSeq: LATEST_LEDGER - 1,
      }],
    };
  }

  if (rpcRequest.method === 'simulateTransaction') {
    const method = invokedMethod(rpcRequest.params?.transaction);
    if (method !== 'get_event' && method !== 'get_escrow_balance') {
      throw new Error(`Unexpected simulated contract method: ${method}`);
    }
    return {
      latestLedger: LATEST_LEDGER,
      minResourceFee: '0',
      transactionData: new SorobanDataBuilder().build().toXDR('base64'),
      results: [{
        auth: [],
        xdr: successfulReturnValue(ticketClient, method, event),
      }],
      events: [],
    };
  }

  throw new Error(`Unexpected Soroban RPC method: ${rpcRequest.method}`);
}

/**
 * Keeps the public Event detail capture deterministic while preserving the real
 * published-event -> authoritative Soroban read path used by the application.
 */
export async function installEventDetailReadyMocks(page: Page): Promise<void> {
  const environment = screenshotEnvironment();
  const rpcUrl = environment.VITE_RPC_URL;
  const ticketContractId = environment.VITE_TICKET_CONTRACT_ID;
  if (!rpcUrl || !ticketContractId) {
    throw new Error('VITE_RPC_URL and VITE_TICKET_CONTRACT_ID are required for screenshot capture.');
  }

  const event = eventDetailFixture();
  const ticketClient = new TicketClient({
    contractId: ticketContractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: READ_ONLY_KEY,
    rpcUrl,
  });

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (request.method() === 'OPTIONS') {
      await fulfillJson(route, null, 204);
      return;
    }
    if (url.pathname.endsWith('/rest/v1/published_events')) {
      const requestedEvent = url.searchParams.get('event_id');
      if (requestedEvent !== `eq.${EVENT_ID}`) {
        throw new Error(`Unexpected published event lookup: ${requestedEvent ?? 'missing event_id'}`);
      }
      await fulfillJson(route, event);
      return;
    }
    if (url.pathname.endsWith('/rest/v1/listings')) {
      await fulfillJson(route, []);
      return;
    }

    throw new Error(`Unexpected Supabase REST request: ${request.method()} ${url.pathname}`);
  });

  await page.route(
    (url) => url.toString().startsWith(rpcUrl),
    async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await fulfillJson(route, null, 204);
        return;
      }
      const rpcRequest = parseJsonRpcRequest(route.request());
      await fulfillJson(route, {
        jsonrpc: '2.0',
        id: rpcRequest.id,
        result: rpcResult(rpcRequest, event, ticketClient),
      });
    },
  );
}
