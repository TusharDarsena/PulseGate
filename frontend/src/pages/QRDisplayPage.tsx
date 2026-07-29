import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useState } from 'react';
import { buildQRPayload } from '../lib/qr';
import { getTicket } from '../lib/soroban';
import { useAppStore } from '../store/useAppStore';
import { usePublishedEventsByIds } from '../hooks/useScopedEvents';
import { formatEventRange } from '../lib/eventModel';
import { truncateKey, type Ticket } from '../types';
import { userFacingError } from '../lib/utils';
import { AuthorityStatus } from '../components/ui/AuthorityStatus';

export function QRDisplayPage({ ticketId }: { ticketId: string }) {
  const [countdown, setCountdown] = useState(30);
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState(false);
  const [validating, setValidating] = useState(true);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const wallet = useAppStore((state) => state.attendeeWallet);
  const eventState = usePublishedEventsByIds(ticket ? [ticket.eventId] : []);
  const event = eventState.events[0];

  const validateBeforeSigning = useCallback(async () => {
    if (wallet.readiness !== 'ready' || !wallet.address) return false;
    const ticket = await getTicket(ticketId);
    if (!ticket || ticket.owner !== wallet.address) throw new Error('This ticket is not owned by the restored attendee wallet.');
    if (ticket.status !== 'Active') throw new Error(`This ticket is ${ticket.status.toLowerCase()} and cannot generate entry QR.`);
    setTicket(ticket);
    return true;
  }, [ticketId, wallet.address, wallet.readiness]);

  useEffect(() => {
    const address = wallet.address;
    const signMessage = wallet.signMessage;
    let cancelled = false;
    if (wallet.readiness !== 'ready' || !address || !signMessage) {
      queueMicrotask(() => {
        if (cancelled) return;
        setPayload(null);
        setValidated(false);
        setValidating(false);
      });
      return () => {
        cancelled = true;
      };
    }
    let refreshing = false;

    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      if (!cancelled) {
        setValidating(true);
        setValidated(false);
        setPayload(null);
      }
      try {
        // A code is never signed from cached UI or mirror data. This runs for
        // every rotation so a transfer, refund, or check-in stops QR use.
        const eligible = await validateBeforeSigning();
        if (!eligible) throw new Error('The attendee wallet is not ready to sign this QR.');
        const next = await buildQRPayload(address, ticketId, signMessage);
        if (!cancelled) {
          setPayload(next);
          setValidated(true);
          setError(null);
          setCountdown(30);
        }
      } catch (caught) {
        const detail = caught instanceof Error ? caught.message : '';
        const safeDetail = /not owned by the restored attendee wallet|ticket is (used|refunded) and cannot generate entry qr/i.test(detail)
          ? detail
          : userFacingError(caught, 'Ticket validity could not be verified.');
        if (!cancelled) setError(safeDetail);
        if (!cancelled) { setPayload(null); setValidated(false); }
      } finally {
        if (!cancelled) setValidating(false);
        refreshing = false;
      }
    };
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    const rotation = window.setInterval(() => void refresh(), 30_000);
    const timer = window.setInterval(() => setCountdown((value) => value <= 1 ? 30 : value - 1), 1_000);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      window.clearInterval(rotation);
      window.clearInterval(timer);
    };
  }, [ticketId, wallet.address, wallet.readiness, wallet.signMessage, validateBeforeSigning, refreshNonce]);

  return (
    <main className="bg-black min-h-screen pt-28 pb-24 px-6 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-2">Your ticket</h1>
      <p className="font-mono text-xs text-slate-500 mb-8">{ticketId}</p>
      <section className="mb-6 w-full max-w-sm rounded-xl border border-[#272C33] bg-[#15181C] p-4 text-sm">
        <p className="font-semibold text-white">{event?.name ?? 'Verifying event details…'}</p>
        {event && <><p className="mt-1 text-[#c9c4d8]">{formatEventRange(event)}</p><p className="mt-1 text-[#c9c4d8]">{event.venue}</p></>}
        <p className="mt-3 text-[#cabeff]">General Admission · {validated ? 'Currently valid' : 'Validity is being checked'}</p>
      </section>
      <AuthorityStatus
        state={validating ? 'checking' : validated ? 'confirmed' : 'unavailable'}
        message={
          validating
            ? undefined
            : validated
              ? 'Current ticket owner and Active status are confirmed on Stellar. This QR was signed only after that check.'
              : 'Current owner and Active status could not be verified. No entry QR is available.'
        }
        className="mb-6 w-full max-w-sm"
      />
      <div
        aria-label={payload && validated ? 'Active entry QR' : 'Ticket QR validation'}
        className="w-full max-w-sm aspect-square bg-white rounded-xl p-8 flex items-center justify-center"
      >
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
      <p className="mt-8 font-mono text-xs text-[#7C5CFF]" title={wallet.address ?? undefined}>Wallet: {wallet.address ? truncateKey(wallet.address) : 'Unavailable'}</p>
    </main>
  );
}
