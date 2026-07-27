-- Product Slice 2: durable organizer drafts, owner-derived event access,
-- revisioned public metadata, and recoverable terminal operations.
--
-- Soroban remains authoritative. This migration stores private preparation,
-- immutable transaction proof, and a discoverable mirror only after a trusted
-- Edge Function has verified the configured contract.

-- ---------------------------------------------------------------------------
-- Durable, incomplete, revisioned publication drafts
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.one_open_event_publication_draft_per_user;

ALTER TABLE public.event_publication_drafts
  DROP CONSTRAINT IF EXISTS event_publication_drafts_state_check,
  DROP CONSTRAINT IF EXISTS event_publication_drafts_expected_capacity_check,
  DROP CONSTRAINT IF EXISTS event_publication_drafts_expected_price_per_ticket_check,
  DROP CONSTRAINT IF EXISTS event_publication_drafts_check,
  DROP CONSTRAINT IF EXISTS event_publication_drafts_end_unix_check;

ALTER TABLE public.event_publication_drafts
  ALTER COLUMN intended_organizer_address DROP NOT NULL,
  ALTER COLUMN expected_name DROP NOT NULL,
  ALTER COLUMN expected_date_unix DROP NOT NULL,
  ALTER COLUMN expected_capacity DROP NOT NULL,
  ALTER COLUMN expected_price_per_ticket DROP NOT NULL,
  ALTER COLUMN summary DROP NOT NULL,
  ALTER COLUMN description DROP NOT NULL,
  ALTER COLUMN image_url DROP NOT NULL,
  ALTER COLUMN category DROP NOT NULL,
  ALTER COLUMN timezone DROP NOT NULL,
  ALTER COLUMN end_unix DROP NOT NULL,
  ALTER COLUMN venue DROP NOT NULL,
  ALTER COLUMN address DROP NOT NULL,
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN organizer_display_name DROP NOT NULL,
  ALTER COLUMN support_contact DROP NOT NULL,
  ALTER COLUMN entry_instructions DROP NOT NULL;

ALTER TABLE public.event_publication_drafts
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS completeness jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS accessibility_notes text,
  ADD COLUMN IF NOT EXISTS age_restriction text,
  ADD COLUMN IF NOT EXISTS prohibited_items text,
  ADD COLUMN IF NOT EXISTS map_url text,
  ADD COLUMN IF NOT EXISTS public_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS unsigned_envelope_hash text,
  ADD COLUMN IF NOT EXISTS signed_transaction_hash text,
  ADD COLUMN IF NOT EXISTS source_sequence text,
  ADD COLUMN IF NOT EXISTS transaction_max_time bigint,
  ADD COLUMN IF NOT EXISTS submission_replacement_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS creation_event_topic text,
  ADD COLUMN IF NOT EXISTS creation_event_id text,
  ADD COLUMN IF NOT EXISTS creation_ledger_sequence bigint,
  ADD COLUMN IF NOT EXISTS creation_ledger_closed_at timestamptz;

UPDATE public.event_publication_drafts
SET signed_transaction_hash = lower(creation_tx_hash)
WHERE signed_transaction_hash IS NULL
  AND creation_tx_hash IS NOT NULL;

ALTER TABLE public.event_publication_drafts
  ADD CONSTRAINT event_publication_drafts_state_check CHECK (
    state IN (
      'prepared',
      'creation_submitting',
      'approval_required',
      'signed_submission_pending',
      'confirmation_pending',
      'status_unknown',
      'chain_created',
      'chain_confirmed',
      'publication_failed',
      'sync_warning',
      'published'
    )
  ),
  ADD CONSTRAINT event_publication_drafts_revision_check CHECK (revision > 0),
  ADD CONSTRAINT event_publication_drafts_capacity_check
    CHECK (expected_capacity IS NULL OR expected_capacity > 0),
  ADD CONSTRAINT event_publication_drafts_price_check
    CHECK (expected_price_per_ticket IS NULL OR expected_price_per_ticket > 0),
  ADD CONSTRAINT event_publication_drafts_schedule_check
    CHECK (
      end_unix IS NULL
      OR expected_date_unix IS NULL
      OR end_unix > expected_date_unix
    ),
  ADD CONSTRAINT event_publication_drafts_public_links_check
    CHECK (jsonb_typeof(public_links) IN ('array', 'object')),
  ADD CONSTRAINT event_publication_drafts_unsigned_hash_check
    CHECK (
      unsigned_envelope_hash IS NULL
      OR unsigned_envelope_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT event_publication_drafts_signed_hash_check
    CHECK (
      signed_transaction_hash IS NULL
      OR signed_transaction_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT event_publication_drafts_source_sequence_check
    CHECK (source_sequence IS NULL OR source_sequence ~ '^[0-9]+$'),
  ADD CONSTRAINT event_publication_drafts_max_time_check
    CHECK (transaction_max_time IS NULL OR transaction_max_time > 0);

DROP POLICY IF EXISTS "Users create prepared event publication drafts"
  ON public.event_publication_drafts;
DROP POLICY IF EXISTS "Users edit own prepared event publication drafts"
  ON public.event_publication_drafts;
DROP POLICY IF EXISTS "Users delete own unpublished event publication drafts"
  ON public.event_publication_drafts;

REVOKE INSERT, UPDATE, DELETE ON public.event_publication_drafts
  FROM anon, authenticated;
GRANT SELECT ON public.event_publication_drafts TO authenticated;

CREATE OR REPLACE FUNCTION public.create_my_event_draft(
  configured_network text,
  configured_ticket_contract_id text
)
RETURNS public.event_publication_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid := auth.uid();
  draft public.event_publication_drafts%ROWTYPE;
BEGIN
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF configured_network IS NULL OR btrim(configured_network) = ''
     OR configured_ticket_contract_id IS NULL
     OR btrim(configured_ticket_contract_id) = '' THEN
    RAISE EXCEPTION 'Configured Stellar deployment is required';
  END IF;

  INSERT INTO public.event_publication_drafts (
    user_id,
    event_id,
    network,
    ticket_contract_id,
    state,
    revision
  )
  VALUES (
    owner_id,
    concat('evt_', replace(gen_random_uuid()::text, '-', '')),
    configured_network,
    configured_ticket_contract_id,
    'prepared',
    1
  )
  RETURNING * INTO draft;

  RETURN draft;
END;
$$;

REVOKE ALL ON FUNCTION public.create_my_event_draft(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_my_event_draft(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_event_drafts()
RETURNS SETOF public.event_publication_drafts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT draft.*
  FROM public.event_publication_drafts AS draft
  WHERE draft.user_id = auth.uid()
    AND draft.state <> 'published'
  ORDER BY draft.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_event_drafts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_event_drafts() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_event_draft(requested_draft_id uuid)
RETURNS SETOF public.event_publication_drafts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT draft.*
  FROM public.event_publication_drafts AS draft
  WHERE draft.user_id = auth.uid()
    AND draft.draft_id = requested_draft_id;
$$;

REVOKE ALL ON FUNCTION public.get_my_event_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_event_draft(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_my_event_draft(
  requested_draft_id uuid,
  expected_revision bigint,
  draft_patch jsonb
)
RETURNS public.event_publication_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid := auth.uid();
  saved public.event_publication_drafts%ROWTYPE;
  unknown_key text;
BEGIN
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF draft_patch IS NULL OR jsonb_typeof(draft_patch) <> 'object' THEN
    RAISE EXCEPTION 'Draft patch must be an object';
  END IF;

  SELECT key INTO unknown_key
  FROM jsonb_object_keys(draft_patch) AS key
  WHERE key NOT IN (
    'intended_organizer_address',
    'expected_name',
    'expected_date_unix',
    'end_unix',
    'expected_capacity',
    'expected_price_per_ticket',
    'summary',
    'description',
    'image_url',
    'category',
    'timezone',
    'venue',
    'address',
    'city',
    'map_url',
    'organizer_display_name',
    'support_contact',
    'entry_instructions',
    'accessibility_notes',
    'age_restriction',
    'prohibited_items',
    'public_links',
    'completeness'
  )
  LIMIT 1;
  IF unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported draft field: %', unknown_key;
  END IF;

  UPDATE public.event_publication_drafts AS draft
  SET
    intended_organizer_address = CASE
      WHEN draft_patch ? 'intended_organizer_address'
        THEN nullif(btrim(draft_patch ->> 'intended_organizer_address'), '')
      ELSE draft.intended_organizer_address
    END,
    expected_name = CASE
      WHEN draft_patch ? 'expected_name'
        THEN nullif(btrim(draft_patch ->> 'expected_name'), '')
      ELSE draft.expected_name
    END,
    expected_date_unix = CASE
      WHEN draft_patch ? 'expected_date_unix'
        THEN nullif(draft_patch ->> 'expected_date_unix', '')::bigint
      ELSE draft.expected_date_unix
    END,
    end_unix = CASE
      WHEN draft_patch ? 'end_unix'
        THEN nullif(draft_patch ->> 'end_unix', '')::bigint
      ELSE draft.end_unix
    END,
    expected_capacity = CASE
      WHEN draft_patch ? 'expected_capacity'
        THEN nullif(draft_patch ->> 'expected_capacity', '')::bigint
      ELSE draft.expected_capacity
    END,
    expected_price_per_ticket = CASE
      WHEN draft_patch ? 'expected_price_per_ticket'
        THEN nullif(draft_patch ->> 'expected_price_per_ticket', '')::bigint
      ELSE draft.expected_price_per_ticket
    END,
    summary = CASE WHEN draft_patch ? 'summary'
      THEN nullif(btrim(draft_patch ->> 'summary'), '') ELSE draft.summary END,
    description = CASE WHEN draft_patch ? 'description'
      THEN nullif(btrim(draft_patch ->> 'description'), '') ELSE draft.description END,
    image_url = CASE WHEN draft_patch ? 'image_url'
      THEN nullif(btrim(draft_patch ->> 'image_url'), '') ELSE draft.image_url END,
    category = CASE WHEN draft_patch ? 'category'
      THEN nullif(btrim(draft_patch ->> 'category'), '') ELSE draft.category END,
    timezone = CASE WHEN draft_patch ? 'timezone'
      THEN nullif(btrim(draft_patch ->> 'timezone'), '') ELSE draft.timezone END,
    venue = CASE WHEN draft_patch ? 'venue'
      THEN nullif(btrim(draft_patch ->> 'venue'), '') ELSE draft.venue END,
    address = CASE WHEN draft_patch ? 'address'
      THEN nullif(btrim(draft_patch ->> 'address'), '') ELSE draft.address END,
    city = CASE WHEN draft_patch ? 'city'
      THEN nullif(btrim(draft_patch ->> 'city'), '') ELSE draft.city END,
    map_url = CASE WHEN draft_patch ? 'map_url'
      THEN nullif(btrim(draft_patch ->> 'map_url'), '') ELSE draft.map_url END,
    organizer_display_name = CASE WHEN draft_patch ? 'organizer_display_name'
      THEN nullif(btrim(draft_patch ->> 'organizer_display_name'), '')
      ELSE draft.organizer_display_name END,
    support_contact = CASE WHEN draft_patch ? 'support_contact'
      THEN nullif(btrim(draft_patch ->> 'support_contact'), '')
      ELSE draft.support_contact END,
    entry_instructions = CASE WHEN draft_patch ? 'entry_instructions'
      THEN nullif(btrim(draft_patch ->> 'entry_instructions'), '')
      ELSE draft.entry_instructions END,
    accessibility_notes = CASE WHEN draft_patch ? 'accessibility_notes'
      THEN nullif(btrim(draft_patch ->> 'accessibility_notes'), '')
      ELSE draft.accessibility_notes END,
    age_restriction = CASE WHEN draft_patch ? 'age_restriction'
      THEN nullif(btrim(draft_patch ->> 'age_restriction'), '')
      ELSE draft.age_restriction END,
    prohibited_items = CASE WHEN draft_patch ? 'prohibited_items'
      THEN nullif(btrim(draft_patch ->> 'prohibited_items'), '')
      ELSE draft.prohibited_items END,
    public_links = CASE WHEN draft_patch ? 'public_links'
      THEN CASE
        WHEN jsonb_typeof(draft_patch -> 'public_links') = 'null'
          THEN '[]'::jsonb
        ELSE draft_patch -> 'public_links'
      END
      ELSE draft.public_links END,
    completeness = CASE WHEN draft_patch ? 'completeness'
      THEN COALESCE(draft_patch -> 'completeness', '{}'::jsonb)
      ELSE draft.completeness END,
    state = 'prepared',
    unsigned_envelope_hash = NULL,
    signed_transaction_hash = NULL,
    source_sequence = NULL,
    transaction_max_time = NULL,
    submission_replacement_allowed = false,
    creation_tx_hash = NULL,
    last_error = NULL,
    revision = draft.revision + 1,
    updated_at = now()
  WHERE draft.draft_id = requested_draft_id
    AND draft.user_id = owner_id
    AND (
      (draft.state = 'prepared' AND draft.signed_transaction_hash IS NULL)
      OR (
        draft.state = 'publication_failed'
        AND draft.submission_replacement_allowed
      )
    )
    AND draft.revision = expected_revision
  RETURNING draft.* INTO saved;

  IF FOUND THEN
    RETURN saved;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_publication_drafts
    WHERE draft_id = requested_draft_id AND user_id = owner_id
  ) THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.event_publication_drafts
    WHERE draft_id = requested_draft_id
      AND user_id = owner_id
      AND NOT (
        (state = 'prepared' AND signed_transaction_hash IS NULL)
        OR (state = 'publication_failed' AND submission_replacement_allowed)
      )
  ) THEN
    RAISE EXCEPTION 'Draft is frozen for publication';
  END IF;
  RAISE EXCEPTION USING
    ERRCODE = '40001',
    MESSAGE = 'Draft revision conflict';
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_event_draft(uuid, bigint, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_event_draft(uuid, bigint, jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_event_draft(
  requested_draft_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid := auth.uid();
BEGIN
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  DELETE FROM public.event_publication_drafts
  WHERE draft_id = requested_draft_id
    AND user_id = owner_id
    AND (
      (state = 'prepared' AND creation_tx_hash IS NULL AND signed_transaction_hash IS NULL)
      OR (state = 'publication_failed' AND submission_replacement_allowed)
    );
  IF FOUND THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_publication_drafts
    WHERE draft_id = requested_draft_id AND user_id = owner_id
  ) THEN
    RAISE EXCEPTION 'Only an unpublished editable draft can be deleted';
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_event_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_event_draft(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Revisioned supporting metadata on the existing published event read model
-- ---------------------------------------------------------------------------

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS accessibility_notes text,
  ADD COLUMN IF NOT EXISTS age_restriction text,
  ADD COLUMN IF NOT EXISTS prohibited_items text,
  ADD COLUMN IF NOT EXISTS map_url text,
  ADD COLUMN IF NOT EXISTS public_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS metadata_revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS metadata_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_updated_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_public_links_check,
  DROP CONSTRAINT IF EXISTS events_metadata_revision_check,
  ADD CONSTRAINT events_public_links_check
    CHECK (jsonb_typeof(public_links) IN ('array', 'object')),
  ADD CONSTRAINT events_metadata_revision_check CHECK (metadata_revision > 0);

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
  updated_at,
  accessibility_notes,
  age_restriction,
  prohibited_items,
  map_url,
  public_links,
  cancellation_reason,
  metadata_revision,
  metadata_updated_at
FROM public.events
WHERE
  chain_verified_at IS NOT NULL
  AND btrim(event_id) <> ''
  AND btrim(organizer_address) <> ''
  AND btrim(name) <> ''
  AND btrim(summary) <> ''
  AND btrim(description) <> ''
  AND btrim(image_url) <> ''
  AND btrim(category) <> ''
  AND date_unix IS NOT NULL
  AND end_unix > date_unix
  AND btrim(timezone) <> ''
  AND timezone IN (SELECT name FROM pg_timezone_names)
  AND btrim(venue) <> ''
  AND btrim(address) <> ''
  AND btrim(city) <> ''
  AND btrim(organizer_display_name) <> ''
  AND btrim(support_contact) <> ''
  AND refund_policy_code = 'cancelled_event_original_price'
  AND resale_policy_code = 'stellar_marketplace_unlocked'
  AND btrim(entry_instructions) <> ''
  AND status IN ('Active', 'Cancelled', 'Completed')
  AND capacity > 0
  AND current_supply >= 0
  AND current_supply <= capacity
  AND price_per_ticket > 0
  AND btrim(network) <> ''
  AND btrim(ticket_contract_id) <> ''
  AND btrim(creation_tx_hash) <> '';

CREATE OR REPLACE VIEW public.discoverable_events
WITH (security_barrier = true, security_invoker = true)
AS
SELECT *
FROM public.published_events
WHERE status = 'Active'
  AND date_unix > extract(epoch FROM now())::bigint;

REVOKE ALL ON public.published_events FROM PUBLIC;
REVOKE ALL ON public.discoverable_events FROM PUBLIC;
GRANT SELECT ON public.published_events TO anon, authenticated;
GRANT SELECT ON public.discoverable_events TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_organizer_events()
RETURNS TABLE (
  draft_id uuid,
  event_id text,
  intended_organizer_address text,
  publication_state text,
  publication_updated_at timestamptz,
  organizer_address text,
  name text,
  summary text,
  description text,
  image_url text,
  category text,
  date_unix bigint,
  end_unix bigint,
  timezone text,
  venue text,
  address text,
  city text,
  organizer_display_name text,
  support_contact text,
  refund_policy_code text,
  resale_policy_code text,
  entry_instructions text,
  status text,
  current_supply bigint,
  capacity bigint,
  price_per_ticket bigint,
  network text,
  ticket_contract_id text,
  creation_tx_hash text,
  chain_verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  accessibility_notes text,
  age_restriction text,
  prohibited_items text,
  map_url text,
  public_links jsonb,
  cancellation_reason text,
  metadata_revision bigint,
  metadata_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    draft.draft_id,
    draft.event_id,
    draft.intended_organizer_address,
    draft.state,
    draft.updated_at,
    event.organizer_address,
    event.name,
    event.summary,
    event.description,
    event.image_url,
    event.category,
    event.date_unix,
    event.end_unix,
    event.timezone,
    event.venue,
    event.address,
    event.city,
    event.organizer_display_name,
    event.support_contact,
    event.refund_policy_code,
    event.resale_policy_code,
    event.entry_instructions,
    event.status,
    event.current_supply,
    event.capacity,
    event.price_per_ticket,
    event.network,
    event.ticket_contract_id,
    event.creation_tx_hash,
    event.chain_verified_at,
    event.created_at,
    event.updated_at,
    event.accessibility_notes,
    event.age_restriction,
    event.prohibited_items,
    event.map_url,
    event.public_links,
    event.cancellation_reason,
    event.metadata_revision,
    event.metadata_updated_at
  FROM public.event_publication_drafts AS draft
  JOIN public.published_events AS event
    ON event.event_id = draft.event_id
   AND event.network = draft.network
   AND event.ticket_contract_id = draft.ticket_contract_id
  WHERE draft.user_id = auth.uid()
    AND draft.state = 'published'
  ORDER BY event.date_unix DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_organizer_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_organizer_events() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_organizer_event(
  requested_event_id text
)
RETURNS TABLE (
  draft_id uuid,
  event_id text,
  intended_organizer_address text,
  publication_state text,
  publication_updated_at timestamptz,
  organizer_address text,
  name text,
  summary text,
  description text,
  image_url text,
  category text,
  date_unix bigint,
  end_unix bigint,
  timezone text,
  venue text,
  address text,
  city text,
  organizer_display_name text,
  support_contact text,
  refund_policy_code text,
  resale_policy_code text,
  entry_instructions text,
  status text,
  current_supply bigint,
  capacity bigint,
  price_per_ticket bigint,
  network text,
  ticket_contract_id text,
  creation_tx_hash text,
  chain_verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  accessibility_notes text,
  age_restriction text,
  prohibited_items text,
  map_url text,
  public_links jsonb,
  cancellation_reason text,
  metadata_revision bigint,
  metadata_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT owned.*
  FROM public.get_my_organizer_events() AS owned
  WHERE owned.event_id = requested_event_id;
$$;

REVOKE ALL ON FUNCTION public.get_my_organizer_event(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_organizer_event(text) TO authenticated;

-- Only the verified publication service may promote a draft. The old
-- signature is removed so a successful transaction without exact ev_create
-- proof cannot publish through the legacy finalizer.
DROP FUNCTION IF EXISTS public.publish_verified_event(
  uuid, text, text, text, bigint, bigint, bigint, bigint, text, text, timestamptz
);

CREATE OR REPLACE FUNCTION public.publish_verified_event(
  draft_owner_id uuid,
  requested_draft_id uuid,
  reserved_event_id text,
  verified_organizer_address text,
  verified_name text,
  verified_date_unix bigint,
  verified_end_unix bigint,
  verified_capacity bigint,
  verified_price_per_ticket bigint,
  verified_current_supply bigint,
  verified_status text,
  verified_transaction_hash text,
  verified_event_topic text,
  verified_event_id text,
  verified_ledger_sequence bigint,
  verified_ledger_closed_at timestamptz,
  verified_at timestamptz
)
RETURNS public.event_publication_drafts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  draft public.event_publication_drafts%ROWTYPE;
  existing_event public.events%ROWTYPE;
BEGIN
  SELECT * INTO draft
  FROM public.event_publication_drafts
  WHERE draft_id = requested_draft_id
    AND user_id = draft_owner_id
    AND event_id = reserved_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publication draft not found';
  END IF;

  IF draft.state = 'published' THEN
    IF draft.creation_tx_hash IS DISTINCT FROM verified_transaction_hash THEN
      RAISE EXCEPTION 'Published draft transaction identity conflicts';
    END IF;
    RETURN draft;
  END IF;

  IF draft.state NOT IN ('chain_confirmed', 'sync_warning', 'chain_created') THEN
    RAISE EXCEPTION 'Draft is not ready for publication synchronization';
  END IF;
  IF draft.signed_transaction_hash IS DISTINCT FROM verified_transaction_hash
     OR verified_event_topic <> 'ev_create'
     OR verified_event_id <> draft.event_id
     OR verified_organizer_address IS DISTINCT FROM draft.intended_organizer_address
     OR verified_name IS DISTINCT FROM draft.expected_name
     OR verified_date_unix IS DISTINCT FROM draft.expected_date_unix
     OR verified_end_unix IS DISTINCT FROM draft.end_unix
     OR verified_capacity IS DISTINCT FROM draft.expected_capacity
     OR verified_price_per_ticket IS DISTINCT FROM draft.expected_price_per_ticket THEN
    RAISE EXCEPTION 'Authoritative ev_create proof does not match the reserved draft';
  END IF;
  IF verified_status <> 'Active'
     OR verified_current_supply <> 0
     OR verified_end_unix <= verified_date_unix
     OR verified_ledger_sequence <= 0
     OR verified_ledger_closed_at IS NULL THEN
    RAISE EXCEPTION 'Authoritative event creation state is invalid';
  END IF;
  IF draft.expected_name IS NULL
     OR draft.summary IS NULL
     OR draft.description IS NULL
     OR draft.image_url IS NULL
     OR draft.category IS NULL
     OR draft.timezone IS NULL
     OR draft.venue IS NULL
     OR draft.address IS NULL
     OR draft.city IS NULL
     OR draft.organizer_display_name IS NULL
     OR draft.support_contact IS NULL
     OR draft.entry_instructions IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_timezone_names WHERE name = draft.timezone
     ) THEN
    RAISE EXCEPTION 'Publication draft is incomplete';
  END IF;

  SELECT * INTO existing_event
  FROM public.events
  WHERE event_id = draft.event_id
  FOR UPDATE;
  IF FOUND AND (
    existing_event.network IS DISTINCT FROM draft.network
    OR existing_event.ticket_contract_id IS DISTINCT FROM draft.ticket_contract_id
    OR existing_event.creation_tx_hash IS DISTINCT FROM verified_transaction_hash
  ) THEN
    RAISE EXCEPTION 'Published event identity conflicts with the verified draft';
  END IF;

  INSERT INTO public.events AS current (
    event_id, organizer_address, name, summary, description, image_url, category,
    date_unix, end_unix, timezone, venue, address, city, organizer_display_name,
    support_contact, refund_policy_code, resale_policy_code, entry_instructions,
    accessibility_notes, age_restriction, prohibited_items, map_url, public_links,
    status, current_supply, capacity, price_per_ticket, network,
    ticket_contract_id, creation_tx_hash, chain_verified_at, metadata_revision,
    metadata_updated_at, metadata_updated_by, updated_at
  ) VALUES (
    draft.event_id, verified_organizer_address, verified_name, draft.summary,
    draft.description, draft.image_url, draft.category, verified_date_unix,
    verified_end_unix, draft.timezone, draft.venue, draft.address, draft.city,
    draft.organizer_display_name, draft.support_contact, draft.refund_policy_code,
    draft.resale_policy_code, draft.entry_instructions, draft.accessibility_notes,
    draft.age_restriction, draft.prohibited_items, draft.map_url,
    draft.public_links, verified_status, verified_current_supply,
    verified_capacity, verified_price_per_ticket, draft.network,
    draft.ticket_contract_id, verified_transaction_hash, verified_at, 1,
    verified_at, draft.user_id, now()
  )
  ON CONFLICT (event_id) DO UPDATE SET
    status = EXCLUDED.status,
    current_supply = EXCLUDED.current_supply,
    chain_verified_at = EXCLUDED.chain_verified_at,
    updated_at = now();

  UPDATE public.event_publication_drafts
  SET
    state = 'published',
    creation_tx_hash = verified_transaction_hash,
    signed_transaction_hash = verified_transaction_hash,
    creation_event_topic = verified_event_topic,
    creation_event_id = verified_event_id,
    creation_ledger_sequence = verified_ledger_sequence,
    creation_ledger_closed_at = verified_ledger_closed_at,
    chain_verified_at = verified_at,
    submission_replacement_allowed = false,
    published_at = COALESCE(published_at, verified_at),
    last_error = NULL,
    updated_at = now()
  WHERE draft_id = draft.draft_id
  RETURNING * INTO draft;

  RETURN draft;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_verified_event(
  uuid, uuid, text, text, text, bigint, bigint, bigint, bigint, bigint, text,
  text, text, text, bigint, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_verified_event(
  uuid, uuid, text, text, text, bigint, bigint, bigint, bigint, bigint, text,
  text, text, text, bigint, timestamptz, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.save_verified_event_metadata(
  event_owner_id uuid,
  requested_event_id text,
  expected_metadata_revision bigint,
  verified_current_supply bigint,
  metadata_patch jsonb
)
RETURNS public.events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event public.events%ROWTYPE;
  unknown_key text;
  venue_change boolean;
BEGIN
  IF metadata_patch IS NULL OR jsonb_typeof(metadata_patch) <> 'object' THEN
    RAISE EXCEPTION 'Metadata patch must be an object';
  END IF;
  SELECT key INTO unknown_key
  FROM jsonb_object_keys(metadata_patch) AS key
  WHERE key NOT IN (
    'summary', 'description', 'image_url', 'organizer_display_name',
    'support_contact', 'entry_instructions', 'accessibility_notes',
    'age_restriction', 'prohibited_items', 'public_links',
    'venue', 'address', 'city', 'map_url'
  )
  LIMIT 1;
  IF unknown_key IS NOT NULL THEN
    RAISE EXCEPTION 'Unsupported published metadata field: %', unknown_key;
  END IF;
  IF EXISTS (
    SELECT key
    FROM jsonb_object_keys(metadata_patch) AS key
    WHERE key IN (
      'summary', 'description', 'image_url', 'organizer_display_name',
      'support_contact', 'entry_instructions', 'venue', 'address', 'city'
    )
      AND COALESCE(btrim(metadata_patch ->> key), '') = ''
  ) THEN
    RAISE EXCEPTION 'Required public metadata cannot be empty';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.event_publication_drafts
    WHERE user_id = event_owner_id
      AND event_id = requested_event_id
      AND state = 'published'
  ) THEN
    RAISE EXCEPTION 'Owned published event not found';
  END IF;

  venue_change := metadata_patch ?| ARRAY['venue', 'address', 'city', 'map_url'];
  IF venue_change AND verified_current_supply <> 0 THEN
    RAISE EXCEPTION 'Venue information is locked after the first authoritative sale';
  END IF;

  UPDATE public.events AS current
  SET
    summary = CASE WHEN metadata_patch ? 'summary'
      THEN nullif(btrim(metadata_patch ->> 'summary'), '') ELSE current.summary END,
    description = CASE WHEN metadata_patch ? 'description'
      THEN nullif(btrim(metadata_patch ->> 'description'), '') ELSE current.description END,
    image_url = CASE WHEN metadata_patch ? 'image_url'
      THEN nullif(btrim(metadata_patch ->> 'image_url'), '') ELSE current.image_url END,
    organizer_display_name = CASE WHEN metadata_patch ? 'organizer_display_name'
      THEN nullif(btrim(metadata_patch ->> 'organizer_display_name'), '')
      ELSE current.organizer_display_name END,
    support_contact = CASE WHEN metadata_patch ? 'support_contact'
      THEN nullif(btrim(metadata_patch ->> 'support_contact'), '')
      ELSE current.support_contact END,
    entry_instructions = CASE WHEN metadata_patch ? 'entry_instructions'
      THEN nullif(btrim(metadata_patch ->> 'entry_instructions'), '')
      ELSE current.entry_instructions END,
    accessibility_notes = CASE WHEN metadata_patch ? 'accessibility_notes'
      THEN nullif(btrim(metadata_patch ->> 'accessibility_notes'), '')
      ELSE current.accessibility_notes END,
    age_restriction = CASE WHEN metadata_patch ? 'age_restriction'
      THEN nullif(btrim(metadata_patch ->> 'age_restriction'), '')
      ELSE current.age_restriction END,
    prohibited_items = CASE WHEN metadata_patch ? 'prohibited_items'
      THEN nullif(btrim(metadata_patch ->> 'prohibited_items'), '')
      ELSE current.prohibited_items END,
    public_links = CASE WHEN metadata_patch ? 'public_links'
      THEN CASE
        WHEN jsonb_typeof(metadata_patch -> 'public_links') = 'null'
          THEN '[]'::jsonb
        ELSE metadata_patch -> 'public_links'
      END
      ELSE current.public_links END,
    venue = CASE WHEN metadata_patch ? 'venue'
      THEN nullif(btrim(metadata_patch ->> 'venue'), '') ELSE current.venue END,
    address = CASE WHEN metadata_patch ? 'address'
      THEN nullif(btrim(metadata_patch ->> 'address'), '') ELSE current.address END,
    city = CASE WHEN metadata_patch ? 'city'
      THEN nullif(btrim(metadata_patch ->> 'city'), '') ELSE current.city END,
    map_url = CASE WHEN metadata_patch ? 'map_url'
      THEN nullif(btrim(metadata_patch ->> 'map_url'), '') ELSE current.map_url END,
    current_supply = verified_current_supply,
    metadata_revision = current.metadata_revision + 1,
    metadata_updated_at = now(),
    metadata_updated_by = event_owner_id,
    updated_at = now()
  WHERE current.event_id = requested_event_id
    AND current.chain_verified_at IS NOT NULL
    AND current.metadata_revision = expected_metadata_revision
    AND verified_current_supply >= 0
    AND verified_current_supply <= current.capacity
  RETURNING current.* INTO event;

  IF FOUND THEN
    RETURN event;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.events WHERE event_id = requested_event_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Metadata revision conflict';
  END IF;
  RAISE EXCEPTION 'Trusted published event not found';
END;
$$;

REVOKE ALL ON FUNCTION public.save_verified_event_metadata(
  uuid, text, bigint, bigint, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_event_metadata(
  uuid, text, bigint, bigint, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- One recoverable terminal-operation owner for cancel and complete
-- ---------------------------------------------------------------------------

CREATE TABLE public.organizer_event_operations (
  operation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_idempotency_key uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.events(event_id),
  operation_type text NOT NULL
    CHECK (operation_type IN ('cancel_event', 'complete_event')),
  expected_organizer_address text NOT NULL,
  cancellation_reason text,
  network text NOT NULL,
  ticket_contract_id text NOT NULL,
  state text NOT NULL DEFAULT 'review'
    CHECK (state IN (
      'review',
      'approval_required',
      'signed_submission_pending',
      'confirmation_pending',
      'status_unknown',
      'pre_submission_failed',
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
  verified_event_id text,
  verified_released_amount bigint,
  verified_ledger_sequence bigint,
  verified_ledger_closed_at timestamptz,
  confirmed_at timestamptz,
  synchronized_at timestamptz,
  failure_category text,
  failure_detail text CHECK (failure_detail IS NULL OR length(failure_detail) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    cancellation_reason IS NULL
    OR (operation_type = 'cancel_event' AND btrim(cancellation_reason) <> '')
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
    verified_released_amount IS NULL
    OR (operation_type = 'complete_event' AND verified_released_amount >= 0)
  )
);

CREATE UNIQUE INDEX one_unresolved_organizer_terminal_operation
  ON public.organizer_event_operations (network, ticket_contract_id, event_id)
  WHERE state IN (
    'review',
    'approval_required',
    'signed_submission_pending',
    'confirmation_pending',
    'status_unknown',
    'chain_confirmed',
    'mirror_syncing',
    'sync_warning'
  );

CREATE INDEX organizer_event_operations_owner_updated
  ON public.organizer_event_operations (user_id, updated_at DESC);
CREATE INDEX organizer_event_operations_signed_hash
  ON public.organizer_event_operations (signed_transaction_hash)
  WHERE signed_transaction_hash IS NOT NULL;

ALTER TABLE public.organizer_event_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own organizer event operations"
  ON public.organizer_event_operations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.organizer_event_operations FROM anon, authenticated;
GRANT SELECT ON public.organizer_event_operations TO authenticated;

CREATE OR REPLACE FUNCTION public.allocate_organizer_event_operation(
  operation_owner_id uuid,
  requested_idempotency_key uuid,
  requested_event_id text,
  requested_operation_type text,
  verified_organizer_address text,
  private_cancellation_reason text,
  configured_network text,
  configured_ticket_contract_id text
)
RETURNS public.organizer_event_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.organizer_event_operations%ROWTYPE;
  lock_key text;
BEGIN
  IF requested_operation_type NOT IN ('cancel_event', 'complete_event') THEN
    RAISE EXCEPTION 'Unsupported organizer event operation';
  END IF;
  IF requested_operation_type = 'cancel_event'
     AND (private_cancellation_reason IS NULL
       OR btrim(private_cancellation_reason) = '') THEN
    RAISE EXCEPTION 'Cancellation reason is required';
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
    ':', configured_network, configured_ticket_contract_id, requested_event_id
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  SELECT * INTO operation
  FROM public.organizer_event_operations
  WHERE network = configured_network
    AND ticket_contract_id = configured_ticket_contract_id
    AND event_id = requested_event_id
    AND state IN (
      'review', 'approval_required', 'signed_submission_pending',
      'confirmation_pending', 'status_unknown', 'chain_confirmed',
      'mirror_syncing', 'sync_warning'
    )
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    RETURN operation;
  END IF;

  INSERT INTO public.organizer_event_operations (
    request_idempotency_key,
    user_id,
    event_id,
    operation_type,
    expected_organizer_address,
    cancellation_reason,
    network,
    ticket_contract_id
  ) VALUES (
    requested_idempotency_key,
    operation_owner_id,
    requested_event_id,
    requested_operation_type,
    verified_organizer_address,
    CASE WHEN requested_operation_type = 'cancel_event'
      THEN btrim(private_cancellation_reason) ELSE NULL END,
    configured_network,
    configured_ticket_contract_id
  )
  ON CONFLICT (request_idempotency_key) DO NOTHING
  RETURNING * INTO operation;

  IF NOT FOUND THEN
    SELECT * INTO STRICT operation
    FROM public.organizer_event_operations
    WHERE request_idempotency_key = requested_idempotency_key
      AND user_id = operation_owner_id;
  END IF;
  RETURN operation;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_organizer_event_operation(
  uuid, uuid, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_organizer_event_operation(
  uuid, uuid, text, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_organizer_event_operation(
  requested_operation_id uuid,
  p_verified_transaction_hash text,
  p_verified_event_topic text,
  p_verified_event_id text,
  p_verified_released_amount bigint,
  p_verified_ledger_sequence bigint,
  p_verified_ledger_closed_at timestamptz
)
RETURNS public.organizer_event_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.organizer_event_operations%ROWTYPE;
BEGIN
  SELECT * INTO operation
  FROM public.organizer_event_operations
  WHERE operation_id = requested_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizer event operation not found';
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
     OR operation.event_id IS DISTINCT FROM p_verified_event_id
     OR (
       operation.operation_type = 'cancel_event'
       AND (
         p_verified_event_topic <> 'ev_cancel'
         OR p_verified_released_amount IS NOT NULL
       )
     )
     OR (
       operation.operation_type = 'complete_event'
       AND (
         p_verified_event_topic <> 'ev_rel'
         OR p_verified_released_amount IS NULL
         OR p_verified_released_amount < 0
       )
     )
     OR p_verified_ledger_sequence <= 0
     OR p_verified_ledger_closed_at IS NULL THEN
    RAISE EXCEPTION 'Authoritative terminal-event proof does not match the operation';
  END IF;

  UPDATE public.organizer_event_operations
  SET
    state = 'chain_confirmed',
    verified_event_topic = p_verified_event_topic,
    verified_event_id = p_verified_event_id,
    verified_released_amount = p_verified_released_amount,
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

REVOKE ALL ON FUNCTION public.confirm_organizer_event_operation(
  uuid, text, text, text, bigint, bigint, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_organizer_event_operation(
  uuid, text, text, text, bigint, bigint, timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_organizer_event_sync(
  requested_operation_id uuid,
  verified_event_status text,
  verified_current_supply bigint,
  verified_capacity bigint,
  verified_at timestamptz
)
RETURNS public.organizer_event_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  operation public.organizer_event_operations%ROWTYPE;
  mirrored public.events%ROWTYPE;
BEGIN
  SELECT * INTO operation
  FROM public.organizer_event_operations
  WHERE operation_id = requested_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organizer event operation not found';
  END IF;
  IF operation.state = 'complete' THEN
    RETURN operation;
  END IF;
  IF operation.state NOT IN ('chain_confirmed', 'mirror_syncing', 'sync_warning') THEN
    RAISE EXCEPTION 'Operation is not ready for mirror synchronization';
  END IF;
  IF (
    operation.operation_type = 'cancel_event'
    AND (
      verified_event_status <> 'Cancelled'
      OR operation.verified_event_topic <> 'ev_cancel'
    )
  ) OR (
    operation.operation_type = 'complete_event'
    AND (
      verified_event_status <> 'Completed'
      OR operation.verified_event_topic <> 'ev_rel'
      OR operation.verified_released_amount IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Authoritative terminal state does not match the receipt';
  END IF;
  IF verified_current_supply < 0 OR verified_current_supply > verified_capacity THEN
    RAISE EXCEPTION 'Authoritative supply is invalid';
  END IF;

  SELECT * INTO mirrored
  FROM public.events
  WHERE event_id = operation.event_id
    AND network = operation.network
    AND ticket_contract_id = operation.ticket_contract_id
    AND chain_verified_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND OR mirrored.capacity IS DISTINCT FROM verified_capacity THEN
    RAISE EXCEPTION 'Trusted published event does not match authoritative state';
  END IF;

  UPDATE public.events
  SET
    status = verified_event_status,
    current_supply = verified_current_supply,
    cancellation_reason = CASE
      WHEN operation.operation_type = 'cancel_event'
        THEN operation.cancellation_reason
      ELSE cancellation_reason
    END,
    chain_verified_at = verified_at,
    updated_at = now()
  WHERE event_id = operation.event_id;

  UPDATE public.organizer_event_operations
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

REVOKE ALL ON FUNCTION public.finalize_organizer_event_sync(
  uuid, text, bigint, bigint, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_organizer_event_sync(
  uuid, text, bigint, bigint, timestamptz
) TO service_role;
