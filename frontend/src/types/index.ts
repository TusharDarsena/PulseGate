export type TicketStatus = 'Active' | 'Used' | 'Refunded';
export type EventStatus = 'Active' | 'Cancelled' | 'Completed';
export type EventSalesState =
  | 'on_sale'
  | 'sold_out'
  | 'sales_closed'
  | 'cancelled'
  | 'completed'
  | 'unavailable';
export type EventAuthority = 'preview' | 'confirmed' | 'unavailable';
export type RefundPolicyCode = 'cancelled_event_original_price';
export type ResalePolicyCode = 'stellar_marketplace_unlocked';
export type TxStatus = 'idle' | 'building' | 'signing' | 'submitting' | 'success' | 'error';

export type SignFn = (
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string; externalId?: string },
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
  organizerDisplayName: string;
  name: string;
  summary: string;
  description: string;
  imageUrl: string;
  category: string;
  dateUnix: number;
  endUnix: number;
  timezone: string;
  venue: string;
  address: string;
  city: string;
  supportContact: string;
  refundPolicyCode: RefundPolicyCode;
  resalePolicyCode: ResalePolicyCode;
  entryInstructions: string;
  capacity: number;
  pricePerTicket: number;
  currentSupply: number;
  escrowBalance?: number;
  status: EventStatus;
  network: 'StellarTestnet';
  ticketContractId: string;
  creationTxHash: string;
  chainVerifiedAt: string;
  authority: EventAuthority;
  authorityError?: string;
}

export interface AuthoritativeEventSnapshot {
  eventId: string;
  organizer: string;
  name: string;
  dateUnix: number;
  capacity: number;
  pricePerTicket: number;
  currentSupply: number;
  endUnix: number;
  escrowBalance: number;
  status: EventStatus;
}

export interface Ticket {
  ticketId: string;
  eventId: string;
  owner: string;
  status: TicketStatus;
  purchasedAt?: string;
  receiptOperationId?: string;
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
  accountExists: boolean | null;
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
export const formatEventDate = (unix: number, timeZone = 'UTC') =>
  new Date(unix * 1000).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
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
