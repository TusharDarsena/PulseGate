import { describe, expect, it } from 'vitest';
import {
  ticketOperationAuthorityPresentation,
} from '../../lib/ticketOperationPresentation';
import type { TicketOperationState } from '../../lib/ticketOperations';

const presentation = (state: TicketOperationState) =>
  ticketOperationAuthorityPresentation({ state, operation_type: 'refund' });

describe('ticket operation recovery wording', () => {
  it('keeps pending and unknown signed actions from being repeated', () => {
    expect(presentation('confirmation_pending')).toEqual({
      state: 'checking',
      message: 'PulseGate is resolving the signed refund. Do not submit it again.',
    });
    expect(presentation('status_unknown')).toEqual({
      state: 'unavailable',
      message: 'The signed refund may exist, but its Stellar result is unknown. Do not submit it again.',
    });
  });

  it('distinguishes chain confirmation, sync warning, and completion', () => {
    expect(presentation('chain_confirmed').message).toMatch(/confirmed on Stellar.*synchronizing/i);
    expect(presentation('sync_warning').message).toMatch(/Only mirror synchronization/i);
    expect(presentation('complete').message).toMatch(/confirmed on Stellar and synchronized/i);
  });
});
