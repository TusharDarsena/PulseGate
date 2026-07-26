-- Slice 1 / Phase 4: recoverable owned tickets.
-- Soroban remains authoritative; these rows are a verified read model.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS purchase_operation_id uuid,
  ADD COLUMN IF NOT EXISTS purchase_transaction_hash text,
  ADD COLUMN IF NOT EXISTS purchase_ledger_sequence bigint,
  ADD COLUMN IF NOT EXISTS purchase_verified_at timestamptz;

ALTER TABLE public.purchase_operations
  DROP CONSTRAINT IF EXISTS purchase_operations_failure_category_check,
  ADD CONSTRAINT purchase_operations_failure_category_check CHECK (
    failure_category IS NULL OR failure_category IN (
      'approval_rejected','approval_expired','preparation_failed',
      'signing_provider_failed','signed_attempt_not_submitted','submission_failed',
      'chain_rejected','status_unavailable','synchronization_error'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS tickets_purchase_operation_unique
  ON public.tickets (purchase_operation_id)
  WHERE purchase_operation_id IS NOT NULL;

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tickets'
      AND cmd IN ('INSERT', 'ALL')
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tickets', policy_record.policyname);
  END LOOP;
END;
$$;
REVOKE INSERT ON public.tickets FROM anon, authenticated;
-- Keep the legacy public ticket projection needed by refund/scanner/marketplace
-- updates, but do not expose the new private purchase provenance columns.
REVOKE SELECT ON public.tickets FROM anon, authenticated;
GRANT SELECT (ticket_id, event_id, owner_address, status, purchased_at)
  ON public.tickets TO anon, authenticated;

-- Operation tables are private implementation details. The Edge Function is
-- the owner-checking API for receipts and pending synchronization.
REVOKE ALL ON public.purchase_operations FROM anon, authenticated;
REVOKE ALL ON public.purchase_operation_attempts FROM anon, authenticated;

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
  JOIN public.events e ON e.event_id = t.event_id
  LEFT JOIN public.purchase_operations receipt
    ON receipt.operation_id = t.purchase_operation_id
   AND receipt.user_id = auth.uid()
  WHERE t.owner_address = (SELECT aw.address FROM public.attendee_wallets aw WHERE aw.user_id = auth.uid())
  ORDER BY t.purchased_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_my_tickets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tickets() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_ticket(requested_ticket_id text)
RETURNS TABLE (
  ticket_id text, event_id text, owner_address text, status text,
  purchased_at timestamptz, event_name text, event_summary text,
  event_description text, event_image_url text, event_category text,
  event_date_unix bigint, event_end_unix bigint, event_timezone text,
  event_venue text, event_address text, event_city text, event_status text,
  event_capacity bigint, event_price_per_ticket bigint, receipt_operation_id uuid
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.* FROM public.get_my_tickets() AS m WHERE m.ticket_id = requested_ticket_id;
$$;
REVOKE ALL ON FUNCTION public.get_my_ticket(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ticket(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.finalize_verified_purchase_sync(
  requested_operation_id uuid,
  verified_ticket_id text,
  verified_event_id text,
  verified_owner_address text,
  verified_ticket_status text,
  verified_event_status text,
  verified_event_supply bigint,
  verified_event_capacity bigint,
  verified_transaction_hash text,
  verified_ledger_sequence bigint,
  verified_at timestamptz,
  verified_network text,
  verified_ticket_contract_id text
)
RETURNS public.purchase_operations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  op public.purchase_operations%ROWTYPE;
  mirrored_event public.events%ROWTYPE;
  mirrored_ticket public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO op FROM public.purchase_operations WHERE operation_id = requested_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase operation not found.'; END IF;

  IF op.ticket_id IS DISTINCT FROM verified_ticket_id
     OR op.event_id IS DISTINCT FROM verified_event_id
     OR op.network IS DISTINCT FROM verified_network
     OR op.ticket_contract_id IS DISTINCT FROM verified_ticket_contract_id
     OR op.transaction_hash IS DISTINCT FROM verified_transaction_hash
     OR op.ledger_sequence IS DISTINCT FROM verified_ledger_sequence THEN
    RAISE EXCEPTION 'Verified Soroban identity does not match the purchase operation.';
  END IF;
  IF op.state = 'complete' THEN RETURN op; END IF;
  IF op.state NOT IN ('chain_confirmed', 'mirror_syncing', 'sync_warning') THEN
    RAISE EXCEPTION 'Purchase operation is not ready for synchronization.';
  END IF;
  IF verified_owner_address IS NULL OR btrim(verified_owner_address) = ''
     OR verified_event_supply < 0 OR verified_event_supply > verified_event_capacity
     OR verified_ticket_status NOT IN ('Active','Used','Refunded')
     OR verified_event_status NOT IN ('Active','Cancelled','Completed') THEN
    RAISE EXCEPTION 'Verified Soroban state does not match the purchase operation.';
  END IF;

  SELECT * INTO mirrored_event
  FROM public.events
  WHERE event_id = op.event_id AND chain_verified_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Trusted published event not found.'; END IF;
  IF mirrored_event.network IS DISTINCT FROM verified_network
     OR mirrored_event.ticket_contract_id IS DISTINCT FROM verified_ticket_contract_id
     OR mirrored_event.capacity IS DISTINCT FROM verified_event_capacity THEN
    RAISE EXCEPTION 'Verified Soroban event does not match the published event.';
  END IF;

  SELECT * INTO mirrored_ticket
  FROM public.tickets
  WHERE ticket_id = op.ticket_id
  FOR UPDATE;
  IF FOUND AND (
    mirrored_ticket.event_id IS DISTINCT FROM op.event_id
    OR (
      mirrored_ticket.purchase_operation_id IS NOT NULL
      AND mirrored_ticket.purchase_operation_id IS DISTINCT FROM op.operation_id
    )
    OR (
      mirrored_ticket.purchase_transaction_hash IS NOT NULL
      AND mirrored_ticket.purchase_transaction_hash IS DISTINCT FROM verified_transaction_hash
    )
    OR (
      mirrored_ticket.purchase_ledger_sequence IS NOT NULL
      AND mirrored_ticket.purchase_ledger_sequence IS DISTINCT FROM verified_ledger_sequence
    )
  ) THEN
    RAISE EXCEPTION 'Existing ticket provenance conflicts with the verified purchase.';
  END IF;

  INSERT INTO public.tickets AS existing (
    ticket_id, event_id, owner_address, status, purchased_at,
    purchase_operation_id, purchase_transaction_hash,
    purchase_ledger_sequence, purchase_verified_at
  ) VALUES (
    op.ticket_id, op.event_id, verified_owner_address, verified_ticket_status,
    COALESCE(op.confirmed_at, verified_at), op.operation_id,
    verified_transaction_hash, verified_ledger_sequence, verified_at
  )
  ON CONFLICT (ticket_id) DO UPDATE SET
    event_id = EXCLUDED.event_id, owner_address = EXCLUDED.owner_address,
    status = EXCLUDED.status, purchase_operation_id = COALESCE(existing.purchase_operation_id, EXCLUDED.purchase_operation_id),
    purchase_transaction_hash = COALESCE(existing.purchase_transaction_hash, EXCLUDED.purchase_transaction_hash),
    purchase_ledger_sequence = COALESCE(existing.purchase_ledger_sequence, EXCLUDED.purchase_ledger_sequence),
    purchase_verified_at = COALESCE(existing.purchase_verified_at, EXCLUDED.purchase_verified_at);

  UPDATE public.events SET current_supply = verified_event_supply,
    status = verified_event_status, chain_verified_at = verified_at, updated_at = now()
  WHERE event_id = op.event_id;

  UPDATE public.purchase_operations SET state = 'complete', failure_category = NULL,
    failure_detail = NULL, updated_at = now()
  WHERE operation_id = op.operation_id
  RETURNING * INTO op;
  RETURN op;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_verified_purchase_sync(uuid,text,text,text,text,text,bigint,bigint,text,bigint,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_verified_purchase_sync(uuid,text,text,text,text,text,bigint,bigint,text,bigint,timestamptz,text,text) TO service_role;
