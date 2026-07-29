import type { TicketOperation } from './ticketOperations';

export const TICKET_OPERATION_LABELS: Record<TicketOperation['operation_type'], string> = {
  refund: 'Refund',
  create_listing: 'Create listing',
  cancel_listing: 'Cancel listing',
  buy_listing: 'Marketplace purchase',
};

export function ticketOperationAuthorityPresentation(
  operation: Pick<TicketOperation, 'state' | 'operation_type'>,
): {
  state: 'checking' | 'confirmed' | 'unavailable' | 'historical';
  message: string;
} {
  const label = TICKET_OPERATION_LABELS[operation.operation_type].toLowerCase();
  switch (operation.state) {
    case 'status_unknown':
      return {
        state: 'unavailable',
        message: `The signed ${label} may exist, but its Stellar result is unknown. Do not submit it again.`,
      };
    case 'chain_confirmed':
    case 'mirror_syncing':
      return {
        state: 'historical',
        message: `The ${label} is confirmed on Stellar. PulseGate is synchronizing the discovery mirror.`,
      };
    case 'sync_warning':
      return {
        state: 'historical',
        message: `The ${label} is confirmed on Stellar. Only mirror synchronization needs to be retried.`,
      };
    case 'complete':
      return {
        state: 'historical',
        message: `The ${label} is confirmed on Stellar and synchronized in PulseGate.`,
      };
    case 'chain_failed':
    case 'pre_submission_failed':
      return {
        state: 'unavailable',
        message: `The ${label} did not reach a confirmed Stellar state.`,
      };
    default:
      return {
        state: 'checking',
        message: `PulseGate is resolving the signed ${label}. Do not submit it again.`,
      };
  }
}
