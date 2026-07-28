import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AttendeeWalletState, OrganizerWalletState, TxState } from '../types';

interface AppState {
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
        // This address is an untrusted hint only. Freighter must be checked
        // before it becomes a connected signer again.
        organizerWallet: {
          isConnected: false,
          publicKey: state.organizerWallet.publicKey,
          xlmBalance: null,
          signFn: null,
        },
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.setOrganizerWallet({
          ...EMPTY_ORGANIZER_WALLET,
          publicKey: state.organizerWallet.publicKey,
        });
      },
    },
  ),
);
