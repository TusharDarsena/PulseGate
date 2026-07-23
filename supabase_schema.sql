-- Phase 0: Database Setup
-- Run this in your Supabase SQL Editor

-- 1. Update existing `events` table with missing columns
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS status text DEFAULT 'Active',
ADD COLUMN IF NOT EXISTS current_supply bigint DEFAULT 0,
ADD COLUMN IF NOT EXISTS date_unix bigint,
ADD COLUMN IF NOT EXISTS capacity bigint,
ADD COLUMN IF NOT EXISTS price_per_ticket bigint,
-- Metadata columns required by lib/supabase.ts EventMetadata interface and upsertEventMetadata()
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS image_url text,
ADD COLUMN IF NOT EXISTS venue text,
ADD COLUMN IF NOT EXISTS city text,
ADD COLUMN IF NOT EXISTS category text;

-- 2. Create `tickets` table
CREATE TABLE IF NOT EXISTS public.tickets (
  ticket_id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
  owner_address text NOT NULL,
  status text NOT NULL DEFAULT 'Active',
  purchased_at timestamp with time zone DEFAULT now()
);

-- 3. Create `listings` table
CREATE TABLE IF NOT EXISTS public.listings (
  listing_id text PRIMARY KEY,
  seller_address text NOT NULL,
  ticket_id text NOT NULL REFERENCES public.tickets(ticket_id) ON DELETE CASCADE,
  event_id text NOT NULL REFERENCES public.events(event_id) ON DELETE CASCADE,
  ask_price_stroops bigint NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  listed_at timestamp with time zone DEFAULT now()
);

-- 4. Create `user_profiles` table
CREATE TABLE IF NOT EXISTS public.user_profiles (
  wallet_address text PRIMARY KEY,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamp with time zone DEFAULT now()
);

-- 5. Create `app_cache` table (For Edge Function updates)
CREATE TABLE IF NOT EXISTS public.app_cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now()
);

-- 6. Set up basic RLS (Row Level Security)
-- Note: Assuming you are relying on anon-key public reads for now,
-- and authenticated/anon writes from the frontend. We will enable permissive 
-- rules to prevent frontend breakage, but in production you'd lock this down.

-- WARNING: These policies are deliberately open (true) for the MVP phase
-- to allow the frontend to sync state. In a production environment, 
-- these MUST be restricted (e.g., verifying user identity or using Edge Functions 
-- to validate the corresponding on-chain Soroban transactions).
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read access for all users on events" ON public.events FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users on events" ON public.events FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users on events" ON public.events FOR UPDATE USING (true);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read access for all users on tickets" ON public.tickets FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users on tickets" ON public.tickets FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users on tickets" ON public.tickets FOR UPDATE USING (true);

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read access for all users on listings" ON public.listings FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users on listings" ON public.listings FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users on listings" ON public.listings FOR UPDATE USING (true);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read access for all users on user_profiles" ON public.user_profiles FOR SELECT USING (true);
CREATE POLICY "Enable insert access for all users on user_profiles" ON public.user_profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable update access for all users on user_profiles" ON public.user_profiles FOR UPDATE USING (true);

ALTER TABLE public.app_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable read access for all users on app_cache" ON public.app_cache FOR SELECT USING (true);
-- Note: app_cache insert/update should ideally be limited to service_role (Edge Functions)

-- 7. Atomic RPC Functions
-- Used to safely increment event supply during concurrent purchases
CREATE OR REPLACE FUNCTION increment_event_supply(row_id text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.events 
  SET current_supply = current_supply + 1 
  WHERE event_id = row_id;
$$;

-- Slice 1 / Phase 1: stable human identity and delegated attendee wallet.
-- Provider identifiers and recovery/audit material are deliberately kept in
-- service-role-only tables. Browser clients receive only the three fields
-- returned by get_my_attendee_wallet().

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TABLE IF NOT EXISTS public.attendee_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  address text UNIQUE,
  network text NOT NULL DEFAULT 'StellarTestnet'
    CHECK (network = 'StellarTestnet'),
  readiness text NOT NULL
    CHECK (readiness IN ('provisioning', 'ready', 'recovery_required', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_provider_links (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'dfns'),
  provider_username text NOT NULL UNIQUE,
  provider_user_id text UNIQUE,
  provider_wallet_id text UNIQUE,
  provider_signing_key_id text UNIQUE,
  provider_recovery_credential_id text,
  recovery_state text NOT NULL DEFAULT 'required',
  temporary_auth_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_action_challenges (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  provider_auth_token text NOT NULL,
  provider_request jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  outcome text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendee_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_provider_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_action_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.attendee_wallets FROM anon, authenticated;
REVOKE ALL ON public.wallet_provider_links FROM anon, authenticated;
REVOKE ALL ON public.wallet_action_challenges FROM anon, authenticated;
REVOKE ALL ON public.wallet_audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_attendee_wallet()
RETURNS TABLE(address text, network text, readiness text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT w.address, w.network, w.readiness
  FROM public.attendee_wallets AS w
  WHERE w.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_attendee_wallet() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_attendee_wallet() TO authenticated;
