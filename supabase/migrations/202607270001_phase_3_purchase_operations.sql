-- Slice 1 / Phase 3: durable purchase operations and signed-attempt recovery.
-- The browser can read only its own rows. Every mutation is performed by the
-- trusted purchase-operation Edge Function with the service role.

CREATE TABLE IF NOT EXISTS public.purchase_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_idempotency_key uuid NOT NULL UNIQUE,
  ticket_id text NOT NULL UNIQUE,
  event_id text NOT NULL REFERENCES public.events(event_id) ON DELETE RESTRICT,
  attendee_wallet_address text NOT NULL,
  expected_price_stroops bigint NOT NULL CHECK (expected_price_stroops > 0),
  estimated_fee_stroops bigint NOT NULL DEFAULT 0 CHECK (estimated_fee_stroops >= 0),
  confirmed_fee_stroops bigint CHECK (confirmed_fee_stroops IS NULL OR confirmed_fee_stroops >= 0),
  network text NOT NULL CHECK (network = 'StellarTestnet'),
  ticket_contract_id text NOT NULL,
  state text NOT NULL DEFAULT 'review'
    CHECK (state IN (
      'review',
      'preparing',
      'approval_required',
      'signed_submission_pending',
      'confirming',
      'status_unknown',
      'pre_submission_failed',
      'chain_failed',
      'chain_confirmed',
      'mirror_syncing',
      'sync_warning',
      'complete'
    )),
  failure_category text
    CHECK (failure_category IS NULL OR failure_category IN (
      'approval_rejected',
      'approval_expired',
      'preparation_failed',
      'signing_provider_failed',
      'signed_attempt_not_submitted',
      'submission_failed',
      'chain_rejected',
      'status_unavailable'
    )),
  failure_detail text CHECK (failure_detail IS NULL OR length(failure_detail) <= 1000),
  current_attempt_number integer NOT NULL DEFAULT 0 CHECK (current_attempt_number >= 0),
  transaction_hash text UNIQUE,
  ledger_sequence bigint,
  ledger_closed_at timestamptz,
  receipt_event_name text,
  receipt_event_start_unix bigint,
  receipt_event_timezone text,
  receipt_venue text,
  receipt_owner_address text,
  receipt_amount_stroops bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CHECK (btrim(ticket_id) <> ''),
  CHECK (btrim(event_id) <> ''),
  CHECK (btrim(attendee_wallet_address) <> ''),
  CHECK (btrim(ticket_contract_id) <> ''),
  CHECK (
    state NOT IN ('chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete') OR
    (
      transaction_hash IS NOT NULL AND
      confirmed_fee_stroops IS NOT NULL AND
      ledger_sequence IS NOT NULL AND
      ledger_closed_at IS NOT NULL AND
      receipt_event_name IS NOT NULL AND
      receipt_event_start_unix IS NOT NULL AND
      receipt_event_timezone IS NOT NULL AND
      receipt_venue IS NOT NULL AND
      receipt_owner_address IS NOT NULL AND
      receipt_amount_stroops IS NOT NULL AND
      confirmed_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.purchase_operation_attempts (
  operation_id uuid NOT NULL
    REFERENCES public.purchase_operations(operation_id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  external_id text NOT NULL UNIQUE,
  unsigned_envelope_hash text NOT NULL,
  signed_transaction_hash text UNIQUE,
  source_sequence text NOT NULL CHECK (source_sequence ~ '^[0-9]+$'),
  transaction_max_time bigint NOT NULL CHECK (transaction_max_time > 0),
  estimated_fee_stroops bigint NOT NULL CHECK (estimated_fee_stroops >= 0),
  state text NOT NULL
    CHECK (state IN (
      'preparing',
      'approval_required',
      'signed_submission_pending',
      'confirming',
      'status_unknown',
      'pre_submission_failed',
      'chain_failed',
      'chain_confirmed'
    )),
  failure_category text
    CHECK (failure_category IS NULL OR failure_category IN (
      'approval_rejected',
      'approval_expired',
      'preparation_failed',
      'signing_provider_failed',
      'signed_attempt_not_submitted',
      'submission_failed',
      'chain_rejected',
      'status_unavailable'
    )),
  failure_detail text CHECK (failure_detail IS NULL OR length(failure_detail) <= 1000),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  signed_at timestamptz,
  submitted_at timestamptz,
  resolved_at timestamptz,
  PRIMARY KEY (operation_id, attempt_number),
  UNIQUE (operation_id, unsigned_envelope_hash)
);

CREATE TABLE IF NOT EXISTS public.test_funding_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('activation', 'top_up')),
  status text NOT NULL CHECK (status IN ('started', 'confirmed', 'failed')),
  provider_reference text,
  failure_detail text CHECK (failure_detail IS NULL OR length(failure_detail) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS one_live_purchase_operation
  ON public.purchase_operations (
    user_id,
    attendee_wallet_address,
    event_id,
    network,
    ticket_contract_id
  )
  WHERE state IN (
    'review',
    'preparing',
    'approval_required',
    'signed_submission_pending',
    'confirming',
    'status_unknown'
  );

CREATE INDEX IF NOT EXISTS purchase_operations_owner_updated
  ON public.purchase_operations (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS purchase_attempts_hash_lookup
  ON public.purchase_operation_attempts (signed_transaction_hash)
  WHERE signed_transaction_hash IS NOT NULL;

ALTER TABLE public.wallet_action_challenges
  ADD COLUMN IF NOT EXISTS operation_attempt_external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS one_open_wallet_challenge_per_purchase_attempt
  ON public.wallet_action_challenges (user_id, operation_attempt_external_id)
  WHERE consumed_at IS NULL AND operation_attempt_external_id IS NOT NULL;

ALTER TABLE public.purchase_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_operation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_funding_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own purchase operations"
  ON public.purchase_operations;
CREATE POLICY "Users read own purchase operations"
  ON public.purchase_operations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users read own purchase attempts"
  ON public.purchase_operation_attempts;
CREATE POLICY "Users read own purchase attempts"
  ON public.purchase_operation_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_operations AS operation
      WHERE operation.operation_id = purchase_operation_attempts.operation_id
        AND operation.user_id = auth.uid()
    )
  );

REVOKE ALL ON public.purchase_operations FROM anon, authenticated;
REVOKE ALL ON public.purchase_operation_attempts FROM anon, authenticated;
REVOKE ALL ON public.test_funding_requests FROM anon, authenticated;
GRANT SELECT ON public.purchase_operations TO authenticated;
GRANT SELECT ON public.purchase_operation_attempts TO authenticated;

-- The service calls this function after authenticating the user and resolving
-- their server-owned attendee wallet. The advisory lock and live-operation
-- query make different idempotency keys from multiple tabs converge.
CREATE OR REPLACE FUNCTION public.allocate_purchase_operation(
  operation_owner_id uuid,
  requested_idempotency_key uuid,
  requested_event_id text,
  resolved_wallet_address text,
  verified_expected_price_stroops bigint,
  configured_network text,
  configured_ticket_contract_id text
)
RETURNS public.purchase_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.purchase_operations%ROWTYPE;
  lock_key text;
BEGIN
  IF requested_event_id IS NULL OR btrim(requested_event_id) = '' THEN
    RAISE EXCEPTION 'Missing event ID.';
  END IF;
  IF resolved_wallet_address IS NULL OR btrim(resolved_wallet_address) = '' THEN
    RAISE EXCEPTION 'The attendee wallet is unavailable.';
  END IF;
  IF verified_expected_price_stroops <= 0 THEN
    RAISE EXCEPTION 'The expected purchase price is invalid.';
  END IF;

  lock_key := concat_ws(
    ':',
    operation_owner_id,
    resolved_wallet_address,
    requested_event_id,
    configured_network,
    configured_ticket_contract_id
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  SELECT *
  INTO operation
  FROM public.purchase_operations
  WHERE user_id = operation_owner_id
    AND attendee_wallet_address = resolved_wallet_address
    AND event_id = requested_event_id
    AND network = configured_network
    AND ticket_contract_id = configured_ticket_contract_id
    AND state IN (
      'review',
      'preparing',
      'approval_required',
      'signed_submission_pending',
      'confirming',
      'status_unknown'
    )
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN operation;
  END IF;

  INSERT INTO public.purchase_operations (
    user_id,
    request_idempotency_key,
    ticket_id,
    event_id,
    attendee_wallet_address,
    expected_price_stroops,
    network,
    ticket_contract_id
  )
  VALUES (
    operation_owner_id,
    requested_idempotency_key,
    gen_random_uuid()::text,
    requested_event_id,
    resolved_wallet_address,
    verified_expected_price_stroops,
    configured_network,
    configured_ticket_contract_id
  )
  ON CONFLICT (request_idempotency_key) DO NOTHING
  RETURNING *
  INTO operation;

  IF NOT FOUND THEN
    SELECT *
    INTO STRICT operation
    FROM public.purchase_operations
    WHERE request_idempotency_key = requested_idempotency_key
      AND user_id = operation_owner_id;
  END IF;

  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_purchase_operation(
  uuid, uuid, text, text, bigint, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_purchase_operation(
  uuid, uuid, text, text, bigint, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.begin_purchase_attempt(
  operation_owner_id uuid,
  requested_operation_id uuid,
  provided_unsigned_envelope_hash text,
  provided_source_sequence text,
  provided_transaction_max_time bigint,
  provided_estimated_fee_stroops bigint
)
RETURNS public.purchase_operation_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.purchase_operations%ROWTYPE;
  attempt public.purchase_operation_attempts%ROWTYPE;
  next_attempt integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(requested_operation_id::text, 0));

  SELECT *
  INTO operation
  FROM public.purchase_operations
  WHERE operation_id = requested_operation_id
    AND user_id = operation_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase operation not found.';
  END IF;

  SELECT *
  INTO attempt
  FROM public.purchase_operation_attempts
  WHERE operation_id = requested_operation_id
    AND unsigned_envelope_hash = provided_unsigned_envelope_hash;

  IF FOUND THEN
    IF attempt.state = 'pre_submission_failed'
       AND operation.state IN ('preparing', 'pre_submission_failed') THEN
      UPDATE public.purchase_operation_attempts
      SET
        state = 'approval_required',
        failure_category = NULL,
        failure_detail = NULL,
        prepared_at = now(),
        resolved_at = NULL
      WHERE operation_id = requested_operation_id
        AND attempt_number = attempt.attempt_number
      RETURNING *
      INTO attempt;

      UPDATE public.purchase_operations
      SET
        state = 'approval_required',
        current_attempt_number = attempt.attempt_number,
        estimated_fee_stroops = provided_estimated_fee_stroops,
        failure_category = NULL,
        failure_detail = NULL,
        updated_at = now()
      WHERE operation_id = requested_operation_id;
    END IF;
    RETURN attempt;
  END IF;

  IF operation.state NOT IN ('review', 'preparing', 'pre_submission_failed') THEN
    RAISE EXCEPTION 'This purchase operation already has an unresolved attempt.';
  END IF;

  next_attempt := operation.current_attempt_number + 1;
  INSERT INTO public.purchase_operation_attempts (
    operation_id,
    attempt_number,
    external_id,
    unsigned_envelope_hash,
    source_sequence,
    transaction_max_time,
    estimated_fee_stroops,
    state
  )
  VALUES (
    requested_operation_id,
    next_attempt,
    concat(
      'purchase:',
      requested_operation_id,
      ':',
      next_attempt,
      ':',
      provided_unsigned_envelope_hash
    ),
    provided_unsigned_envelope_hash,
    provided_source_sequence,
    provided_transaction_max_time,
    provided_estimated_fee_stroops,
    'approval_required'
  )
  RETURNING *
  INTO attempt;

  UPDATE public.purchase_operations
  SET
    state = 'approval_required',
    current_attempt_number = next_attempt,
    estimated_fee_stroops = provided_estimated_fee_stroops,
    failure_category = NULL,
    failure_detail = NULL,
    updated_at = now()
  WHERE operation_id = requested_operation_id;

  RETURN attempt;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_purchase_attempt(
  uuid, uuid, text, text, bigint, bigint
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.begin_purchase_attempt(
  uuid, uuid, text, text, bigint, bigint
) TO service_role;
