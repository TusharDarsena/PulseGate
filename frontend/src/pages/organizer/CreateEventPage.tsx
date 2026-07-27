import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createEventDraft } from '../../lib/supabase';

export function CreateEventPage() {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void createEventDraft()
      .then((draft) => navigate(`/organizer/drafts/${draft.draft_id}`, { replace: true }))
      .catch((nextError) => {
        started.current = false;
        setError(nextError instanceof Error ? nextError.message : 'Could not create a draft.');
      });
  }, [navigate]);

  return (
    <main className="min-h-screen pt-28 px-4 text-center">
      <h1 className="text-3xl font-bold">Preparing your private draft…</h1>
      <p className="mx-auto mt-3 max-w-xl text-slate-400">
        A stable event ID is reserved now. Nothing is published or submitted to Stellar.
      </p>
      {error && (
        <section className="mx-auto mt-6 max-w-xl rounded-xl border border-red-400/30 bg-red-400/10 p-5 text-red-100">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-[#7C5CFF] px-4 py-2 font-semibold text-white"
          >
            Try again
          </button>
        </section>
      )}
    </main>
  );
}
