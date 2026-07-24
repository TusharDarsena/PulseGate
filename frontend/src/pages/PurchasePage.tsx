import { useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { useEvent } from '../hooks/useEvent';
import { useXlmPrice } from '../hooks/useXlmPrice';
import {
  authoritativeFingerprint,
  deriveEventSalesState,
  EVENT_SALES_LABELS,
  formatEventRange,
  REFUND_POLICY,
  remainingTickets,
  RESALE_POLICY,
} from '../lib/eventModel';
import {
  mirrorPurchasedTicket,
  refreshPurchasedEvent,
  synchronizationWarning,
} from '../lib/readModelSync';
import { purchaseTicket } from '../lib/soroban';
import { generateID } from '../lib/utils';
import { useAppStore } from '../store/useAppStore';
import { stroopsToXlm } from '../types';

interface PurchasePageProps {
  eventId: string;
  onBack: () => void;
  onPurchaseComplete: (ticketId: string) => void;
  invalidateTickets: () => void;
}

export function PurchasePage({
  eventId,
  onBack,
  onPurchaseComplete,
  invalidateTickets,
}: PurchasePageProps) {
  const { event, loading, error, reload } = useEvent(eventId);
  const reviewedFingerprint = useRef<string | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const { attendeeWallet: wallet, setTxState } = useAppStore();
  const { usdPerXlm } = useXlmPrice();

  if (loading && !event) {
    return <div className="p-20 text-center text-slate-400">Checking current sale conditions…</div>;
  }
  if (error) return <div className="p-20 text-center text-red-400">{error}</div>;
  if (!event) return <div className="p-20 text-center text-slate-400">Published event not found.</div>;

  const salesState = deriveEventSalesState(event, undefined, true);
  const priceXlm = Number(stroopsToXlm(event.pricePerTicket));
  const totalUsd = usdPerXlm ? priceXlm * usdPerXlm : null;

  const handlePurchase = async () => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signFn) return;
    const reviewBaseline =
      reviewedFingerprint.current ?? authoritativeFingerprint(event);

    setTxState({ status: 'building', message: 'Reconfirming event on Stellar…' });
    const refreshed = await reload();
    if (!refreshed) {
      setTxState({ status: 'idle' });
      setReviewNotice('Current sale conditions could not be verified. No payment was submitted.');
      return;
    }

    const nextState = deriveEventSalesState(refreshed, undefined, true);
    const nextFingerprint = authoritativeFingerprint(refreshed);
    if (nextState !== 'on_sale') {
      setTxState({ status: 'idle' });
      reviewedFingerprint.current = nextFingerprint;
      setReviewNotice(
        `The event is now ${EVENT_SALES_LABELS[nextState].toLowerCase()}. No payment was submitted.`,
      );
      return;
    }
    if (reviewBaseline !== nextFingerprint) {
      setTxState({ status: 'idle' });
      reviewedFingerprint.current = nextFingerprint;
      setReviewNotice(
        'Price or availability changed. Review the updated information, then confirm again.',
      );
      return;
    }

    setReviewNotice(null);
    try {
      const ticketId = generateID();
      const transactionHash = await purchaseTicket(
        refreshed.eventId,
        wallet.address,
        ticketId,
        wallet.signFn,
      );

      const ticketSync = await mirrorPurchasedTicket({
        ticketId,
        eventId: refreshed.eventId,
        ownerAddress: wallet.address,
      });
      const eventSync = await refreshPurchasedEvent(refreshed.eventId, transactionHash);
      if (ticketSync.ok) invalidateTickets();
      const syncResult = ticketSync.ok ? eventSync : ticketSync;

      setTxState({
        status: 'success',
        message: syncResult.ok ? undefined : synchronizationWarning(syncResult),
      });
      setTimeout(() => {
        setTxState({ status: 'idle' });
        onPurchaseComplete(ticketId);
      }, syncResult.ok ? 1500 : 6000);
    } catch (purchaseError) {
      const message = purchaseError instanceof Error ? purchaseError.message : 'Purchase failed';
      setTxState({ status: 'error', errorMessage: message });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  return (
    <div className="bg-[#0E1113] min-h-screen text-[#EAEFF4]">
      <main className="pt-24 pb-32 px-4 md:px-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <p className="text-sm font-semibold text-[#7C5CFF]">Review purchase</p>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold">Buy 1 ticket</h1>
          <p className="mt-2 text-[#938ea1]">
            Sale conditions shown here were read from the TicketContract.
          </p>
        </div>

        <section className="bg-[#15181C] border border-[#272C33] rounded-xl overflow-hidden">
          <div className="grid md:grid-cols-[220px_1fr]">
            <img src={event.imageUrl} alt={event.name} className="w-full h-full min-h-52 object-cover" />
            <div className="p-6">
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="rounded-full bg-[#7C5CFF]/15 px-3 py-1 text-xs text-[#cabeff]">
                  {EVENT_SALES_LABELS[salesState]}
                </span>
                <span className="rounded-full bg-[#272C33] px-3 py-1 text-xs">
                  {remainingTickets(event)} remaining
                </span>
              </div>
              <h2 className="text-2xl font-bold">{event.name}</h2>
              <p className="mt-3 text-sm text-[#c9c4d8]">{formatEventRange(event)}</p>
              <p className="mt-1 text-sm text-[#c9c4d8]">
                {event.venue} · {event.city}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-6 bg-[#15181C] border border-[#272C33] rounded-xl p-6 space-y-5">
          <div className="flex justify-between gap-4">
            <div>
              <p className="font-semibold">1 × General Admission ticket</p>
              <p className="text-sm text-[#938ea1]">Primary ticket</p>
            </div>
            <p className="font-semibold">{priceXlm.toFixed(2)} XLM</p>
          </div>
          <div className="border-t border-[#272C33] pt-5 flex justify-between gap-4">
            <p className="font-semibold">Total</p>
            <div className="text-right">
              <p className="text-xl font-bold text-[#cabeff]">{priceXlm.toFixed(2)} XLM</p>
              {totalUsd !== null && (
                <p className="text-xs text-[#938ea1]">Approx. ${totalUsd.toFixed(2)}</p>
              )}
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Policy title="Refunds" text={REFUND_POLICY[event.refundPolicyCode]} />
          <Policy title="Resale" text={RESALE_POLICY[event.resalePolicyCode]} />
        </section>

        {reviewNotice && (
          <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
            {reviewNotice}
          </div>
        )}

        {salesState !== 'on_sale' && (
          <div className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">
            This event is {EVENT_SALES_LABELS[salesState].toLowerCase()}; primary payment is disabled.
          </div>
        )}

        <p className="mt-6 text-xs text-[#938ea1]">
          Stellar Testnet — balances and payments have no monetary value.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          <Button
            onClick={() => void handlePurchase()}
            disabled={salesState !== 'on_sale' || wallet.readiness !== 'ready'}
            size="lg"
            className="w-full py-4 text-lg"
          >
            Confirm and pay {priceXlm.toFixed(2)} XLM
          </Button>
          <Button variant="secondary" onClick={onBack} size="lg" className="w-full py-4">
            Return to event
          </Button>
        </div>
      </main>
    </div>
  );
}

function Policy({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[#272C33] bg-[#15181C] p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[#c9c4d8]">{text}</p>
    </div>
  );
}
