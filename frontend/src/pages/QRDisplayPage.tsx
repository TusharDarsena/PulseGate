import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useState } from 'react';
import { buildQRPayload } from '../lib/qr';
import { getTicket } from '../lib/soroban';
import { useAppStore } from '../store/useAppStore';

export function QRDisplayPage({ ticketId }: { ticketId: string }) {
  const [countdown, setCountdown] = useState(30);
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [validating, setValidating] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const wallet = useAppStore((state) => state.attendeeWallet);

  const validate = useCallback(async () => {
    if (wallet.readiness !== 'ready' || !wallet.address) return false;
    const ticket = await getTicket(ticketId);
    if (!ticket || ticket.owner !== wallet.address) throw new Error('This ticket is not owned by the restored attendee wallet.');
    if (ticket.status !== 'Active') throw new Error(`This ticket is ${ticket.status.toLowerCase()} and cannot generate entry QR.`);
    return true;
  }, [ticketId, wallet.address, wallet.readiness]);

  useEffect(() => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signMessage) return;
    let cancelled = false;
    let chainValidated = false;
    const signPayload = async () => {
      const next = await buildQRPayload(wallet.address!, ticketId, wallet.signMessage!);
      if (!cancelled) {
        setPayload(next);
        setError(null);
        setCountdown(30);
      }
    };
    const revalidate = async () => {
      chainValidated = false;
      if (!cancelled) {
        setValidating(true);
        setValidated(false);
        setPayload(null);
      }
      try {
        chainValidated = await validate();
        if (!cancelled) {
          setValidated(chainValidated);
        }
        if (chainValidated) await signPayload();
      } catch (caught) {
        chainValidated = false;
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'QR signing failed.');
        if (!cancelled) { setPayload(null); setValidated(false); }
      } finally {
        if (!cancelled) setValidating(false);
      }
    };
    const rotate = async () => {
      if (!chainValidated) return;
      try {
        await signPayload();
      } catch (caught) {
        if (!cancelled) {
          setPayload(null);
          setError(caught instanceof Error ? caught.message : 'QR signing failed.');
        }
      }
    };
    void revalidate();
    const onFocus = () => void revalidate();
    window.addEventListener('focus', onFocus);
    const rotation = window.setInterval(() => void rotate(), 30_000);
    const timer = window.setInterval(() => setCountdown((value) => value <= 1 ? 30 : value - 1), 1_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(rotation);
      window.clearInterval(timer);
    };
  }, [ticketId, wallet.address, wallet.readiness, wallet.signMessage, validate, refreshNonce]);

  return (
    <main className="bg-black min-h-screen pt-28 pb-24 px-6 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-2">Your ticket</h1>
      <p className="font-mono text-xs text-slate-500 mb-8">{ticketId}</p>
      <div className="w-full max-w-sm aspect-square bg-white rounded-xl p-8 flex items-center justify-center">
        {payload && validated ? <QRCodeSVG value={payload} size={256} level="H" /> : <p className="text-gray-600 text-center">Validating ticket ownership…</p>}
      </div>
      <p className="mt-5 text-sm text-slate-400">Refreshes in {countdown}s</p>
      <button
        onClick={() => setRefreshNonce((value) => value + 1)}
        disabled={validating}
        className="mt-4 rounded-lg border border-[#7C5CFF]/40 px-4 py-2 text-sm text-[#c9c4d8] disabled:opacity-50"
      >
        {validating ? 'Validating…' : 'Refresh and revalidate'}
      </button>
      {error && <p role="alert" className="mt-4 text-red-400 max-w-md text-center">{error}</p>}
      <p className="mt-8 font-mono text-xs text-[#7C5CFF]">{wallet.address}</p>
    </main>
  );
}
