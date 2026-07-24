import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchPublishedEventsByIds, supabase } from '../lib/supabase';


export interface ListingWithEvent {
  listingId: string;
  seller: string;
  ticketId: string;
  eventId: string;
  askPriceStroops: bigint;
  status: 'Open' | 'Sold' | 'Cancelled';
  eventName: string;
  eventImageUrl: string;
  eventDateUnix: number;
}

interface ListingRow {
  listing_id: string;
  seller_address: string;
  ticket_id: string;
  event_id: string;
  ask_price_stroops: string | number;
  status: string;
}

const POLL_INTERVAL_MS = 30_000;

export function useListings(): {
  listings: ListingWithEvent[];
  loading: boolean;
  error: string | null;
  invalidate: () => Promise<void>;
} {
  const [listings, setListings] = useState<ListingWithEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef(0);

  const fetchListings = useCallback(async () => {
    const fetchId = ++fetchRef.current;
    
    // Move to next microtask to avoid cascading render warning in React 19
    await Promise.resolve();

    setLoading(true);
    setError(null);

    try {
      const { data, error: dbError } = await supabase
        .from('listings')
        .select(`
          listing_id,
          seller_address,
          ticket_id,
          event_id,
          ask_price_stroops,
          status
        `)
        .eq('status', 'Open')
        .order('listed_at', { ascending: false });

      if (dbError) throw dbError;

      if (fetchId !== fetchRef.current) return;

      const rows = (data as unknown as ListingRow[]) || [];
      const eventRows = await fetchPublishedEventsByIds(rows.map((row) => row.event_id));
      const eventsById = new Map(eventRows.map((event) => [event.event_id, event]));
      const resolved: ListingWithEvent[] = rows.flatMap((row) => {
        const event = eventsById.get(row.event_id);
        if (!event) return [];
        return [{
        listingId: row.listing_id,
        seller: row.seller_address,
        ticketId: row.ticket_id,
        eventId: row.event_id,
        askPriceStroops: BigInt(row.ask_price_stroops),
        status: row.status as 'Open' | 'Sold' | 'Cancelled',
        eventName: event.name,
        eventImageUrl: event.image_url,
        eventDateUnix: event.date_unix,
      }];
      });

      setListings(resolved);
    } catch (err) {
      if (fetchId !== fetchRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load listings.');
    } finally {
      if (fetchId === fetchRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setTimeout(() => { void fetchListings(); }, 0);
    intervalRef.current = setInterval(fetchListings, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchListings]);

  return { listings, loading, error, invalidate: fetchListings };
}
