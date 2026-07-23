import { beforeEach, describe, expect, it } from 'vitest';
import {
  EMPTY_ATTENDEE_WALLET,
  EMPTY_ORGANIZER_WALLET,
  useAppStore,
} from './useAppStore';

describe('wallet state separation', () => {
  beforeEach(() => {
    useAppStore.getState().setAttendeeWallet(EMPTY_ATTENDEE_WALLET);
    useAppStore.getState().setOrganizerWallet(EMPTY_ORGANIZER_WALLET);
  });

  it('does not replace attendee identity when Freighter connects or disconnects', () => {
    const attendee = {
      ...EMPTY_ATTENDEE_WALLET,
      address: 'GATTENDEE',
      readiness: 'ready' as const,
    };
    useAppStore.getState().setAttendeeWallet(attendee);
    useAppStore.getState().setOrganizerWallet({
      ...EMPTY_ORGANIZER_WALLET,
      isConnected: true,
      publicKey: 'GORGANIZER',
    });
    useAppStore.getState().setOrganizerWallet(EMPTY_ORGANIZER_WALLET);
    expect(useAppStore.getState().attendeeWallet.address).toBe('GATTENDEE');
  });

  it('has no raw-secret field in persisted attendee state', () => {
    expect(useAppStore.getState().attendeeWallet).not.toHaveProperty('secretKey');
  });
});
