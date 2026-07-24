import { useCallback, useEffect, useRef, useState } from 'react';
import {
  authoritativeIdentityMismatch,
  mergeAuthoritativeEvent,
  normalizeEvent,
  unavailableEvent,
} from '../lib/eventModel';
import { getEvent } from '../lib/soroban';
import { fetchPublishedEventById } from '../lib/supabase';
import type { Event } from '../types';

export async function loadPublishedEvent(eventId: string): Promise<Event | null> {
  const row = await fetchPublishedEventById(eventId);
  if (!row) return null;
  const preview = normalizeEvent(row);
  try {
    const snapshot = await getEvent(eventId);
    const mismatch = authoritativeIdentityMismatch(preview, snapshot);
    return mismatch
      ? unavailableEvent(preview, mismatch)
      : mergeAuthoritativeEvent(preview, snapshot);
  } catch (error) {
    return unavailableEvent(
      preview,
      error instanceof Error ? error.message : 'Authoritative event state is unavailable.',
    );
  }
}

export function useEvent(eventId: string) {
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await loadPublishedEvent(eventId);
      if (requestId === requestRef.current) setEvent(next);
      return next;
    } catch (nextError) {
      if (requestId === requestRef.current) {
        setEvent(null);
        setError(nextError instanceof Error ? nextError.message : 'Failed to load event.');
      }
      return null;
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  return { event, loading, error, reload };
}
