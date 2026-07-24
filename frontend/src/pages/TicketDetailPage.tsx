import { useParams } from 'react-router-dom';
import { EventActions } from '../components/events/EventActions';
import { usePublishedEventsByIds } from '../hooks/useScopedEvents';
import { useTickets } from '../hooks/useTickets';
import { formatEventRange } from '../lib/eventModel';

export function TicketDetailPage() {
  const { ticketId = '' } = useParams();
  const ticketState = useTickets();
  const ticket = ticketState.tickets.find((candidate) => candidate.ticketId === ticketId);
  const eventState = usePublishedEventsByIds(ticket ? [ticket.eventId] : []);
  const event = eventState.events[0];

  if (ticketState.loading || eventState.loading) {
    return <main className="pt-28 min-h-screen text-center text-slate-400">Loading ticket…</main>;
  }
  if (!ticket || !event) {
    return (
      <main className="pt-28 min-h-screen text-center text-slate-300">
        {ticketState.error || eventState.error || 'Ticket not found for this account.'}
      </main>
    );
  }

  return (
    <main className="pt-28 pb-24 px-4 max-w-3xl mx-auto min-h-screen">
      <img src={event.imageUrl} alt="" className="h-64 w-full rounded-xl object-cover" />
      <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-[#7C5CFF]">
        {ticket.status} · General Admission
      </p>
      <h1 className="mt-2 text-3xl font-bold">{event.name}</h1>
      <p className="mt-3 text-[#c9c4d8]">{formatEventRange(event)}</p>
      <p className="mt-1 text-[#c9c4d8]">{event.venue}, {event.address}, {event.city}</p>
      <div className="mt-6 rounded-xl border border-[#272C33] bg-[#15181C] p-5">
        <p className="text-xs uppercase tracking-widest text-[#938ea1]">Ticket ID</p>
        <p className="mt-2 font-mono text-[#7C5CFF] break-all">{ticket.ticketId}</p>
      </div>
      <div className="mt-6"><EventActions event={event} /></div>
    </main>
  );
}
