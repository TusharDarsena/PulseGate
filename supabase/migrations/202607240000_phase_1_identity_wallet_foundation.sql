-- Slice 1 / Phase 1: stable human identity and delegated attendee wallet.
--
-- This is intentionally idempotent because early deployments used
-- supabase_schema.sql directly. Keeping the foundation in migration history
-- allows an existing Phase 0 project to upgrade through later Slice 1 phases.

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
