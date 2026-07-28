import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: mocks.auth,
}));

vi.mock('../lib/supabase', () => ({
  fetchDiscoverableEvents: vi.fn(() => new Promise(() => undefined)),
  fetchPublishedEventsByIds: vi.fn(() => new Promise(() => undefined)),
  fetchMyTickets: vi.fn(() => new Promise(() => undefined)),
  getMyOrganizerEvents: vi.fn(() => new Promise(() => undefined)),
  listMyEventDrafts: vi.fn(() => new Promise(() => undefined)),
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order: vi.fn(() => new Promise(() => undefined)) })),
      })),
    })),
  },
}));

vi.mock('../lib/purchaseOperations', () => ({
  listPendingPurchaseSync: vi.fn(() => Promise.resolve({ operations: [] })),
  retryPurchaseSync: vi.fn(),
}));

import { useEvents } from './useEvents';
import { useListings } from './useListings';
import { useOrganizerDrafts, useOrganizerEvents } from './useScopedEvents';
import { useTickets } from './useTickets';

describe('initial collection loading states', () => {
  beforeEach(() => {
    mocks.auth.mockReturnValue({ user: { id: 'user-1' }, loading: true });
  });

  it('shows loading before its first request can be scheduled', () => {
    expect(renderHook(() => useEvents()).result.current.loading).toBe(true);
    expect(renderHook(() => useListings()).result.current.loading).toBe(true);
    expect(renderHook(() => useOrganizerEvents()).result.current.loading).toBe(true);
    expect(renderHook(() => useOrganizerDrafts()).result.current.loading).toBe(true);
    expect(renderHook(() => useTickets()).result.current.loading).toBe(true);
  });

  it('settles to a real empty state for a signed-out attendee', async () => {
    mocks.auth.mockReturnValue({ user: null, loading: false });
    const { result } = renderHook(() => useTickets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tickets).toEqual([]);
  });
});
