-- Product Slice 3: reliable, ticket-scoped venue check-in.
--
-- Soroban remains authoritative. Browser clients may read their bounded views,
-- but only trusted service-role functions may record a verified Used mirror.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS check_in_operation_id uuid,
  ADD COLUMN IF NOT EXISTS check_in_transaction_hash text,
  ADD COLUMN IF NOT EXISTS check_in_ledger_sequence bigint,
  ADD COLUMN IF NOT EXISTS check_in_verified_at timestamptz;

REVOKE UPDATE ON public.tickets FROM anon, authenticated;

CREATE TABLE public.check_in_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_idempotency_key uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.events(event_id),
  ticket_id text NOT NULL,
  expected_owner_address text NOT NULL,
  expected_organizer_address text NOT NULL,
  network text NOT NULL,
  ticket_contract_id text NOT NULL,
  state text NOT NULL DEFAULT 'review'
    CHECK (state IN (
      'review',
      'approval_required',
      'pre_submission_failed',
      'signed_submission_pending',
      'confirmation_pending',
      'status_unknown',
      'chain_failed',
      'chain_confirmed',
      'mirror_syncing',
      'sync_warning',
      'complete'
    )),
  unsigned_envelope_hash text,
  signed_transaction_hash text,
  source_sequence text,
  transaction_max_time bigint,
  verified_event_topic text,
  verified_ticket_id text,
  verified_ledger_sequence bigint,
  verified_ledger_closed_at timestamptz,
  confirmed_at timestamptz,
  synchronized_at timestamptz,
  failure_category text,
  failure_detail text CHECK (failure_detail IS NULL OR length(failure_detail) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(event_id) <> ''),
  CHECK (btrim(ticket_id) <> ''),
  CHECK (btrim(expected_owner_address) <> ''),
  CHECK (btrim(expected_organizer_address) <> ''),
  CHECK (btrim(network) <> ''),
  CHECK (btrim(ticket_contract_id) <> ''),
  CHECK (
    unsigned_envelope_hash IS NULL
    OR unsigned_envelope_hash ~ '^[0-9a-f]{64}$'
  ),
  CHECK (
    signed_transaction_hash IS NULL
    OR signed_transaction_hash ~ '^[0-9a-f]{64}$'
  ),
  CHECK (source_sequence IS NULL OR source_sequence ~ '^[0-9]+$'),
  CHECK (transaction_max_time IS NULL OR transaction_max_time > 0),
  CHECK (
    verified_event_topic IS NULL
    OR verified_event_topic = 'tk_used'
  ),
  CHECK (
    verified_ticket_id IS NULL
    OR verified_ticket_id = ticket_id
  ),
  CHECK (
    failure_category IS NULL
    OR failure_category IN (
      'approval_rejected',
      'approval_expired',
      'preparation_failed',
      'signing_provider_failed',
      'chain_rejected',
      'expired_without_submission',
      'status_unavailable',
      'receipt_unavailable',
      'synchronization_error'
    )
  )
);

CREATE UNIQUE INDEX check_in_operations_one_per_ticket
  ON public.check_in_operations (network, ticket_contract_id, ticket_id);
CREATE INDEX check_in_operations_owner_event_updated
  ON public.check_in_operations (user_id, event_id, updated_at DESC);
CREATE INDEX check_in_operations_signed_hash
  ON public.check_in_operations (signed_transaction_hash)
  WHERE signed_transaction_hash IS NOT NULL;
CREATE UNIQUE INDEX tickets_check_in_operation_unique
  ON public.tickets (check_in_operation_id)
  WHERE check_in_operation_id IS NOT NULL;

ALTER TABLE public.check_in_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own check-in operations"
  ON public.check_in_operations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.check_in_operations FROM anon, authenticated;
GRANT SELECT ON public.check_in_operations TO authenticated;

CREATE OR REPLACE FUNCTION public.allocate_check_in_operation(
  operation_owner_id uuid,
  requested_idempotency_key uuid,
  requested_event_id text,
  requested_ticket_id text,
  verified_owner_address text,
  verified_organizer_address text,
  configured_network text,
  configured_ticket_contract_id text
)
RETURNS public.check_in_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.check_in_operations%ROWTYPE;
  lock_key text;
BEGIN
  IF operation_owner_id IS NULL THEN
    RAISE EXCEPTION 'Operation owner is required';
  END IF;
  IF requested_event_id IS NULL OR btrim(requested_event_id) = ''
     OR requested_ticket_id IS NULL OR btrim(requested_ticket_id) = ''
     OR verified_owner_address IS NULL OR btrim(verified_owner_address) = ''
     OR verified_organizer_address IS NULL OR btrim(verified_organizer_address) = ''
     OR configured_network IS NULL OR btrim(configured_network) = ''
     OR configured_ticket_contract_id IS NULL OR btrim(configured_ticket_contract_id) = '' THEN
    RAISE EXCEPTION 'Complete check-in identity is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_publication_drafts
    WHERE user_id = operation_owner_id
      AND event_id = requested_event_id
      AND intended_organizer_address = verified_organizer_address
      AND network = configured_network
      AND ticket_contract_id = configured_ticket_contract_id
      AND state = 'published'
  ) THEN
    RAISE EXCEPTION 'Owned published event not found';
  END IF;

  lock_key := concat_ws(
    ':',
    configured_network,
    configured_ticket_contract_id,
    requested_ticket_id
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  SELECT * INTO operation
  FROM public.check_in_operations
  WHERE network = configured_network
    AND ticket_contract_id = configured_ticket_contract_id
    AND ticket_id = requested_ticket_id
  FOR UPDATE;

  IF FOUND THEN
    IF operation.event_id IS DISTINCT FROM requested_event_id THEN
      RAISE EXCEPTION 'Existing check-in operation belongs to another event';
    END IF;
    RETURN operation;
  END IF;

  INSERT INTO public.check_in_operations (
    request_idempotency_key,
    user_id,
    event_id,
    ticket_id,
    expected_owner_address,
    expected_organizer_address,
    network,
    ticket_contract_id
  ) VALUES (
    requested_idempotency_key,
    operation_owner_id,
    requested_event_id,
    requested_ticket_id,
    verified_owner_address,
    verified_organizer_address,
    configured_network,
    configured_ticket_contract_id
  )
  ON CONFLICT (request_idempotency_key) DO NOTHING
  RETURNING * INTO operation;

  IF NOT FOUND THEN
    SELECT * INTO STRICT operation
    FROM public.check_in_operations
    WHERE check_in_operations.request_idempotency_key =
      allocate_check_in_operation.requested_idempotency_key
      AND check_in_operations.user_id =
      allocate_check_in_operation.operation_owner_id;
  END IF;
  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_check_in_operation(
  uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_check_in_operation(
  uuid, uuid, text, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_check_in_operation(
  requested_operation_id uuid,
  p_verified_transaction_hash text,
  p_verified_event_topic text,
  p_verified_ticket_id text,
  p_verified_ledger_sequence bigint,
  p_verified_ledger_closed_at timestamptz
)
RETURNS public.check_in_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.check_in_operations%ROWTYPE;
BEGIN
  SELECT * INTO operation
  FROM public.check_in_operations
  WHERE operation_id = requested_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check-in operation not found';
  END IF;
  IF operation.state IN ('chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete') THEN
    IF operation.signed_transaction_hash IS DISTINCT FROM p_verified_transaction_hash THEN
      RAISE EXCEPTION 'Confirmed transaction identity conflicts';
    END IF;
    RETURN operation;
  END IF;
  IF operation.state NOT IN (
    'signed_submission_pending', 'confirmation_pending', 'status_unknown'
  ) THEN
    RAISE EXCEPTION 'Operation is not awaiting authoritative confirmation';
  END IF;
  IF operation.signed_transaction_hash IS DISTINCT FROM p_verified_transaction_hash
     OR p_verified_event_topic <> 'tk_used'
     OR operation.ticket_id IS DISTINCT FROM p_verified_ticket_id
     OR p_verified_ledger_sequence <= 0
     OR p_verified_ledger_closed_at IS NULL THEN
    RAISE EXCEPTION 'Authoritative check-in proof does not match the operation';
  END IF;

  UPDATE public.check_in_operations
  SET
    state = 'chain_confirmed',
    verified_event_topic = p_verified_event_topic,
    verified_ticket_id = p_verified_ticket_id,
    verified_ledger_sequence = p_verified_ledger_sequence,
    verified_ledger_closed_at = p_verified_ledger_closed_at,
    confirmed_at = p_verified_ledger_closed_at,
    failure_category = NULL,
    failure_detail = NULL,
    updated_at = now()
  WHERE operation_id = requested_operation_id
  RETURNING * INTO operation;
  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_check_in_operation(
  uuid, text, text, text, bigint, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_check_in_operation(
  uuid, text, text, text, bigint, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_check_in_sync(
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
RETURNS public.check_in_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.check_in_operations%ROWTYPE;
  mirrored_event public.events%ROWTYPE;
  mirrored_ticket public.tickets%ROWTYPE;
BEGIN
  SELECT * INTO operation
  FROM public.check_in_operations
  WHERE operation_id = requested_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Check-in operation not found';
  END IF;
  IF operation.state = 'complete' THEN
    RETURN operation;
  END IF;
  IF operation.state NOT IN ('chain_confirmed', 'mirror_syncing', 'sync_warning') THEN
    RAISE EXCEPTION 'Check-in operation is not ready for synchronization';
  END IF;
  IF operation.ticket_id IS DISTINCT FROM verified_ticket_id
     OR operation.event_id IS DISTINCT FROM verified_event_id
     OR operation.expected_owner_address IS DISTINCT FROM verified_owner_address
     OR operation.network IS DISTINCT FROM verified_network
     OR operation.ticket_contract_id IS DISTINCT FROM verified_ticket_contract_id
     OR operation.signed_transaction_hash IS DISTINCT FROM verified_transaction_hash
     OR operation.verified_ledger_sequence IS DISTINCT FROM verified_ledger_sequence
     OR verified_ticket_status <> 'Used'
     OR verified_event_status NOT IN ('Active', 'Cancelled', 'Completed')
     OR verified_event_supply < 0
     OR verified_event_supply > verified_event_capacity THEN
    RAISE EXCEPTION 'Verified Soroban state does not match the check-in operation';
  END IF;

  SELECT * INTO mirrored_event
  FROM public.events
  WHERE event_id = operation.event_id
    AND network = operation.network
    AND ticket_contract_id = operation.ticket_contract_id
    AND chain_verified_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND OR mirrored_event.capacity IS DISTINCT FROM verified_event_capacity THEN
    RAISE EXCEPTION 'Trusted published event does not match authoritative state';
  END IF;

  SELECT * INTO mirrored_ticket
  FROM public.tickets
  WHERE ticket_id = operation.ticket_id
  FOR UPDATE;
  IF FOUND AND (
    mirrored_ticket.event_id IS DISTINCT FROM operation.event_id
    OR mirrored_ticket.owner_address IS DISTINCT FROM verified_owner_address
    OR (
      mirrored_ticket.check_in_operation_id IS NOT NULL
      AND mirrored_ticket.check_in_operation_id IS DISTINCT FROM operation.operation_id
    )
    OR (
      mirrored_ticket.check_in_transaction_hash IS NOT NULL
      AND mirrored_ticket.check_in_transaction_hash IS DISTINCT FROM verified_transaction_hash
    )
    OR (
      mirrored_ticket.check_in_ledger_sequence IS NOT NULL
      AND mirrored_ticket.check_in_ledger_sequence IS DISTINCT FROM verified_ledger_sequence
    )
  ) THEN
    RAISE EXCEPTION 'Existing ticket check-in provenance conflicts with the verified operation';
  END IF;

  UPDATE public.tickets AS existing
  SET
    status = 'Used',
    check_in_operation_id = COALESCE(existing.check_in_operation_id, operation.operation_id),
    check_in_transaction_hash = COALESCE(existing.check_in_transaction_hash, verified_transaction_hash),
    check_in_ledger_sequence = COALESCE(existing.check_in_ledger_sequence, verified_ledger_sequence),
    check_in_verified_at = COALESCE(existing.check_in_verified_at, verified_at)
  WHERE existing.ticket_id = operation.ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted ticket mirror not found';
  END IF;

  UPDATE public.events
  SET
    current_supply = verified_event_supply,
    status = verified_event_status,
    chain_verified_at = verified_at,
    updated_at = now()
  WHERE event_id = operation.event_id;

  UPDATE public.check_in_operations
  SET
    state = 'complete',
    synchronized_at = now(),
    failure_category = NULL,
    failure_detail = NULL,
    updated_at = now()
  WHERE operation_id = operation.operation_id
  RETURNING * INTO operation;
  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_check_in_sync(
  uuid, text, text, text, text, text, bigint, bigint, text, bigint,
  timestamptz, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_check_in_sync(
  uuid, text, text, text, text, text, bigint, bigint, text, bigint,
  timestamptz, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_check_in_stats(requested_event_id text)
RETURNS TABLE (
  checked_in_count bigint,
  unresolved_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(DISTINCT op.ticket_id) FILTER (
      WHERE op.state IN ('chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete')
    ) AS checked_in_count,
    count(DISTINCT op.ticket_id) FILTER (
      WHERE op.state IN ('signed_submission_pending', 'confirmation_pending', 'status_unknown')
    ) AS unresolved_count
  FROM public.check_in_operations op
  WHERE op.user_id = auth.uid()
    AND op.event_id = requested_event_id;
$$;

REVOKE ALL ON FUNCTION public.get_my_check_in_stats(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_check_in_stats(text) TO authenticated;
