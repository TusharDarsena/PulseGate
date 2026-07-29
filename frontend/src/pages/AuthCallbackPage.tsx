import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { consumeAuthIntent, peekAuthIntent } from '../lib/authIntent';
import { supabase } from '../lib/supabase';
import { userFacingError } from '../lib/utils';

export function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const code = params.get('code');
  const callbackError = code
    ? null
    : params.get('error_description') ?? 'Authentication callback is missing its code.';
  const safeInterruptedIntent = peekAuthIntent();

  useEffect(() => {
    const state = params.get('state') ?? undefined;
    if (!code) return;
    void supabase.auth.exchangeCodeForSession(code).then(({ error: exchangeError }) => {
      if (exchangeError) {
          setError(userFacingError(exchangeError, 'Sign-in could not be completed.'));
        return;
      }
      navigate(consumeAuthIntent(state)?.path ?? '/events', { replace: true });
    });
  }, [code, navigate, params]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      {error || callbackError
        ? <section className="text-center"><p role="alert" className="text-red-400">{error ?? 'Sign-in could not be completed.'}</p><p className="mt-2 text-sm text-slate-400">It is safe to return and request a new sign-in link.</p>{safeInterruptedIntent && <p className="mt-2 text-sm text-slate-400">No payment, wallet signature, or operation was started before sign-in.</p>}<button type="button" onClick={() => navigate('/auth', { replace: true })} className="mt-5 rounded-lg border border-[#7C5CFF]/50 px-4 py-2 text-sm text-[#cabeff]">Return to sign in</button></section>
        : <p>Completing sign in…</p>}
    </main>
  );
}
