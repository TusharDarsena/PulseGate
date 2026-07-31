import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  provisionWallet: vi.fn(),
  wallet: {
    address: null,
    network: 'StellarTestnet',
    readiness: 'provisioning',
    signFn: null,
    signMessage: null,
  },
}));

vi.mock('./auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'attendee-1' },
    loading: false,
    walletRestoring: false,
    provisionWallet: mocks.provisionWallet,
  }),
}));

vi.mock('./store/useAppStore', () => ({
  useAppStore: (selector: (state: { attendeeWallet: typeof mocks.wallet }) => unknown) =>
    selector({ attendeeWallet: mocks.wallet }),
}));

vi.mock('./lib/authIntent', () => ({
  saveAuthIntent: vi.fn(),
}));

import { RequireAuth } from './App';

describe('attendee wallet gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.provisionWallet.mockResolvedValue('recovery-code');
    mocks.wallet.readiness = 'provisioning';
  });

  it('lets a stuck provisioning state retry wallet setup', async () => {
    render(
      <MemoryRouter>
        <RequireAuth action="open_checkout" attendeeWallet>
          <div>Checkout</div>
        </RequireAuth>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry wallet setup' }));

    await waitFor(() => expect(mocks.provisionWallet).toHaveBeenCalledOnce());
  });

  it('shows a retry failure instead of silently leaving the wallet stuck', async () => {
    mocks.provisionWallet.mockRejectedValueOnce(new Error('Dfns service account is missing Auth:Users:Read.'));
    render(
      <MemoryRouter>
        <RequireAuth action="open_checkout" attendeeWallet>
          <div>Checkout</div>
        </RequireAuth>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry wallet setup' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Dfns service account is missing Auth:Users:Read.',
    );
  });
});
