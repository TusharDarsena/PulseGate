import type { Session } from '@supabase/supabase-js';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authCallback: null as ((event: string, session: Session | null) => void) | null,
  onAuthStateChange: vi.fn(),
  rpc: vi.fn(),
  setAttendeeWallet: vi.fn(),
}));

vi.mock('../lib/dfns', () => ({
  buildDelegatedSigners: vi.fn(() => ({ signFn: vi.fn(), signMessage: vi.fn() })),
  provisionDelegatedWallet: vi.fn(),
  recoverDelegatedWallet: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    rpc: mocks.rpc,
  },
}));

vi.mock('../store/useAppStore', () => ({
  EMPTY_ATTENDEE_WALLET: {
    address: null,
    network: 'StellarTestnet',
    readiness: 'signed_out',
    signFn: null,
    signMessage: null,
  },
  useAppStore: () => ({ setAttendeeWallet: mocks.setAttendeeWallet }),
}));

import { AuthProvider, useAuth } from './AuthProvider';

function session(userId: string): Session {
  return {
    access_token: `token-${userId}`,
    user: { id: userId },
  } as Session;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function AuthProbe() {
  const { loading, user, walletRestoring } = useAuth();
  return (
    <div>
      <span>{loading ? 'auth-loading' : 'auth-ready'}</span>
      <span>{walletRestoring ? 'wallet-restoring' : 'wallet-settled'}</span>
      <span>{user?.id ?? 'signed-out'}</span>
    </div>
  );
}

describe('attendee wallet restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authCallback = null;
    mocks.onAuthStateChange.mockImplementation((
      callback: (event: string, session: Session | null) => void,
    ) => {
      mocks.authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
  });

  it('keeps attendee routes waiting until wallet restoration settles', async () => {
    const walletResult = deferred<{
      data: Array<{ address: string; network: string; readiness: string }>;
      error: null;
    }>();
    mocks.rpc.mockReturnValueOnce(walletResult.promise);
    render(<AuthProvider><AuthProbe /></AuthProvider>);

    act(() => mocks.authCallback?.('INITIAL_SESSION', session('user-a')));

    expect(screen.getByText('auth-ready')).toBeInTheDocument();
    expect(screen.getByText('wallet-restoring')).toBeInTheDocument();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('get_my_attendee_wallet'));

    await act(async () => {
      walletResult.resolve({
        data: [{ address: 'GATTENDEE', network: 'StellarTestnet', readiness: 'ready' }],
        error: null,
      });
    });

    expect(screen.getByText('wallet-settled')).toBeInTheDocument();
    expect(mocks.setAttendeeWallet).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: 'GATTENDEE', readiness: 'ready' }),
    );
  });

  it('ignores an older wallet result after sign-out', async () => {
    const walletResult = deferred<{
      data: Array<{ address: string; network: string; readiness: string }>;
      error: null;
    }>();
    mocks.rpc.mockReturnValueOnce(walletResult.promise);
    render(<AuthProvider><AuthProbe /></AuthProvider>);

    act(() => mocks.authCallback?.('SIGNED_IN', session('user-a')));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
    act(() => mocks.authCallback?.('SIGNED_OUT', null));

    expect(screen.getByText('signed-out')).toBeInTheDocument();
    expect(screen.getByText('wallet-settled')).toBeInTheDocument();

    await act(async () => {
      walletResult.resolve({
        data: [{ address: 'GSTALE', network: 'StellarTestnet', readiness: 'ready' }],
        error: null,
      });
    });

    expect(mocks.setAttendeeWallet).toHaveBeenLastCalledWith(
      expect.objectContaining({ readiness: 'signed_out' }),
    );
  });
});
