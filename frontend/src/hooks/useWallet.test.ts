import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrganizerSignFn, verifyFreighterOrganizerAddress } from './useWallet';

const mocks = vi.hoisted(() => ({
  fetchXlmBalance: vi.fn(),
  getAddress: vi.fn(),
  isConnected: vi.fn(),
  signTransaction: vi.fn(),
}));

vi.mock('../lib/stellar', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/stellar')>(),
  fetchXlmBalance: mocks.fetchXlmBalance,
}));

vi.mock('@stellar/freighter-api', () => ({
  getAddress: mocks.getAddress,
  isConnected: mocks.isConnected,
  requestAccess: vi.fn(),
  signTransaction: mocks.signTransaction,
}));

const ORGANIZER = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

describe('verified organizer Freighter access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConnected.mockResolvedValue({ isConnected: true });
    mocks.getAddress.mockResolvedValue({ address: ORGANIZER });
    mocks.fetchXlmBalance.mockResolvedValue({ exists: true, balanceStroops: 100_000_000n });
  });

  it('checks Freighter connectivity and its current address before returning organizer capability', async () => {
    await expect(verifyFreighterOrganizerAddress(ORGANIZER)).resolves.toBe(ORGANIZER);
    expect(mocks.isConnected).toHaveBeenCalledTimes(1);
    expect(mocks.getAddress).toHaveBeenCalledTimes(1);
  });

  it('rechecks the selected Freighter address immediately before signing', async () => {
    mocks.signTransaction.mockResolvedValue({ signedTxXdr: 'signed-xdr' });
    const signer = createOrganizerSignFn(ORGANIZER);

    await expect(signer('unsigned-xdr')).resolves.toEqual({
      signedTxXdr: 'signed-xdr',
      signerAddress: ORGANIZER,
    });
    expect(mocks.isConnected).toHaveBeenCalledTimes(1);
    expect(mocks.getAddress).toHaveBeenCalledTimes(1);
    expect(mocks.signTransaction).toHaveBeenCalledWith('unsigned-xdr', {
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });
});
