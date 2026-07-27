import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeEvent } from '../lib/eventModel';
import {
  fetchPublishedEventsByIds,
  getMyOrganizerEvents,
  listMyEventDrafts,
  type EventPublicationDraft,
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
    const timeout = setTimeout(() => {
      void reload();
    }, 0);
    return () => {
      clearTimeout(timeout);
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

export function useOrganizerEvents() {
  return useScopedLoader('authenticated-owner', async () => {
    const rows = await getMyOrganizerEvents();
    return rows.map(normalizeEvent);
  });
}

export function useOrganizerDrafts() {
  const [drafts, setDrafts] = useState<EventPublicationDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await listMyEventDrafts();
      if (requestId === requestRef.current) setDrafts(next);
    } catch (nextError) {
      if (requestId === requestRef.current) {
        setError(nextError instanceof Error ? nextError.message : 'Failed to load event drafts.');
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void reload(), 0);
    return () => {
      clearTimeout(timeout);
      requestRef.current += 1;
    };
  }, [reload]);

  return { drafts, loading, error, reload };
}
