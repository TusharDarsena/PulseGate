import { signTransaction as freighterSignTransaction } from '@stellar/freighter-api';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AttendeeWalletState, OrganizerWalletState, SignFn, TxState } from '../types';

interface AppState {
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  txState: TxState;
  setTxState: (state: TxState) => void;
  attendeeWallet: AttendeeWalletState;
  setAttendeeWallet: (state: AttendeeWalletState) => void;
  organizerWallet: OrganizerWalletState;
  setOrganizerWallet: (state: OrganizerWalletState) => void;
}

export const EMPTY_ATTENDEE_WALLET: AttendeeWalletState = {
  address: null,
  network: 'StellarTestnet',
  readiness: 'signed_out',
  signFn: null,
  signMessage: null,
};

export const EMPTY_ORGANIZER_WALLET: OrganizerWalletState = {
  isConnected: false,
  publicKey: null,
  xlmBalance: null,
  signFn: null,
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      _hasHydrated: false,
      setHasHydrated: (state) => set({ _hasHydrated: state }),
      txState: { status: 'idle' },
      setTxState: (state) => set({ txState: state }),
      attendeeWallet: EMPTY_ATTENDEE_WALLET,
      setAttendeeWallet: (state) => set({ attendeeWallet: state }),
      organizerWallet: EMPTY_ORGANIZER_WALLET,
      setOrganizerWallet: (state) => set({ organizerWallet: state }),
    }),
    {
      name: 'stellar-tickets-store-v2',
      partialize: (state) => ({
        organizerWallet: { ...state.organizerWallet, signFn: null },
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.setHasHydrated(true);
        const { organizerWallet } = state;
        if (!organizerWallet.isConnected) return;

        const signFn: SignFn = async (xdr, opts) => {
          const networkPassphrase =
            opts?.networkPassphrase || 'Test SDF Network ; September 2015';
          const result = await freighterSignTransaction(xdr, { networkPassphrase });
          if (result.error) throw new Error(result.error);
          return { signedTxXdr: result.signedTxXdr };
        };
        state.setOrganizerWallet({ ...organizerWallet, signFn });
      },
    },
  ),
);
