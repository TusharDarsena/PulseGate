import { useState } from 'react';
import { EventActions } from '../components/events/EventActions';
import { Button } from '../components/ui/Button';
import { useEvent } from '../hooks/useEvent';
import {
  deriveEventSalesState,
  EVENT_SALES_LABELS,
  formatEventRange,
  REFUND_POLICY,
  remainingTickets,
  RESALE_POLICY,
} from '../lib/eventModel';
import { stroopsToXlm, truncateKey } from '../types';

interface EventDetailPageProps {
  eventId: string;
  onPurchase: (eventId: string) => void;
}

const DISABLED_REASON = {
  sold_out: 'Primary tickets are sold out.',
  sales_closed: 'Primary sales closed when the event started.',
  cancelled: 'This event was cancelled.',
  completed: 'This event has completed.',
  unavailable: 'Current sale conditions could not be verified on Stellar.',
  on_sale: '',
} as const;

export function EventDetailPage({ eventId, onPurchase }: EventDetailPageProps) {
  const { event, loading, error, reload } = useEvent(eventId);
  const [checking, setChecking] = useState(false);

  if (loading && !event) {
    return <div className="p-20 text-center text-slate-400">Loading event…</div>;
  }
  if (error) return <div className="p-20 text-center text-red-400">{error}</div>;
  if (!event) return <div className="p-20 text-center text-slate-400">Published event not found.</div>;

  const salesState = deriveEventSalesState(event, undefined, true);
  const ticketsLeft = remainingTickets(event);
  const soldPercentage = Math.min(
    100,
    Math.round((event.currentSupply / event.capacity) * 100),
  );

  const openCheckout = async () => {
    setChecking(true);
    const refreshed = await reload();
    setChecking(false);
    if (refreshed && deriveEventSalesState(refreshed, undefined, true) === 'on_sale') {
      onPurchase(refreshed.eventId);
    }
  };

  return (
    <div className="bg-[#0E1113] min-h-screen">
      <main className="pt-24 pb-24 md:pb-12 max-w-7xl mx-auto px-4 md:px-8">
        <div className="w-full aspect-video md:aspect-[21/9] overflow-hidden md:rounded-xl">
          <img src={event.imageUrl} alt={event.name} className="w-full h-full object-cover" />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          <div className="lg:col-span-8 space-y-10">
            <section>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="rounded-full bg-[#7C5CFF]/15 px-3 py-1 text-xs font-semibold text-[#cabeff]">
                  {event.category}
                </span>
                <span className="rounded-full bg-[#272C33] px-3 py-1 text-xs font-semibold">
                  {EVENT_SALES_LABELS[salesState]}
                </span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-[#e6e0ee] mb-4 tracking-tight">
                {event.name}
              </h1>
              <p className="text-lg text-[#c9c4d8]">{event.summary}</p>
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Info label="Date and time" icon="calendar_today">
                {formatEventRange(event)}
              </Info>
              <Info label="Timezone" icon="schedule">{event.timezone}</Info>
              <Info label="Venue" icon="location_on">
                {event.venue}<br />
                <span className="text-sm text-[#938ea1]">{event.address}, {event.city}</span>
              </Info>
              <Info label="Availability" icon="group">
                <div className="flex justify-between text-sm">
                  <span>{ticketsLeft} of {event.capacity} remaining</span>
                  <span>{soldPercentage}% sold</span>
                </div>
                <div className="mt-2 w-full h-1.5 bg-[#36333e] rounded-full overflow-hidden">
                  <div className="bg-[#cabeff] h-full" style={{ width: `${soldPercentage}%` }} />
                </div>
              </Info>
            </div>

            <section>
              <h2 className="text-2xl font-semibold mb-3">About this event</h2>
              <p className="text-[#c9c4d8] whitespace-pre-wrap">{event.description}</p>
            </section>

            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Policy title="Refunds" text={REFUND_POLICY[event.refundPolicyCode]} />
              <Policy title="Resale" text={RESALE_POLICY[event.resalePolicyCode]} />
              <Policy title="Entry" text={event.entryInstructions} />
              <Policy title="Support" text={event.supportContact} />
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">Event actions</h2>
              <EventActions event={event} />
            </section>
          </div>

          <aside className="lg:col-span-4 lg:sticky lg:top-24 space-y-5">
            <div className="bg-[#15181C] border border-[#272C33] p-6 rounded-xl shadow-2xl">
              <p className="text-xs uppercase tracking-widest text-[#938ea1] mb-1">
                1 General Admission ticket
              </p>
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-4xl font-semibold">{stroopsToXlm(event.pricePerTicket)}</span>
                <span className="text-xl text-[#cabeff]">XLM</span>
              </div>

              {salesState === 'on_sale' ? (
                <Button onClick={() => void openCheckout()} disabled={checking} className="w-full py-4 text-lg">
                  {checking ? 'Checking availability…' : 'Buy 1 ticket'}
                </Button>
              ) : (
                <Button disabled className="w-full py-4 text-lg">
                  {EVENT_SALES_LABELS[salesState]}
                </Button>
              )}

              {salesState !== 'on_sale' && (
                <p className="mt-3 text-sm text-[#c9c4d8]">{DISABLED_REASON[salesState]}</p>
              )}
              {salesState === 'unavailable' && (
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="mt-3 text-sm font-semibold text-[#cabeff] hover:underline"
                >
                  Retry authoritative check
                </button>
              )}
            </div>

            <div className="p-5 rounded-xl bg-[#15181C] border border-[#272C33]">
              <p className="text-xs uppercase tracking-widest text-[#938ea1]">Organizer</p>
              <p className="mt-2 text-lg font-semibold">{event.organizerDisplayName}</p>
              <p className="mt-1 font-mono text-xs text-[#938ea1]">{truncateKey(event.organizer)}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Info({
  label,
  icon,
  children,
}: {
  label: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-[#272C33] bg-[#15181C]">
      <span className="material-symbols-outlined text-[#cabeff]">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold tracking-wider uppercase text-[#938ea1]">{label}</p>
        <div className="mt-1 text-[#e6e0ee]">{children}</div>
      </div>
    </div>
  );
}

function Policy({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[#272C33] bg-[#15181C] p-5">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[#c9c4d8]">{text}</p>
    </div>
  );
}
