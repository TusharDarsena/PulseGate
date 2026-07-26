import {
  Asset,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from 'npm:@stellar/stellar-sdk@16.1.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server configuration is missing ${name}.`);
  return value;
}

function xlmToStroops(value: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) throw new Error('Invalid Stellar balance.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
}

interface AccountState {
  exists: boolean;
  balanceStroops: bigint;
}

async function readAccount(address: string): Promise<AccountState> {
  const response = await fetch(`${required('STELLAR_HORIZON_URL')}/accounts/${address}`);
  if (response.status === 404) return { exists: false, balanceStroops: 0n };
  if (!response.ok) throw new Error(`Horizon account lookup failed (${response.status}).`);
  const account = await response.json() as {
    balances: Array<{ asset_type: string; balance: string }>;
  };
  const native = account.balances.find((balance) => balance.asset_type === 'native');
  return {
    exists: true,
    balanceStroops: native ? xlmToStroops(native.balance) : 0n,
  };
}

async function waitForBalance(address: string, previous: bigint) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const account = await readAccount(address);
    if (account.exists && account.balanceStroops > previous) return account;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error('The funding transaction was submitted but the new balance is not visible yet.');
}

async function activate(address: string) {
  const friendbot = new URL(required('STELLAR_FRIENDBOT_URL'));
  friendbot.searchParams.set('addr', address);
  const response = await fetch(friendbot);
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.detail === 'string'
        ? payload.detail
        : `Friendbot activation failed (${response.status}).`,
    );
  }
  return typeof payload.hash === 'string' ? payload.hash : null;
}

async function topUp(address: string) {
  const server = new Horizon.Server(required('STELLAR_HORIZON_URL'));
  const source = Keypair.fromSecret(required('TESTNET_TOPUP_SECRET'));
  const sourceAccount = await server.loadAccount(source.publicKey());
  const fee = await server.fetchBaseFee();
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: String(fee),
    networkPassphrase: required('STELLAR_NETWORK_PASSPHRASE'),
  })
    .addOperation(Operation.payment({
      destination: address,
      asset: Asset.native(),
      amount: required('TESTNET_TOPUP_AMOUNT_XLM'),
    }))
    .setTimeout(30)
    .build();
  transaction.sign(source);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let requestId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;
  try {
    if (required('STELLAR_NETWORK') !== 'StellarTestnet') {
      throw new Error('Test funding is available only on Stellar Testnet.');
    }
    const supabaseUrl = required('SUPABASE_URL');
    const authHeader = request.headers.get('Authorization') ?? '';
    const authClient = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return json({ error: 'Authentication required.' }, 401);

    admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'));
    const { data: wallet, error: walletError } = await admin
      .from('attendee_wallets')
      .select('address,network,readiness')
      .eq('user_id', user.id)
      .single();
    if (
      walletError ||
      !wallet?.address ||
      wallet.readiness !== 'ready' ||
      wallet.network !== 'StellarTestnet'
    ) {
      throw new Error('The recorded attendee wallet is not ready for test funding.');
    }

    const before = await readAccount(wallet.address);
    const kind = before.exists ? 'top_up' : 'activation';
    const windowStart = new Date(
      Date.now() - (kind === 'top_up' ? 60 * 60_000 : 24 * 60 * 60_000),
    ).toISOString();
    const { count, error: countError } = await admin
      .from('test_funding_requests')
      .select('request_id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('kind', kind)
      .in('status', ['started', 'confirmed'])
      .gte('created_at', windowStart);
    if (countError) throw countError;
    if ((count ?? 0) > 0) {
      return json({
        error: kind === 'activation'
          ? 'Testnet activation was already requested recently.'
          : 'A testnet top-up was already requested in the last hour.',
        code: 'rate_limited',
      }, 429);
    }

    const { data: fundingRequest, error: insertError } = await admin
      .from('test_funding_requests')
      .insert({
        user_id: user.id,
        wallet_address: wallet.address,
        kind,
        status: 'started',
      })
      .select('request_id')
      .single();
    if (insertError || !fundingRequest) throw insertError ?? new Error('Funding request failed.');
    requestId = fundingRequest.request_id;

    const providerReference = before.exists
      ? await topUp(wallet.address)
      : await activate(wallet.address);
    const confirmed = await waitForBalance(wallet.address, before.balanceStroops);
    await admin.from('test_funding_requests').update({
      status: 'confirmed',
      provider_reference: providerReference,
      completed_at: new Date().toISOString(),
    }).eq('request_id', requestId);

    return json({
      status: 'confirmed',
      kind,
      exists: confirmed.exists,
      balanceStroops: confirmed.balanceStroops.toString(),
    });
  } catch (error) {
    if (admin && requestId) {
      await admin.from('test_funding_requests').update({
        status: 'failed',
        failure_detail: (error instanceof Error ? error.message : 'Funding failed.').slice(0, 1000),
        completed_at: new Date().toISOString(),
      }).eq('request_id', requestId);
    }
    console.error('[test-funding]', error instanceof Error ? error.message : error);
    return json({
      error: error instanceof Error ? error.message : 'Test funding failed.',
    }, 400);
  }
});
