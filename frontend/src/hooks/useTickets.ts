// useTickets.ts — tickets owned by the authenticated attendee, discovered via Supabase.
// Call invalidate() after a purchase to refresh immediately.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { fetchMyTickets } from '../lib/supabase';
import { listPendingPurchaseSync, retryPurchaseSync, type PurchaseOperationResponse } from '../lib/purchaseOperations';
import type { Ticket, TicketStatus } from '../types';

const POLL_INTERVAL_MS = 30_000;

export function useTickets(): {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  invalidate: () => void;
  pendingSync: PurchaseOperationResponse[];
  retryPending: () => void;
} {
  const { user, loading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState<PurchaseOperationResponse[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef(0);
  const repairedMount = useRef<string | null>(null);

  const fetchTickets = useCallback(async () => {
    const fetchId = ++fetchRef.current;
    setLoading(true);
    setError(null);

    try {
      const data = await fetchMyTickets();

      if (fetchId !== fetchRef.current) return;

      const resolved: Ticket[] = data.map((row) => ({
        ticketId: row.ticket_id,
        eventId: row.event_id,
        owner: row.owner_address,
        status: row.status as TicketStatus,
        purchasedAt: row.purchased_at,
        receiptOperationId: row.receipt_operation_id ?? undefined,
      }));

      setTickets(resolved);
    } catch (err) {
      if (fetchId !== fetchRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load tickets.');
    } finally {
      if (fetchId === fetchRef.current) setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    fetchTickets();
    intervalRef.current = setInterval(() => fetchTickets(), POLL_INTERVAL_MS);
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
    if (user) startPolling();
  }, [startPolling, stopPolling, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setTimeout(() => setTickets([]), 0);
      setTimeout(() => setPendingSync([]), 0);
      setTimeout(() => setLoading(false), 0);
      repairedMount.current = null;
      stopPolling();
      return;
    }
    let active = true;
    const startTimer = window.setTimeout(() => startPolling(), 0);
    if (repairedMount.current !== user.id) {
      repairedMount.current = user.id;
      void listPendingPurchaseSync().then(async ({ operations }) => {
        const pending = operations.slice(0, 10);
        const results = await Promise.all(pending.map((item) => retryPurchaseSync(item.operation.operation_id).catch(() => item)));
        if (!active) return;
        setPendingSync(results.filter((item) => item.operation.state !== 'complete'));
        if (pending.length) fetchTickets();
      }).catch(() => undefined);
    }
    return () => {
      active = false;
      window.clearTimeout(startTimer);
      stopPolling();
    };
  }, [authLoading, user, startPolling, stopPolling, fetchTickets]);

  const retryPending = useCallback(() => {
    void Promise.all(pendingSync.map((item) => retryPurchaseSync(item.operation.operation_id).catch(() => item)))
      .then((results) => {
        setPendingSync(results.filter((item) => item.operation.state !== 'complete'));
        if (user) fetchTickets();
      });
  }, [fetchTickets, pendingSync, user]);

  return { tickets, loading, error, invalidate, pendingSync, retryPending };
}
