export type TicketStatus = 'Active' | 'Used' | 'Refunded';
export type EventStatus = 'Active' | 'Cancelled' | 'Completed';
export type TxStatus = 'idle' | 'building' | 'signing' | 'submitting' | 'success' | 'error';

export type SignFn = (
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string },
) => Promise<{ signedTxXdr: string; signerAddress?: string }>;

export type MessageSignFn = (message: Uint8Array, externalId?: string) => Promise<Uint8Array>;
export type WalletReadiness =
  | 'signed_out'
  | 'not_provisioned'
  | 'provisioning'
  | 'ready'
  | 'recovery_required'
  | 'error';

export interface Event {
  eventId: string;
  organizer: string;
  name: string;
  dateUnix: number;
  capacity: number;
  pricePerTicket: number;
  currentSupply: number;
  status: EventStatus;
  imageUrl?: string;
  description?: string;
  venue?: string;
  city?: string;
  category?: string;
}

export interface Ticket {
  ticketId: string;
  eventId: string;
  owner: string;
  status: TicketStatus;
  purchasedAt?: string;
}

export interface AttendeeWalletState {
  address: string | null;
  network: 'StellarTestnet';
  readiness: WalletReadiness;
  signFn: SignFn | null;
  signMessage: MessageSignFn | null;
  errorMessage?: string;
}

export interface OrganizerWalletState {
  isConnected: boolean;
  publicKey: string | null;
  xlmBalance: string | null;
  signFn: SignFn | null;
  errorMessage?: string;
}

export interface TxState {
  status: TxStatus;
  hash?: string;
  errorMessage?: string;
  message?: string;
}

export const xlmToStroops = (xlm: number): bigint => BigInt(Math.floor(xlm * 10_000_000));
export const stroopsToXlm = (s: number) => (s / 10_000_000).toFixed(2);
export const formatEventDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
export const formatDateTime = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
export const truncateKey = (key: string) => `${key.slice(0, 4)}...${key.slice(-4)}`;
