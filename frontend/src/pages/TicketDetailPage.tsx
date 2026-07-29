import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EventActions } from '../components/events/EventActions';
import { usePublishedEventsByIds } from '../hooks/useScopedEvents';
import { formatEventRange } from '../lib/eventModel';
import {
  getPurchaseOperation,
  getPurchaseOperationForTicket,
  retryPurchaseSync,
  type PurchaseOperationResponse,
} from '../lib/purchaseOperations';
import { getTicket } from '../lib/soroban';
import { fetchMyTicket, type TicketRow } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';
import type { Ticket, TicketStatus } from '../types';

const SYNC_PENDING = new Set(['chain_confirmed', 'mirror_syncing', 'sync_warning']);

function mapTicket(row: TicketRow): Ticket {
  return {
    ticketId: row.ticket_id,
    eventId: row.event_id,
    owner: row.owner_address,
    status: row.status as TicketStatus,
    purchasedAt: row.purchased_at,
    receiptOperationId: row.receipt_operation_id ?? undefined,
  };
}

export function TicketDetailPage() {
  const { ticketId = '' } = useParams();
  const hasTicketId = Boolean(ticketId);
  const navigate = useNavigate();
  const wallet = useAppStore((state) => state.attendeeWallet);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [receipt, setReceipt] = useState<PurchaseOperationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!hasTicketId) return;
    let cancelled = false;

    void (async () => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
        setMissing(false);
      }

      const local = await fetchMyTicket(ticketId).catch(() => null);
      if (local) {
        if (!cancelled) setTicket(mapTicket(local));
        if (local.receipt_operation_id) {
          const localReceipt = await getPurchaseOperation(local.receipt_operation_id).catch(() => null);
          if (!cancelled && localReceipt) setReceipt(localReceipt);
        }
        return;
      }

      const { result } = await getPurchaseOperationForTicket(ticketId)
        .catch(() => ({ result: null }));
      let ownedReceipt = result;
      if (!cancelled) setReceipt(ownedReceipt);
      if (ownedReceipt && SYNC_PENDING.has(ownedReceipt.operation.state)) {
        ownedReceipt = await retryPurchaseSync(ownedReceipt.operation.operation_id)
          .catch(() => ownedReceipt);
        if (!cancelled) setReceipt(ownedReceipt);
      }

      const repaired = await fetchMyTicket(ticketId).catch(() => null);
      if (repaired) {
        if (!cancelled) setTicket(mapTicket(repaired));
        return;
      }

      if (wallet.readiness !== 'ready' || !wallet.address) {
        throw new Error('Restore the attendee wallet to verify current on-chain ownership.');
      }
      const chainTicket = await getTicket(ticketId);
      if (!chainTicket) {
        if (!cancelled) setMissing(true);
        return;
      }
      if (chainTicket.owner !== wallet.address) {
        throw new Error('The restored attendee wallet does not currently own this ticket.');
      }
      if (!cancelled) {
        setTicket({
          ...chainTicket,
          receiptOperationId: ownedReceipt?.operation.operation_id,
        });
      }
    })()
      .catch((caught) => {
        if (!cancelled) {
          setTicket(null);
          setError(caught instanceof Error ? caught.message : 'Ticket recovery failed.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasTicketId, ticketId, wallet.address, wallet.readiness]);

  const eventState = usePublishedEventsByIds(ticket ? [ticket.eventId] : []);
  const event = eventState.events[0];
  const operation = receipt?.operation;
  const receiptName = operation?.receipt_event_name;
  const receiptStart = operation?.receipt_event_start_unix;
  const receiptTimezone = operation?.receipt_event_timezone ?? 'UTC';

  if (!hasTicketId) {
    return (
      <main className="pt-28 min-h-screen text-center text-slate-300">
        Ticket not found for this account.
      </main>
    );
  }
  if (loading || (ticket && eventState.loading)) {
    return <main className="pt-28 min-h-screen text-center text-slate-400">Loading ticket…</main>;
  }
  if (!ticket) {
    return (
      <main className="pt-28 min-h-screen text-center text-slate-300">
        {error || 'Ticket not found for this account.'}
        {missing && <Link to="/tickets" className="mt-5 block text-[#cabeff]">My Tickets</Link>}
      </main>
    );
  }
  if (!event && !receiptName) {
    return (
      <main className="pt-28 min-h-screen text-center text-slate-300">
        {eventState.error || 'Event details are temporarily unavailable.'}
      </main>
    );
  }

  return (
    <main className="pt-28 pb-24 px-4 max-w-3xl mx-auto min-h-screen">
      {event?.imageUrl && (
        <img src={event.imageUrl} alt="" className="h-64 w-full rounded-xl object-cover" />
      )}
      <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-[#7C5CFF]">
        {ticket.status} · General Admission
      </p>
      <h1 className="mt-2 text-3xl font-bold">{event?.name ?? receiptName}</h1>
      <p className="mt-3 text-[#c9c4d8]">
        {event
          ? formatEventRange(event)
          : receiptStart
            ? new Date(receiptStart * 1000).toLocaleString('en-US', { timeZone: receiptTimezone })
            : 'Event time unavailable'}
      </p>
      <p className="mt-1 text-[#c9c4d8]">
        {event
          ? `${event.venue}, ${event.address}, ${event.city}`
          : operation?.receipt_venue}
      </p>
      <div className="mt-6 rounded-xl border border-[#272C33] bg-[#15181C] p-5">
        <p className="text-xs uppercase tracking-widest text-[#938ea1]">Ticket ID</p>
        <p className="mt-2 font-mono text-[#7C5CFF] break-all">{ticket.ticketId}</p>
      </div>
      {event && <div className="mt-6"><EventActions event={event} /></div>}
      <div className="mt-6 flex flex-wrap gap-3">
        {ticket.status === 'Active' && (
          <button
            onClick={() => navigate(`/tickets/${ticket.ticketId}/qr`)}
            className="rounded-lg bg-[#7C5CFF] px-4 py-2 font-semibold"
          >
            Show QR
          </button>
        )}
        {ticket.receiptOperationId && (
          <button
            onClick={() => navigate(`/purchases/${ticket.receiptOperationId}`)}
            className="rounded-lg border border-[#7C5CFF]/40 px-4 py-2 text-[#c9c4d8]"
          >
            View receipt
          </button>
        )}
      </div>
    </main>
  );
}
