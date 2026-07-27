import { describe, expect, it } from 'vitest';
import type { Event } from '../types';
import { deriveOrganizerLifecycle } from './eventModel';

function event(overrides: Partial<Event> = {}): Event {
  return {
    eventId: 'event-1',
    organizer: 'GABC',
    organizerDisplayName: 'Organizer',
    name: 'Event',
    summary: 'Summary',
    description: 'Description',
    imageUrl: 'https://example.com/poster.jpg',
    category: 'Music',
    dateUnix: 200,
    endUnix: 300,
    timezone: 'UTC',
    venue: 'Venue',
    address: 'Address',
    city: 'City',
    supportContact: 'support@example.com',
    refundPolicyCode: 'cancelled_event_original_price',
    resalePolicyCode: 'stellar_marketplace_unlocked',
    entryInstructions: 'Bring your ticket.',
    capacity: 10,
    pricePerTicket: 10_000_000,
    currentSupply: 2,
    status: 'Active',
    network: 'StellarTestnet',
    ticketContractId: 'CAAA',
    creationTxHash: 'hash',
    chainVerifiedAt: '2026-01-01T00:00:00Z',
    authority: 'confirmed',
    ...overrides,
  };
}

describe('organizer lifecycle labels', () => {
  it('derives sale, progress, and settlement states from authoritative schedule', () => {
    expect(deriveOrganizerLifecycle(event(), 100)).toBe('on_sale');
    expect(deriveOrganizerLifecycle(event({ currentSupply: 10 }), 100)).toBe('sold_out');
    expect(deriveOrganizerLifecycle(event(), 250)).toBe('in_progress');
    expect(deriveOrganizerLifecycle(event(), 300)).toBe('awaiting_completion');
  });

  it('does not conflate terminal or unavailable state with pending', () => {
    expect(deriveOrganizerLifecycle(event({ status: 'Cancelled' }), 100)).toBe('cancelled');
    expect(deriveOrganizerLifecycle(event({ status: 'Completed' }), 100)).toBe('completed');
    expect(deriveOrganizerLifecycle(event({ authority: 'unavailable' }), 100)).toBe('unavailable');
  });
});
