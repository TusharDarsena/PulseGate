-- Part 6: retain owned tickets even if their event read-model projection is absent.
-- Soroban remains authoritative; this function only exposes a user-owned mirror.

CREATE OR REPLACE FUNCTION public.get_my_tickets()
RETURNS TABLE (
  ticket_id text,
  event_id text,
  owner_address text,
  status text,
  purchased_at timestamptz,
  event_name text,
  event_summary text,
  event_description text,
  event_image_url text,
  event_category text,
  event_date_unix bigint,
  event_end_unix bigint,
  event_timezone text,
  event_venue text,
  event_address text,
  event_city text,
  event_status text,
  event_capacity bigint,
  event_price_per_ticket bigint,
  receipt_operation_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.ticket_id, t.event_id, t.owner_address, t.status, t.purchased_at,
    e.name, e.summary, e.description, e.image_url, e.category, e.date_unix,
    e.end_unix, e.timezone, e.venue, e.address, e.city, e.status,
    e.capacity, e.price_per_ticket, receipt.operation_id
  FROM public.tickets t
  LEFT JOIN public.events e ON e.event_id = t.event_id
  LEFT JOIN public.purchase_operations receipt
    ON receipt.operation_id = t.purchase_operation_id
   AND receipt.user_id = auth.uid()
  WHERE t.owner_address = (SELECT aw.address FROM public.attendee_wallets aw WHERE aw.user_id = auth.uid())
  ORDER BY t.purchased_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_tickets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tickets() TO authenticated;

-- Migration assertion: the owned-ticket projection must not be filtered by a
-- missing event row.
DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_my_tickets()'::regprocedure)
    INTO definition;
  IF definition NOT ILIKE '%LEFT JOIN public.events%' THEN
    RAISE EXCEPTION 'get_my_tickets must retain tickets without event projections';
  END IF;
END;
$$;
