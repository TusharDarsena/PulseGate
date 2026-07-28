import {
  isConnected as isFreighterConnected,
  requestAccess as requestFreighterAccess,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';
import { useCallback } from 'react';
import { fetchXlmBalance, formatStroops } from '../lib/stellar';
import { EMPTY_ORGANIZER_WALLET, useAppStore } from '../store/useAppStore';
import type { OrganizerWalletState, SignFn } from '../types';

export function useWallet() {
  const { setOrganizerWallet } = useAppStore();

  const connectOrganizer = useCallback(async (): Promise<OrganizerWalletState> => {
    try {
      const connected = await isFreighterConnected();
      if (!connected.isConnected) throw new Error('Freighter is not installed or connected.');
      const access = await requestFreighterAccess();
      if (access.error) throw new Error(access.error);
      const publicKey = access.address;
      const signFn: SignFn = async (xdr, opts) => {
        const networkPassphrase =
          opts?.networkPassphrase || 'Test SDF Network ; September 2015';
        const result = await freighterSignTransaction(xdr, { networkPassphrase });
        if (result.error) throw new Error(result.error);
        return { signedTxXdr: result.signedTxXdr, signerAddress: publicKey };
      };
      const balance = await fetchXlmBalance(publicKey);
      const organizerWallet: OrganizerWalletState = {
        isConnected: true,
        publicKey,
        xlmBalance: formatStroops(balance.balanceStroops),
        signFn,
      };
      setOrganizerWallet(organizerWallet);
      return organizerWallet;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Freighter connection failed.';
      setOrganizerWallet({ ...EMPTY_ORGANIZER_WALLET, errorMessage: message });
      throw error;
    }
  }, [setOrganizerWallet]);

  const disconnectOrganizer = useCallback(() => {
    setOrganizerWallet(EMPTY_ORGANIZER_WALLET);
  }, [setOrganizerWallet]);

  return { connectOrganizer, disconnectOrganizer };
}
