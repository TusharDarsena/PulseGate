import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchAllEvents } from '../lib/supabase';
import type { Event, EventStatus } from '../types';

const POLL_INTERVAL_MS = 30_000;
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80';

export function useEvents(): {
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
      const data = await fetchAllEvents();

      if (fetchId !== fetchRef.current) return;

      const resolved: Event[] = data.map((row) => ({
        eventId: row.event_id,
        organizer: row.organizer_address,
        name: row.name || 'Unnamed Event',
        dateUnix: row.date_unix,
        capacity: row.capacity,
        pricePerTicket: row.price_per_ticket,
        currentSupply: row.current_supply || 0,
        status: (row.status as EventStatus) || 'Active',
        imageUrl: row.image_url || FALLBACK_IMAGE,
        description: row.description || 'No description provided.',
        venue: row.venue || 'Venue TBA',
        city: row.city || ''
      }));

      setEvents(resolved);
    } catch (err) {
      if (fetchId !== fetchRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load events.');
    } finally {
      if (fetchId === fetchRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => { void fetchEvents(); }, 0);
    intervalRef.current = setInterval(fetchEvents, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchEvents]);

  return { events, loading, error, invalidate: fetchEvents };
}
