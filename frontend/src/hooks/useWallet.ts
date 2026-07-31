import {
  getAddress as getFreighterAddress,
  isConnected as isFreighterConnected,
  requestAccess as requestFreighterAccess,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';
import { useCallback, useEffect } from 'react';
import { fetchXlmBalance, formatStroops } from '../lib/stellar';
import { EMPTY_ORGANIZER_WALLET, useAppStore } from '../store/useAppStore';
import type { OrganizerWalletState, SignFn } from '../types';

let organizerRestoration: Promise<OrganizerWalletState | null> | null = null;

export function useWallet() {
  const { setOrganizerWallet } = useAppStore();

  const verifyOrganizer = useCallback(async (expectedAddress: string): Promise<OrganizerWalletState> => {
    const address = await verifyFreighterOrganizerAddress(expectedAddress);
    const balance = await fetchXlmBalance(address);
    const organizerWallet: OrganizerWalletState = {
      isConnected: true,
      publicKey: address,
      accountExists: balance.exists,
      xlmBalance: formatStroops(balance.balanceStroops),
      signFn: createOrganizerSignFn(address),
    };
    setOrganizerWallet(organizerWallet);
    return organizerWallet;
  }, [setOrganizerWallet]);

  const restoreOrganizer = useCallback(async () => {
    const hint = useAppStore.getState().organizerWallet.publicKey;
    if (!hint || useAppStore.getState().organizerWallet.isConnected) return null;
    if (!organizerRestoration) {
      organizerRestoration = (async () => {
        try {
          const address = await verifyFreighterOrganizerAddress(hint);
          const balance = await fetchXlmBalance(address);
          const restored = {
            isConnected: true,
            publicKey: address,
            accountExists: balance.exists,
            xlmBalance: formatStroops(balance.balanceStroops),
            signFn: createOrganizerSignFn(address),
          };
          setOrganizerWallet(restored);
          return restored;
        } catch {
          // Preserve the prior address as a disconnected, untrusted hint.
          setOrganizerWallet({ ...EMPTY_ORGANIZER_WALLET, publicKey: hint });
          return null;
        }
      })();
    }
    return organizerRestoration;
  }, [setOrganizerWallet]);

  useEffect(() => {
    void restoreOrganizer();
  }, [restoreOrganizer]);

  const connectOrganizer = useCallback(async (): Promise<OrganizerWalletState> => {
    try {
      const connected = await isFreighterConnected();
      if (!connected.isConnected) throw new Error('Freighter is not installed or connected.');
      const access = await requestFreighterAccess();
      if (access.error) throw new Error(access.error);
      const address = await verifyFreighterOrganizerAddress(access.address);
      const balance = await fetchXlmBalance(address);
      const connectedWallet: OrganizerWalletState = {
        isConnected: true,
        publicKey: address,
        accountExists: balance.exists,
        xlmBalance: formatStroops(balance.balanceStroops),
        signFn: createOrganizerSignFn(address),
      };
      setOrganizerWallet(connectedWallet);
      return connectedWallet;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Freighter connection failed.';
      setOrganizerWallet({ ...EMPTY_ORGANIZER_WALLET, errorMessage: message });
      throw error;
    }
  }, [setOrganizerWallet]);

  const disconnectOrganizer = useCallback(() => {
    setOrganizerWallet(EMPTY_ORGANIZER_WALLET);
  }, [setOrganizerWallet]);

  return { connectOrganizer, disconnectOrganizer, verifyOrganizer };
}

export function createOrganizerSignFn(expectedAddress: string): SignFn {
  return async (xdr, opts) => {
    await verifyFreighterOrganizerAddress(expectedAddress);
    const networkPassphrase = opts?.networkPassphrase || 'Test SDF Network ; September 2015';
    const result = await freighterSignTransaction(xdr, { networkPassphrase });
    if (result.error) throw new Error(result.error);
    return { signedTxXdr: result.signedTxXdr, signerAddress: expectedAddress };
  };
}

export async function verifyFreighterOrganizerAddress(expectedAddress: string): Promise<string> {
  const connected = await isFreighterConnected();
  if (connected.error || !connected.isConnected) {
    throw new Error(connected.error ? String(connected.error) : 'Freighter is not installed or connected.');
  }
  const current = await getFreighterAddress();
  if (current.error || !current.address) {
    throw new Error(current.error ? String(current.error) : 'Freighter did not provide an organizer address.');
  }
  if (current.address !== expectedAddress) {
    throw new Error('Freighter is connected to a different organizer wallet.');
  }
  return current.address;
}
