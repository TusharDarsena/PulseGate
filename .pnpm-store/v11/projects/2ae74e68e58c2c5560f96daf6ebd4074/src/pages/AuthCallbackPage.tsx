import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { consumeAuthIntent } from '../lib/authIntent';
import { supabase } from '../lib/supabase';

export function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get('code');
  const callbackError = code
    ? null
    : params.get('error_description') ?? 'Authentication callback is missing its code.';

  useEffect(() => {
    const state = params.get('state') ?? undefined;
    if (!code) return;
    void supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) {
        setError(exchangeError.message);
        return;
      }
      navigate(consumeAuthIntent(state)?.path ?? '/events', { replace: true });
    });
  }, [code, navigate, params]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      {error || callbackError
        ? <p role="alert" className="text-red-400">{error ?? callbackError}</p>
        : <p>Completing sign in…</p>}
    </main>
  );
}
