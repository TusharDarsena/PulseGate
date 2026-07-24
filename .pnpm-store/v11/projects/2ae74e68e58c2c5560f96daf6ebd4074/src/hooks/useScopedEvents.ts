import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeEvent } from '../lib/eventModel';
import {
  fetchPublishedEventsByIds,
  fetchPublishedEventsByOrganizer,
} from '../lib/supabase';
import type { Event } from '../types';

function useScopedLoader(key: string, loader: () => Promise<Event[]>) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loader();
      if (requestId === requestRef.current) setEvents(next);
    } catch (nextError) {
      if (requestId === requestRef.current) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to load event details.');
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  // The serialized key intentionally controls when the caller's loader changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  return { events, loading, error, reload };
}

export function usePublishedEventsByIds(eventIds: string[]) {
  const key = [...new Set(eventIds)].sort().join(',');
  return useScopedLoader(key, async () => {
    const rows = await fetchPublishedEventsByIds(key ? key.split(',') : []);
    return rows.map(normalizeEvent);
  });
}

export function useOrganizerEvents(organizerAddress: string | null) {
  const key = organizerAddress ?? '';
  return useScopedLoader(key, async () => {
    if (!organizerAddress) return [];
    const rows = await fetchPublishedEventsByOrganizer(organizerAddress);
    return rows.map(normalizeEvent);
  });
}
