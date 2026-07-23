import { nanoid } from 'nanoid';
import { buildQRPayload, verifyQRPayload } from '../lib/qr';
import { purchaseProofTicket } from '../lib/soroban';
import { useAppStore } from '../store/useAppStore';

export interface DfnsProofResult {
  address: string;
  ticketId: string;
  transactionHash: string;
  qrVerified: boolean;
}

/**
 * Developer-only proof. It refuses the application's configured TicketContract
 * and never writes to Supabase mirrors or invokes the public checkout.
 */
export async function runIsolatedDfnsPurchaseProof(): Promise<DfnsProofResult> {
  const contractId = import.meta.env.VITE_DFNS_PROOF_TICKET_CONTRACT_ID as string;
  const eventId = import.meta.env.VITE_DFNS_PROOF_EVENT_ID as string;
  const wallet = useAppStore.getState().attendeeWallet;
  if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signFn || !wallet.signMessage) {
    throw new Error('A restored delegated attendee wallet is required.');
  }
  const ticketId = `proof-${nanoid()}`;
  const transactionHash = await purchaseProofTicket(
    contractId,
    eventId,
    wallet.address,
    ticketId,
    wallet.signFn,
  );
  const qr = await buildQRPayload(wallet.address, ticketId, wallet.signMessage);
  const verified = verifyQRPayload(qr);
  return {
    address: wallet.address,
    ticketId,
    transactionHash,
    qrVerified: verified?.walletAddress === wallet.address && verified.ticketId === ticketId,
  };
}
