-- Slice 1 / Phase 2: truthful event metadata and trusted publication.
-- Private, user-owned preparation rows stay separate from the published
-- events read model so ticket/listing foreign keys never point at drafts.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS end_unix bigint,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS organizer_display_name text,
  ADD COLUMN IF NOT EXISTS support_contact text,
  ADD COLUMN IF NOT EXISTS refund_policy_code text,
  ADD COLUMN IF NOT EXISTS resale_policy_code text,
  ADD COLUMN IF NOT EXISTS entry_instructions text,
  ADD COLUMN IF NOT EXISTS network text,
  ADD COLUMN IF NOT EXISTS ticket_contract_id text,
  ADD COLUMN IF NOT EXISTS creation_tx_hash text,
  ADD COLUMN IF NOT EXISTS chain_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_end_after_start,
  ADD CONSTRAINT events_end_after_start
    CHECK (end_unix IS NULL OR (date_unix IS NOT NULL AND end_unix > date_unix)) NOT VALID,
  DROP CONSTRAINT IF EXISTS events_refund_policy_code,
  ADD CONSTRAINT events_refund_policy_code
    CHECK (refund_policy_code IS NULL OR refund_policy_code = 'cancelled_event_original_price') NOT VALID,
  DROP CONSTRAINT IF EXISTS events_resale_policy_code,
  ADD CONSTRAINT events_resale_policy_code
    CHECK (resale_policy_code IS NULL OR resale_policy_code = 'stellar_marketplace_unlocked') NOT VALID;

CREATE TABLE IF NOT EXISTS public.event_publication_drafts (
  draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL UNIQUE,
  intended_organizer_address text NOT NULL,
  expected_name text NOT NULL,
  expected_date_unix bigint NOT NULL,
  expected_capacity bigint NOT NULL CHECK (expected_capacity > 0),
  expected_price_per_ticket bigint NOT NULL CHECK (expected_price_per_ticket > 0),
  network text NOT NULL,
  ticket_contract_id text NOT NULL,
  summary text NOT NULL,
  description text NOT NULL,
  image_url text NOT NULL,
  category text NOT NULL,
  timezone text NOT NULL,
  end_unix bigint NOT NULL,
  venue text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  organizer_display_name text NOT NULL,
  support_contact text NOT NULL,
  refund_policy_code text NOT NULL DEFAULT 'cancelled_event_original_price'
    CHECK (refund_policy_code = 'cancelled_event_original_price'),
  resale_policy_code text NOT NULL DEFAULT 'stellar_marketplace_unlocked'
    CHECK (resale_policy_code = 'stellar_marketplace_unlocked'),
  entry_instructions text NOT NULL,
  state text NOT NULL DEFAULT 'prepared'
    CHECK (state IN (
      'prepared',
      'creation_submitting',
      'chain_created',
      'publication_failed',
      'published'
    )),
  creation_tx_hash text,
  last_error text,
  chain_verified_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_unix > expected_date_unix),
  CHECK (
    btrim(event_id) <> '' AND
    btrim(intended_organizer_address) <> '' AND
    btrim(expected_name) <> '' AND
    btrim(network) <> '' AND
    btrim(ticket_contract_id) <> '' AND
    btrim(summary) <> '' AND
    btrim(description) <> '' AND
    btrim(image_url) <> '' AND
    btrim(category) <> '' AND
    btrim(timezone) <> '' AND
    btrim(venue) <> '' AND
    btrim(address) <> '' AND
    btrim(city) <> '' AND
    btrim(organizer_display_name) <> '' AND
    btrim(support_contact) <> '' AND
    btrim(entry_instructions) <> ''
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_event_publication_draft_per_user
  ON public.event_publication_drafts (user_id)
  WHERE state <> 'published';

ALTER TABLE public.event_publication_drafts ENABLE ROW LEVEL SECURITY;

REVOKE UPDATE ON public.event_publication_drafts FROM authenticated;
GRANT UPDATE (
  expected_name,
  expected_date_unix,
  expected_capacity,
  expected_price_per_ticket,
  summary,
  description,
  image_url,
  category,
  timezone,
  end_unix,
  venue,
  address,
  city,
  organizer_display_name,
  support_contact,
  entry_instructions,
  updated_at
) ON public.event_publication_drafts TO authenticated;

DROP POLICY IF EXISTS "Users read own event publication drafts"
  ON public.event_publication_drafts;
CREATE POLICY "Users read own event publication drafts"
  ON public.event_publication_drafts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create prepared event publication drafts"
  ON public.event_publication_drafts;
CREATE POLICY "Users create prepared event publication drafts"
  ON public.event_publication_drafts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    state = 'prepared' AND
    creation_tx_hash IS NULL AND
    last_error IS NULL AND
    chain_verified_at IS NULL AND
    published_at IS NULL
  );

DROP POLICY IF EXISTS "Users edit own prepared event publication drafts"
  ON public.event_publication_drafts;
CREATE POLICY "Users edit own prepared event publication drafts"
  ON public.event_publication_drafts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND state = 'prepared')
  WITH CHECK (
    user_id = auth.uid() AND
    state = 'prepared' AND
    creation_tx_hash IS NULL AND
    last_error IS NULL AND
    chain_verified_at IS NULL AND
    published_at IS NULL
  );

-- The browser may no longer write trusted published event rows.
DROP POLICY IF EXISTS "Enable read access for all users on events" ON public.events;
DROP POLICY IF EXISTS "Enable insert access for all users on events" ON public.events;
DROP POLICY IF EXISTS "Enable update access for all users on events" ON public.events;
REVOKE INSERT, UPDATE, DELETE ON public.events FROM anon, authenticated;
GRANT SELECT ON public.events TO anon, authenticated;

DROP POLICY IF EXISTS "Read trusted published events" ON public.events;
CREATE POLICY "Read trusted published events"
  ON public.events
  FOR SELECT TO anon, authenticated
  USING (chain_verified_at IS NOT NULL);

CREATE OR REPLACE VIEW public.published_events
WITH (security_barrier = true, security_invoker = true)
AS
SELECT
  event_id,
  organizer_address,
  name,
  summary,
  description,
  image_url,
  category,
  date_unix,
  end_unix,
  timezone,
  venue,
  address,
  city,
  organizer_display_name,
  support_contact,
  refund_policy_code,
  resale_policy_code,
  entry_instructions,
  status,
  current_supply,
  capacity,
  price_per_ticket,
  network,
  ticket_contract_id,
  creation_tx_hash,
  chain_verified_at,
  created_at,
  updated_at
FROM public.events
WHERE
  chain_verified_at IS NOT NULL AND
  btrim(event_id) <> '' AND
  btrim(organizer_address) <> '' AND
  btrim(name) <> '' AND
  btrim(summary) <> '' AND
  btrim(description) <> '' AND
  btrim(image_url) <> '' AND
  btrim(category) <> '' AND
  date_unix IS NOT NULL AND
  end_unix > date_unix AND
  btrim(timezone) <> '' AND
  btrim(venue) <> '' AND
  btrim(address) <> '' AND
  btrim(city) <> '' AND
  btrim(organizer_display_name) <> '' AND
  btrim(support_contact) <> '' AND
  refund_policy_code = 'cancelled_event_original_price' AND
  resale_policy_code = 'stellar_marketplace_unlocked' AND
  btrim(entry_instructions) <> '' AND
  status IN ('Active', 'Cancelled', 'Completed') AND
  capacity > 0 AND
  current_supply >= 0 AND
  price_per_ticket > 0 AND
  btrim(network) <> '' AND
  btrim(ticket_contract_id) <> '' AND
  btrim(creation_tx_hash) <> '';

CREATE OR REPLACE VIEW public.discoverable_events
WITH (security_barrier = true, security_invoker = true)
AS
SELECT *
FROM public.published_events
WHERE
  status = 'Active' AND
  date_unix > extract(epoch FROM now())::bigint;

REVOKE ALL ON public.published_events FROM PUBLIC;
REVOKE ALL ON public.discoverable_events FROM PUBLIC;
GRANT SELECT ON public.published_events TO anon, authenticated;
GRANT SELECT ON public.discoverable_events TO anon, authenticated;

-- Called only by the trusted Edge Function after its Stellar read succeeds.
-- The function rechecks the stored expected values and promotes the draft and
-- published row atomically.
CREATE OR REPLACE FUNCTION public.publish_verified_event(
  draft_owner_id uuid,
  reserved_event_id text,
  verified_organizer_address text,
  verified_name text,
  verified_date_unix bigint,
  verified_capacity bigint,
  verified_price_per_ticket bigint,
  verified_current_supply bigint,
  verified_status text,
  verified_transaction_hash text,
  verified_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  draft public.event_publication_drafts%ROWTYPE;
BEGIN
  SELECT *
  INTO draft
  FROM public.event_publication_drafts
  WHERE user_id = draft_owner_id
    AND event_id = reserved_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publication draft not found';
  END IF;

  IF draft.state = 'published' THEN
    RETURN;
  END IF;

  IF verified_organizer_address <> draft.intended_organizer_address
    OR verified_name <> draft.expected_name
    OR verified_date_unix <> draft.expected_date_unix
    OR verified_capacity <> draft.expected_capacity
    OR verified_price_per_ticket <> draft.expected_price_per_ticket THEN
    RAISE EXCEPTION 'Authoritative event does not match the reserved draft';
  END IF;

  IF verified_status NOT IN ('Active', 'Cancelled', 'Completed')
    OR verified_current_supply < 0
    OR verified_current_supply > verified_capacity
    OR btrim(verified_transaction_hash) = '' THEN
    RAISE EXCEPTION 'Authoritative event state is invalid';
  END IF;

  INSERT INTO public.events (
    event_id,
    organizer_address,
    name,
    summary,
    description,
    image_url,
    category,
    date_unix,
    end_unix,
    timezone,
    venue,
    address,
    city,
    organizer_display_name,
    support_contact,
    refund_policy_code,
    resale_policy_code,
    entry_instructions,
    status,
    current_supply,
    capacity,
    price_per_ticket,
    network,
    ticket_contract_id,
    creation_tx_hash,
    chain_verified_at,
    updated_at
  ) VALUES (
    draft.event_id,
    verified_organizer_address,
    verified_name,
    draft.summary,
    draft.description,
    draft.image_url,
    draft.category,
    verified_date_unix,
    draft.end_unix,
    draft.timezone,
    draft.venue,
    draft.address,
    draft.city,
    draft.organizer_display_name,
    draft.support_contact,
    draft.refund_policy_code,
    draft.resale_policy_code,
    draft.entry_instructions,
    verified_status,
    verified_current_supply,
    verified_capacity,
    verified_price_per_ticket,
    draft.network,
    draft.ticket_contract_id,
    verified_transaction_hash,
    verified_at,
    now()
  )
  ON CONFLICT (event_id) DO UPDATE SET
    organizer_address = EXCLUDED.organizer_address,
    name = EXCLUDED.name,
    summary = EXCLUDED.summary,
    description = EXCLUDED.description,
    image_url = EXCLUDED.image_url,
    category = EXCLUDED.category,
    date_unix = EXCLUDED.date_unix,
    end_unix = EXCLUDED.end_unix,
    timezone = EXCLUDED.timezone,
    venue = EXCLUDED.venue,
    address = EXCLUDED.address,
    city = EXCLUDED.city,
    organizer_display_name = EXCLUDED.organizer_display_name,
    support_contact = EXCLUDED.support_contact,
    refund_policy_code = EXCLUDED.refund_policy_code,
    resale_policy_code = EXCLUDED.resale_policy_code,
    entry_instructions = EXCLUDED.entry_instructions,
    status = EXCLUDED.status,
    current_supply = EXCLUDED.current_supply,
    capacity = EXCLUDED.capacity,
    price_per_ticket = EXCLUDED.price_per_ticket,
    network = EXCLUDED.network,
    ticket_contract_id = EXCLUDED.ticket_contract_id,
    creation_tx_hash = EXCLUDED.creation_tx_hash,
    chain_verified_at = EXCLUDED.chain_verified_at,
    updated_at = now();

  UPDATE public.event_publication_drafts
  SET
    state = 'published',
    creation_tx_hash = verified_transaction_hash,
    last_error = NULL,
    chain_verified_at = verified_at,
    published_at = now(),
    updated_at = now()
  WHERE draft_id = draft.draft_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_verified_event(
  uuid, text, text, text, bigint, bigint, bigint, bigint, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_verified_event(
  uuid, text, text, text, bigint, bigint, bigint, bigint, text, text, timestamptz
) TO service_role;

-- Refresh only chain-owned preview fields after a trusted RPC read. This never
-- accepts organizer-authored metadata and remains service-role-only.
CREATE OR REPLACE FUNCTION public.refresh_verified_event_state(
  refreshed_event_id text,
  verified_current_supply bigint,
  verified_status text,
  verified_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF verified_status NOT IN ('Active', 'Cancelled', 'Completed')
    OR verified_current_supply < 0 THEN
    RAISE EXCEPTION 'Authoritative event state is invalid';
  END IF;

  UPDATE public.events
  SET
    status = verified_status,
    current_supply = verified_current_supply,
    chain_verified_at = verified_at,
    updated_at = now()
  WHERE event_id = refreshed_event_id
    AND chain_verified_at IS NOT NULL
    AND verified_current_supply <= capacity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trusted published event not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_verified_event_state(
  text, bigint, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_verified_event_state(
  text, bigint, text, timestamptz
) TO service_role;
