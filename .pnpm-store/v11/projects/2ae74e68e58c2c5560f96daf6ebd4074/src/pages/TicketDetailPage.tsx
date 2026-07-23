import { useParams } from 'react-router-dom';

export function TicketDetailPage() {
  const { ticketId } = useParams();
  return (
    <main className="pt-28 pb-24 px-4 max-w-3xl mx-auto min-h-screen">
      <h1 className="text-3xl font-bold mb-4">Ticket</h1>
      <p className="font-mono text-[#7C5CFF] break-all">{ticketId}</p>
      <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-200">
        Sign-in protection is active. Authoritative ownership enforcement for this destination
        will be added with trusted reconciliation in Phase 4. This page does not claim ownership.
      </div>
    </main>
  );
}
