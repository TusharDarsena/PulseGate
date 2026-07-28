-- Security hardening for delegated-wallet recovery.

ALTER TABLE public.wallet_provider_links
  ADD COLUMN IF NOT EXISTS recovery_challenge_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS wallet_provider_links_recovery_expiry
  ON public.wallet_provider_links (recovery_challenge_expires_at)
  WHERE recovery_challenge_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wallet_recovery_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  recovery_init_count integer NOT NULL DEFAULT 0 CHECK (recovery_init_count >= 0),
  recovery_complete_count integer NOT NULL DEFAULT 0 CHECK (recovery_complete_count >= 0),
  blocked_until timestamptz
);

ALTER TABLE public.wallet_recovery_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_recovery_rate_limits FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_wallet_recovery_rate_limit(p_user_id uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_limit public.wallet_recovery_rate_limits;
  next_count integer;
  max_attempts integer;
BEGIN
  IF p_action NOT IN ('recovery-init', 'recovery-complete') THEN
    RAISE EXCEPTION 'Unsupported wallet recovery rate-limit action';
  END IF;

  INSERT INTO public.wallet_recovery_rate_limits (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO current_limit
  FROM public.wallet_recovery_rate_limits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF current_limit.window_started_at <= now() - interval '15 minutes' THEN
    UPDATE public.wallet_recovery_rate_limits
    SET window_started_at = now(),
        recovery_init_count = 0,
        recovery_complete_count = 0,
        blocked_until = NULL
    WHERE user_id = p_user_id;
    current_limit.window_started_at := now();
    current_limit.recovery_init_count := 0;
    current_limit.recovery_complete_count := 0;
    current_limit.blocked_until := NULL;
  END IF;

  IF current_limit.blocked_until IS NOT NULL AND current_limit.blocked_until > now() THEN
    RETURN false;
  END IF;

  IF p_action = 'recovery-init' THEN
    next_count := current_limit.recovery_init_count + 1;
    max_attempts := 5;
    UPDATE public.wallet_recovery_rate_limits
    SET recovery_init_count = next_count,
        blocked_until = CASE WHEN next_count > max_attempts THEN now() + interval '15 minutes' ELSE blocked_until END
    WHERE user_id = p_user_id;
  ELSE
    next_count := current_limit.recovery_complete_count + 1;
    max_attempts := 10;
    UPDATE public.wallet_recovery_rate_limits
    SET recovery_complete_count = next_count,
        blocked_until = CASE WHEN next_count > max_attempts THEN now() + interval '15 minutes' ELSE blocked_until END
    WHERE user_id = p_user_id;
  END IF;

  RETURN next_count <= max_attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_wallet_recovery_rate_limit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_wallet_recovery_rate_limit(uuid, text) TO service_role;
