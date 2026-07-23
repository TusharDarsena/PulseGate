import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { buildQRPayload } from '../lib/qr';
import { useAppStore } from '../store/useAppStore';

export function QRDisplayPage({ ticketId }: { ticketId: string }) {
  const [countdown, setCountdown] = useState(30);
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wallet = useAppStore((state) => state.attendeeWallet);

  useEffect(() => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signMessage) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await buildQRPayload(wallet.address!, ticketId, wallet.signMessage!);
        if (!cancelled) {
          setPayload(next);
          setError(null);
          setCountdown(30);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'QR signing failed.');
      }
    };
    void refresh();
    const rotation = window.setInterval(() => void refresh(), 30_000);
    const timer = window.setInterval(() => setCountdown((value) => value <= 1 ? 30 : value - 1), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(rotation);
      window.clearInterval(timer);
    };
  }, [ticketId, wallet.address, wallet.readiness, wallet.signMessage]);

  return (
    <main className="bg-black min-h-screen pt-28 pb-24 px-6 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-2">Your ticket</h1>
      <p className="font-mono text-xs text-slate-500 mb-8">{ticketId}</p>
      <div className="w-full max-w-sm aspect-square bg-white rounded-xl p-8 flex items-center justify-center">
        {payload ? <QRCodeSVG value={payload} size={256} level="H" /> : <p className="text-gray-600 text-center">Waiting for delegated-wallet approval…</p>}
      </div>
      <p className="mt-5 text-sm text-slate-400">Refreshes in {countdown}s</p>
      {error && <p role="alert" className="mt-4 text-red-400 max-w-md text-center">{error}</p>}
      <p className="mt-8 font-mono text-xs text-[#7C5CFF]">{wallet.address}</p>
    </main>
  );
}
