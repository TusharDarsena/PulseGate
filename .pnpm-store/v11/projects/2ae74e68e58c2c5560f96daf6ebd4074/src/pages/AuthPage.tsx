import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { consumeAuthIntent, peekAuthIntent, saveAuthIntent } from '../lib/authIntent';

export function AuthPage() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const { authError, sendEmailOtp, verifyEmailOtp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const intent = peekAuthIntent();
  const ensureIntent = () => intent ?? saveAuthIntent('/account', 'open_account');

  const sendOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await sendEmailOtp(email);
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await verifyEmailOtp(email, otp);
      navigate(consumeAuthIntent()?.path ?? '/account', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen pt-28 px-4 flex justify-center">
      <section className="w-full max-w-md bg-[#15181C] border border-[#272C33] rounded-2xl p-8 h-fit">
        <h1 className="text-3xl font-bold mb-2">Sign in</h1>
        <p className="text-slate-400 mb-6">Continue with Google or a six-digit email code.</p>
        <button
          onClick={() => void signInWithGoogle(ensureIntent().nonce)}
          className="w-full py-3 rounded-lg bg-white text-black font-semibold mb-5"
        >
          Continue with Google
        </button>
        <div className="text-center text-slate-500 text-sm mb-5">or</div>
        {!sent ? (
          <form onSubmit={sendOtp} className="space-y-4">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" className="w-full bg-[#0E1113] border border-[#272C33] rounded-lg p-3" />
            <button disabled={busy} className="w-full py-3 rounded-lg bg-[#7C5CFF] disabled:opacity-50">
              Send email code
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="space-y-4">
            <input inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6}
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code" className="w-full bg-[#0E1113] border border-[#272C33] rounded-lg p-3 tracking-[0.4em]" />
            <button disabled={busy || otp.length !== 6} className="w-full py-3 rounded-lg bg-[#7C5CFF] disabled:opacity-50">
              Verify and continue
            </button>
          </form>
        )}
        {authError && <p role="alert" className="mt-4 text-red-400 text-sm">{authError}</p>}
      </section>
    </main>
  );
}
