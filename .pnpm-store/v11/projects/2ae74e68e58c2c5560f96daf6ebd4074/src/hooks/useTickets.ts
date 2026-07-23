// useTickets.ts — tickets owned by the current wallet, discovered via Supabase.
// Call invalidate() after a purchase to refresh immediately.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAppStore } from '../store/useAppStore';
import { fetchTicketsByOwner } from '../lib/supabase';
import type { Ticket, TicketStatus } from '../types';

const POLL_INTERVAL_MS = 30_000;

export function useTickets(): {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  invalidate: () => void;
} {
  const { attendeeWallet: wallet } = useAppStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef(0);

  const fetchTickets = useCallback(async (publicKey: string) => {
    const fetchId = ++fetchRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchTicketsByOwner(publicKey);

      if (fetchId !== fetchRef.current) return;

      const resolved: Ticket[] = data.map((row) => ({
        ticketId: row.ticket_id,
        eventId: row.event_id,
        owner: row.owner_address,
        status: row.status as TicketStatus,
        purchasedAt: row.purchased_at,
      }));

      setTickets(resolved);
    } catch (err) {
      if (fetchId !== fetchRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load tickets.');
    } finally {
      if (fetchId === fetchRef.current) setLoading(false);
    }
  }, []);

  const startPolling = useCallback((publicKey: string) => {
    fetchTickets(publicKey);
    intervalRef.current = setInterval(() => fetchTickets(publicKey), POLL_INTERVAL_MS);
  }, [fetchTickets]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Re-fetch immediately and reset the 30s timer (call after purchase)
  const invalidate = useCallback(() => {
    stopPolling();
    if (wallet.readiness === 'ready' && wallet.address) {
      startPolling(wallet.address);
    }
  }, [wallet.readiness, wallet.address, startPolling, stopPolling]);

  useEffect(() => {
    if (wallet.readiness !== 'ready' || !wallet.address) {
      setTimeout(() => setTickets([]), 0);
      stopPolling();
      return;
    }
    setTimeout(() => startPolling(wallet.address!), 0);
    return stopPolling;
  }, [wallet.readiness, wallet.address, startPolling, stopPolling]);

  return { tickets, loading, error, invalidate };
}
