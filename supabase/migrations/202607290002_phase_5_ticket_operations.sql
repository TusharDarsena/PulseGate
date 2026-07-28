-- Phase 5: recoverable refund and secondary-market operations.
--
-- Soroban owns ticket, refund, listing, and transfer truth. Browser clients
-- assemble, sign, and submit generated transactions, but only the trusted
-- ticket-operation service may reconcile confirmed outcomes into projections.

-- MarketplaceContract keys listings by (seller, listing_id). Align the mirror
-- with that authoritative identity before trusted upserts begin.
ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_pkey;
ALTER TABLE public.listings
  ADD CONSTRAINT listings_pkey PRIMARY KEY (seller_address, listing_id);

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS state_verified_ledger_sequence bigint,
  ADD COLUMN IF NOT EXISTS state_verified_at timestamptz;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS network text,
  ADD COLUMN IF NOT EXISTS ticket_contract_id text,
  ADD COLUMN IF NOT EXISTS marketplace_contract_id text,
  ADD COLUMN IF NOT EXISTS state_verified_ledger_sequence bigint,
  ADD COLUMN IF NOT EXISTS state_verified_at timestamptz;

CREATE TABLE public.ticket_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_idempotency_key uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_type text NOT NULL
    CHECK (operation_type IN (
      'refund',
      'create_listing',
      'cancel_listing',
      'buy_listing'
    )),
  actor_address text NOT NULL,
  ticket_id text NOT NULL,
  event_id text NOT NULL,
  seller_address text,
  buyer_address text,
  listing_id text,
  amount_stroops bigint NOT NULL CHECK (amount_stroops > 0),
  network text NOT NULL,
  ticket_contract_id text NOT NULL,
  marketplace_contract_id text NOT NULL,
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
  verified_event_entity_id text,
  verified_event_actor text,
  verified_event_amount_stroops bigint,
  verified_ledger_sequence bigint,
  verified_ledger_closed_at timestamptz,
  confirmed_at timestamptz,
  synchronized_at timestamptz,
  failure_category text,
  failure_detail text CHECK (failure_detail IS NULL OR length(failure_detail) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (btrim(actor_address) <> ''),
  CHECK (btrim(ticket_id) <> ''),
  CHECK (btrim(event_id) <> ''),
  CHECK (btrim(network) <> ''),
  CHECK (btrim(ticket_contract_id) <> ''),
  CHECK (btrim(marketplace_contract_id) <> ''),
  CHECK (
    operation_type = 'refund'
    OR (
      seller_address IS NOT NULL
      AND btrim(seller_address) <> ''
      AND listing_id IS NOT NULL
      AND btrim(listing_id) <> ''
    )
  ),
  CHECK (
    operation_type <> 'buy_listing'
    OR (
      buyer_address IS NOT NULL
      AND btrim(buyer_address) <> ''
      AND buyer_address = actor_address
      AND buyer_address <> seller_address
    )
  ),
  CHECK (
    operation_type NOT IN ('create_listing', 'cancel_listing')
    OR actor_address = seller_address
  ),
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
    OR verified_event_topic IN ('tk_refund', 'mk_list', 'mk_cancel', 'mk_sold')
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

CREATE INDEX ticket_operations_owner_updated
  ON public.ticket_operations (user_id, updated_at DESC);
CREATE INDEX ticket_operations_signed_hash
  ON public.ticket_operations (signed_transaction_hash)
  WHERE signed_transaction_hash IS NOT NULL;
CREATE INDEX ticket_operations_ticket
  ON public.ticket_operations (network, ticket_contract_id, ticket_id);
CREATE INDEX ticket_operations_listing
  ON public.ticket_operations (
    network,
    marketplace_contract_id,
    seller_address,
    listing_id
  )
  WHERE listing_id IS NOT NULL;
CREATE UNIQUE INDEX ticket_operations_one_user_business_action
  ON public.ticket_operations (
    user_id,
    operation_type,
    network,
    ticket_contract_id,
    marketplace_contract_id,
    ticket_id,
    COALESCE(seller_address, ''),
    COALESCE(listing_id, '')
  );

ALTER TABLE public.ticket_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own ticket operations"
  ON public.ticket_operations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.ticket_operations FROM anon, authenticated;
GRANT SELECT ON public.ticket_operations TO authenticated;

-- Remove the remaining browser-owned economic projection writes. Reads remain
-- public for discovery; service-role finalizers own mutations.
DO $$
DECLARE policy_record record;
BEGIN
  FOR policy_record IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('listings', 'tickets')
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  END LOOP;
END;
$$;
REVOKE INSERT, UPDATE, DELETE ON public.listings FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.tickets FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.allocate_ticket_operation(
  operation_owner_id uuid,
  requested_idempotency_key uuid,
  requested_operation_type text,
  resolved_actor_address text,
  verified_ticket_id text,
  verified_event_id text,
  verified_seller_address text,
  verified_buyer_address text,
  verified_listing_id text,
  verified_amount_stroops bigint,
  configured_network text,
  configured_ticket_contract_id text,
  configured_marketplace_contract_id text
)
RETURNS public.ticket_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.ticket_operations%ROWTYPE;
  lock_key text;
BEGIN
  IF operation_owner_id IS NULL
     OR requested_idempotency_key IS NULL
     OR requested_operation_type NOT IN (
       'refund', 'create_listing', 'cancel_listing', 'buy_listing'
     )
     OR resolved_actor_address IS NULL OR btrim(resolved_actor_address) = ''
     OR verified_ticket_id IS NULL OR btrim(verified_ticket_id) = ''
     OR verified_event_id IS NULL OR btrim(verified_event_id) = ''
     OR verified_amount_stroops IS NULL OR verified_amount_stroops <= 0
     OR configured_network IS NULL OR btrim(configured_network) = ''
     OR configured_ticket_contract_id IS NULL OR btrim(configured_ticket_contract_id) = ''
     OR configured_marketplace_contract_id IS NULL
     OR btrim(configured_marketplace_contract_id) = '' THEN
    RAISE EXCEPTION 'Complete ticket-operation identity is required.';
  END IF;

  IF requested_operation_type <> 'refund'
     AND (
       verified_seller_address IS NULL OR btrim(verified_seller_address) = ''
       OR verified_listing_id IS NULL OR btrim(verified_listing_id) = ''
     ) THEN
    RAISE EXCEPTION 'Complete listing identity is required.';
  END IF;

  lock_key := concat_ws(
    ':',
    operation_owner_id,
    requested_operation_type,
    configured_network,
    configured_ticket_contract_id,
    configured_marketplace_contract_id,
    verified_ticket_id,
    COALESCE(verified_seller_address, ''),
    COALESCE(verified_listing_id, '')
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  SELECT * INTO operation
  FROM public.ticket_operations
  WHERE user_id = operation_owner_id
    AND operation_type = requested_operation_type
    AND network = configured_network
    AND ticket_contract_id = configured_ticket_contract_id
    AND marketplace_contract_id = configured_marketplace_contract_id
    AND ticket_id = verified_ticket_id
    AND seller_address IS NOT DISTINCT FROM verified_seller_address
    AND listing_id IS NOT DISTINCT FROM verified_listing_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN operation;
  END IF;

  INSERT INTO public.ticket_operations (
    request_idempotency_key,
    user_id,
    operation_type,
    actor_address,
    ticket_id,
    event_id,
    seller_address,
    buyer_address,
    listing_id,
    amount_stroops,
    network,
    ticket_contract_id,
    marketplace_contract_id
  )
  VALUES (
    requested_idempotency_key,
    operation_owner_id,
    requested_operation_type,
    resolved_actor_address,
    verified_ticket_id,
    verified_event_id,
    verified_seller_address,
    verified_buyer_address,
    verified_listing_id,
    verified_amount_stroops,
    configured_network,
    configured_ticket_contract_id,
    configured_marketplace_contract_id
  )
  ON CONFLICT (request_idempotency_key) DO NOTHING
  RETURNING * INTO operation;

  IF FOUND THEN
    RETURN operation;
  END IF;

  SELECT * INTO operation
  FROM public.ticket_operations
  WHERE request_idempotency_key = requested_idempotency_key
    AND user_id = operation_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Could not allocate ticket operation.';
  END IF;
  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_ticket_operation(
  uuid, uuid, text, text, text, text, text, text, text, bigint, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_ticket_operation(
  uuid, uuid, text, text, text, text, text, text, text, bigint, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_ticket_operation(
  requested_operation_id uuid,
  p_verified_transaction_hash text,
  p_verified_event_topic text,
  p_verified_event_entity_id text,
  p_verified_event_actor text,
  p_verified_event_amount_stroops bigint,
  p_verified_ledger_sequence bigint,
  p_verified_ledger_closed_at timestamptz
)
RETURNS public.ticket_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.ticket_operations%ROWTYPE;
  expected_topic text;
  expected_entity_id text;
BEGIN
  SELECT * INTO operation
  FROM public.ticket_operations
  WHERE operation_id = requested_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket operation not found.';
  END IF;

  expected_topic := CASE operation.operation_type
    WHEN 'refund' THEN 'tk_refund'
    WHEN 'create_listing' THEN 'mk_list'
    WHEN 'cancel_listing' THEN 'mk_cancel'
    WHEN 'buy_listing' THEN 'mk_sold'
  END;
  expected_entity_id := CASE
    WHEN operation.operation_type = 'refund' THEN operation.ticket_id
    ELSE operation.listing_id
  END;

  IF operation.signed_transaction_hash IS DISTINCT FROM p_verified_transaction_hash
     OR expected_topic IS DISTINCT FROM p_verified_event_topic
     OR expected_entity_id IS DISTINCT FROM p_verified_event_entity_id
     OR operation.actor_address IS DISTINCT FROM p_verified_event_actor
     OR p_verified_ledger_sequence IS NULL
     OR p_verified_ledger_closed_at IS NULL THEN
    RAISE EXCEPTION 'Verified Stellar proof does not match the ticket operation.';
  END IF;
  IF operation.operation_type IN ('refund', 'create_listing', 'buy_listing')
     AND operation.amount_stroops IS DISTINCT FROM p_verified_event_amount_stroops THEN
    RAISE EXCEPTION 'Verified Stellar amount does not match the ticket operation.';
  END IF;

  IF operation.state IN ('chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete') THEN
    IF operation.verified_ledger_sequence IS DISTINCT FROM p_verified_ledger_sequence THEN
      RAISE EXCEPTION 'Ticket operation is already confirmed by another ledger.';
    END IF;
    RETURN operation;
  END IF;
  IF operation.state NOT IN (
    'signed_submission_pending', 'confirmation_pending', 'status_unknown'
  ) THEN
    RAISE EXCEPTION 'Ticket operation is not ready for confirmation.';
  END IF;

  UPDATE public.ticket_operations
  SET state = 'chain_confirmed',
      verified_event_topic = p_verified_event_topic,
      verified_event_entity_id = p_verified_event_entity_id,
      verified_event_actor = p_verified_event_actor,
      verified_event_amount_stroops = p_verified_event_amount_stroops,
      verified_ledger_sequence = p_verified_ledger_sequence,
      verified_ledger_closed_at = p_verified_ledger_closed_at,
      confirmed_at = COALESCE(confirmed_at, p_verified_ledger_closed_at),
      failure_category = NULL,
      failure_detail = NULL,
      updated_at = now()
  WHERE operation_id = requested_operation_id
  RETURNING * INTO operation;
  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_ticket_operation(
  uuid, text, text, text, text, bigint, bigint, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_ticket_operation(
  uuid, text, text, text, text, bigint, bigint, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_ticket_operation_sync(
  requested_operation_id uuid,
  verified_ticket_id text,
  verified_event_id text,
  verified_ticket_owner text,
  verified_ticket_status text,
  verified_listing_seller text,
  verified_listing_id text,
  verified_listing_ticket_id text,
  verified_listing_event_id text,
  verified_listing_ask_price bigint,
  verified_listing_status text,
  verified_observation_ledger_sequence bigint,
  verified_at timestamptz,
  verified_network text,
  verified_ticket_contract_id text,
  verified_marketplace_contract_id text
)
RETURNS public.ticket_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.ticket_operations%ROWTYPE;
BEGIN
  SELECT * INTO operation
  FROM public.ticket_operations
  WHERE operation_id = requested_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket operation not found.';
  END IF;
  IF operation.state = 'complete' THEN
    RETURN operation;
  END IF;
  IF operation.state NOT IN ('chain_confirmed', 'mirror_syncing', 'sync_warning') THEN
    RAISE EXCEPTION 'Ticket operation is not ready for synchronization.';
  END IF;
  IF operation.ticket_id IS DISTINCT FROM verified_ticket_id
     OR operation.event_id IS DISTINCT FROM verified_event_id
     OR operation.network IS DISTINCT FROM verified_network
     OR operation.ticket_contract_id IS DISTINCT FROM verified_ticket_contract_id
     OR operation.marketplace_contract_id IS DISTINCT FROM verified_marketplace_contract_id
     OR verified_ticket_owner IS NULL OR btrim(verified_ticket_owner) = ''
     OR verified_ticket_status NOT IN ('Active', 'Used', 'Refunded')
     OR verified_observation_ledger_sequence IS NULL
     OR verified_observation_ledger_sequence < operation.verified_ledger_sequence THEN
    RAISE EXCEPTION 'Authoritative ticket state does not match the operation.';
  END IF;

  IF operation.operation_type = 'refund' THEN
    IF verified_ticket_owner IS DISTINCT FROM operation.actor_address
       OR verified_ticket_status <> 'Refunded'
       OR verified_listing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Authoritative refund state does not match the operation.';
    END IF;
  ELSE
    IF operation.seller_address IS DISTINCT FROM verified_listing_seller
       OR operation.listing_id IS DISTINCT FROM verified_listing_id
       OR operation.ticket_id IS DISTINCT FROM verified_listing_ticket_id
       OR operation.event_id IS DISTINCT FROM verified_listing_event_id
       OR operation.amount_stroops IS DISTINCT FROM verified_listing_ask_price
       OR verified_listing_status NOT IN ('Open', 'Sold', 'Cancelled') THEN
      RAISE EXCEPTION 'Authoritative listing state does not match the operation.';
    END IF;
    IF operation.operation_type = 'cancel_listing'
       AND verified_listing_status <> 'Cancelled' THEN
      RAISE EXCEPTION 'The listing is not authoritatively cancelled.';
    END IF;
    IF operation.operation_type = 'buy_listing'
       AND verified_listing_status <> 'Sold' THEN
      RAISE EXCEPTION 'The resale listing is not authoritatively sold.';
    END IF;
  END IF;

  INSERT INTO public.tickets AS existing (
    ticket_id,
    event_id,
    owner_address,
    status,
    purchased_at,
    state_verified_ledger_sequence,
    state_verified_at
  )
  VALUES (
    verified_ticket_id,
    verified_event_id,
    verified_ticket_owner,
    verified_ticket_status,
    COALESCE(operation.confirmed_at, verified_at),
    verified_observation_ledger_sequence,
    verified_at
  )
  ON CONFLICT (ticket_id) DO UPDATE SET
    event_id = EXCLUDED.event_id,
    owner_address = EXCLUDED.owner_address,
    status = EXCLUDED.status,
    state_verified_ledger_sequence = EXCLUDED.state_verified_ledger_sequence,
    state_verified_at = EXCLUDED.state_verified_at
  WHERE existing.state_verified_ledger_sequence IS NULL
     OR existing.state_verified_ledger_sequence <= EXCLUDED.state_verified_ledger_sequence;

  IF operation.operation_type <> 'refund' THEN
    INSERT INTO public.listings AS existing (
      seller_address,
      listing_id,
      ticket_id,
      event_id,
      ask_price_stroops,
      status,
      listed_at,
      network,
      ticket_contract_id,
      marketplace_contract_id,
      state_verified_ledger_sequence,
      state_verified_at
    )
    VALUES (
      verified_listing_seller,
      verified_listing_id,
      verified_listing_ticket_id,
      verified_listing_event_id,
      verified_listing_ask_price,
      verified_listing_status,
      COALESCE(operation.confirmed_at, verified_at),
      verified_network,
      verified_ticket_contract_id,
      verified_marketplace_contract_id,
      verified_observation_ledger_sequence,
      verified_at
    )
    ON CONFLICT (seller_address, listing_id) DO UPDATE SET
      ticket_id = EXCLUDED.ticket_id,
      event_id = EXCLUDED.event_id,
      ask_price_stroops = EXCLUDED.ask_price_stroops,
      status = EXCLUDED.status,
      network = EXCLUDED.network,
      ticket_contract_id = EXCLUDED.ticket_contract_id,
      marketplace_contract_id = EXCLUDED.marketplace_contract_id,
      state_verified_ledger_sequence = EXCLUDED.state_verified_ledger_sequence,
      state_verified_at = EXCLUDED.state_verified_at
    WHERE existing.state_verified_ledger_sequence IS NULL
       OR existing.state_verified_ledger_sequence <= EXCLUDED.state_verified_ledger_sequence;
  END IF;

  UPDATE public.ticket_operations
  SET state = 'complete',
      synchronized_at = COALESCE(synchronized_at, verified_at),
      failure_category = NULL,
      failure_detail = NULL,
      updated_at = now()
  WHERE operation_id = operation.operation_id
  RETURNING * INTO operation;
  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ticket_operation_sync(
  uuid, text, text, text, text, text, text, text, text, bigint, text,
  bigint, timestamptz, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_ticket_operation_sync(
  uuid, text, text, text, text, text, text, text, text, bigint, text,
  bigint, timestamptz, text, text, text
) TO service_role;
