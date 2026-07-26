import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./constants', () => ({
  HORIZON_URL: 'https://horizon.example',
}));

import { fetchXlmBalance, formatStroops } from './stellar';

describe('exact Stellar account balance', () => {
  afterEach(() => vi.restoreAllMocks());

  it('distinguishes a missing account from an activated zero balance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }));
    await expect(fetchXlmBalance('GACCOUNT')).resolves.toEqual({
      exists: false,
      balanceStroops: 0n,
    });
  });

  it('preserves all seven stroop digits from Horizon', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        balances: [{ asset_type: 'native', balance: '12.3456789' }],
      }),
    }));
    await expect(fetchXlmBalance('GACCOUNT')).resolves.toEqual({
      exists: true,
      balanceStroops: 123_456_789n,
    });
  });

  it('formats exact purchase amounts without floating-point arithmetic', () => {
    expect(formatStroops(123_456_789n)).toBe('12.3456789');
    expect(formatStroops(10_000_000n)).toBe('1.00');
    expect(formatStroops(1n)).toBe('0.0000001');
  });
});
