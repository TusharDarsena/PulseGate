import { useNavigate, useParams } from 'react-router-dom';
import { useWallet } from '../../hooks/useWallet';
import { useAppStore } from '../../store/useAppStore';
import { useEvent } from '../../hooks/useEvent';
import { formatEventRange } from '../../lib/eventModel';

export function OrganizerEventPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const wallet = useAppStore((state) => state.organizerWallet);
  const { connectOrganizer } = useWallet();
  const { event, loading, error } = useEvent(eventId);

  if (!wallet.isConnected) {
    return (
      <main className="min-h-screen pt-28 px-4 text-center">
        <h1 className="text-3xl font-bold mb-4">Organizer wallet required</h1>
        <button onClick={() => void connectOrganizer()} className="bg-[#7C5CFF] px-4 py-2 rounded-lg">Connect Freighter</button>
      </main>
    );
  }
  if (loading) return <main className="min-h-screen pt-28 text-center">Loading event…</main>;
  if (!event) return <main className="min-h-screen pt-28 text-center">{error ?? 'Event not found.'}</main>;
  if (event.organizer !== wallet.publicKey) {
    return <main className="min-h-screen pt-28 text-center text-red-400">This Freighter account is not the event organizer.</main>;
  }
  return (
    <main className="min-h-screen pt-28 pb-24 px-4 max-w-3xl mx-auto">
      <h1 className="text-4xl font-bold">{event.name}</h1>
      <p className="text-slate-400 mt-2">{formatEventRange(event)} · {event.venue}</p>
      <section className="mt-8 rounded-xl border border-[#272C33] bg-[#15181C] p-6">
        <h2 className="text-xl font-semibold">Check-in</h2>
        <p className="text-slate-400 mt-2 mb-5">Scanner access is scoped to this organizer event.</p>
        <button onClick={() => navigate(`/organizer/events/${eventId}/check-in`)}
          className="bg-[#7C5CFF] px-4 py-2 rounded-lg">
          Open scanner
        </button>
      </section>
    </main>
  );
}
