import { HORIZON_URL } from './constants';

export interface StellarAccountBalance {
  exists: boolean;
  balanceStroops: bigint;
}

export function formatStroops(stroops: bigint, minimumFractionDigits = 2): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / 10_000_000n;
  const rawFraction = (absolute % 10_000_000n).toString().padStart(7, '0');
  const fraction = rawFraction
    .replace(/0+$/, '')
    .padEnd(minimumFractionDigits, '0');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function parseXlmToStroops(value: string): bigint {
  if (!/^\d+(?:\.\d{1,7})?$/.test(value)) {
    throw new Error('Horizon returned an invalid XLM balance.');
  }
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
}

/**
 * Read exact public account state. Funding remains an explicit authenticated
 * service action; this adapter only reads Horizon.
 */
export async function fetchXlmBalance(publicKey: string): Promise<StellarAccountBalance> {
  const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (response.status === 404) return { exists: false, balanceStroops: 0n };
  if (!response.ok) throw new Error(`Horizon balance lookup failed (${response.status}).`);
  const data = await response.json() as {
    balances: Array<{ asset_type: string; balance: string }>;
  };
  const native = data.balances.find((balance) => balance.asset_type === 'native');
  return {
    exists: true,
    balanceStroops: native ? parseXlmToStroops(native.balance) : 0n,
  };
}
