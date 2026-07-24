import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchDiscoverableEvents, type DiscoveryFilters } from '../lib/supabase';
import { normalizeEvent } from '../lib/eventModel';
import type { Event } from '../types';

const POLL_INTERVAL_MS = 30_000;

export function useEvents(filters: DiscoveryFilters = {}): {
  events: Event[];
  loading: boolean;
  error: string | null;
  invalidate: () => Promise<void>;
} {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef(0);

  const fetchEvents = useCallback(async () => {
    const fetchId = ++fetchRef.current;
    
    // Move to next microtask to avoid cascading render warning in React 19
    await Promise.resolve();
    
    setLoading(true);
    setError(null);

    try {
      const data = await fetchDiscoverableEvents(filters);

      if (fetchId !== fetchRef.current) return;

      const resolved = data.map(normalizeEvent);

      setEvents(resolved);
    } catch (err) {
      if (fetchId !== fetchRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      if (fetchId === fetchRef.current) setLoading(false);
    }
  }, [
    filters.category,
    filters.city,
    filters.endUnix,
    filters.search,
    filters.startUnix,
  ]);

  useEffect(() => {
    setTimeout(() => { void fetchEvents(); }, 0);
    intervalRef.current = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEvents]);

  return { events, loading, error, invalidate: fetchEvents };
}
