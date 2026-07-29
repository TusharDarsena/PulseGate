import { OrganizerEventRow } from '../../components/organizer/OrganizerEventRow';
import { Skeleton } from '../../components/ui/LoadingSkeleton';
import { useOrganizerDrafts, useOrganizerEvents } from '../../hooks/useScopedEvents';

interface DashboardPageProps {
  readonly onCreateEvent: () => void;
  readonly onOpenDraft: (draftId: string) => void;
  readonly onOpenEvent: (eventId: string) => void;
}

export function DashboardPage({
  onCreateEvent,
  onOpenDraft,
  onOpenEvent,
}: DashboardPageProps) {
  const eventState = useOrganizerEvents();
  const draftState = useOrganizerDrafts();
  const openDrafts = draftState.drafts.filter((draft) => draft.state !== 'published');
  const hasWorkspace = openDrafts.length > 0 || eventState.events.length > 0;
  const initialLoading = !hasWorkspace && (eventState.loading || draftState.loading);

  return (
    <div className="min-h-screen bg-[#14121b] pt-16 text-[#e6e0ee]">
      <main className="mx-auto max-w-7xl px-4 py-10 pb-28 md:px-8">
        <header className="mb-12 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Organizer Hub</h1>
            <p className="mt-2 max-w-2xl text-[#c9c4d8]">
              Draft ownership comes from your signed-in account. Connect Freighter only when an
              on-chain action needs the organizer signature.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateEvent}
            className="rounded-lg bg-[#7C5CFF] px-6 py-3 text-sm font-bold text-white"
          >
            Create event
          </button>
        </header>

        {(eventState.error || draftState.error) && (
          <div className="mb-8 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">
            {draftState.error ?? eventState.error}
          </div>
        )}

        {initialLoading ? (
          <OrganizerWorkspaceSkeleton />
        ) : !hasWorkspace ? (
          <section className="rounded-2xl border border-[#272C33] bg-[#15181C] p-10 text-center">
            <span className="material-symbols-outlined text-5xl text-[#9f8cff]">event_note</span>
            <h2 className="mt-4 text-2xl font-semibold">Prepare your first event</h2>
            <p className="mx-auto mt-3 max-w-xl text-[#c9c4d8]">
              Start a private, recoverable draft. Nothing reaches Stellar or public discovery
              until you complete the review and approve publication.
            </p>
            <button type="button" onClick={onCreateEvent} className="mt-6 rounded-lg bg-[#7C5CFF] px-5 py-3 font-semibold">
              Create a private draft
            </button>
          </section>
        ) : (
          <>
            <section className="mb-12 grid gap-5 sm:grid-cols-2">
              <Metric label="Private drafts" value={openDrafts.length} icon="draft" />
              <Metric label="Published events" value={eventState.events.length} icon="event_available" />
            </section>

            <section className="mb-14">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Private drafts</h2>
                {draftState.loading && <span className="text-sm text-slate-400">Refreshing…</span>}
              </div>
              {openDrafts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#343941] p-6 text-slate-400">
                  No open drafts.
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {openDrafts.map((draft) => (
                    <button
                      type="button"
                      key={draft.draft_id}
                      onClick={() => onOpenDraft(draft.draft_id)}
                      className="rounded-xl border border-[#272C33] bg-[#15181C] p-5 text-left transition-colors hover:border-[#7C5CFF]/60"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-xl font-semibold">{draft.expected_name || 'Untitled event'}</h3>
                          <p className="mt-2 text-sm text-slate-400">
                            Updated {new Date(draft.updated_at).toLocaleString()}
                          </p>
                        </div>
                        <span className="rounded-full bg-[#272C33] px-3 py-1 text-xs">
                          {draft.state === 'prepared' ? 'Ready to edit' : draft.state.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <p className="mt-4 truncate font-mono text-xs text-slate-500">
                        Event ID {draft.event_id}
                      </p>
                      <span className="mt-4 inline-block text-sm font-semibold text-[#cabeff]">Continue editing →</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-semibold">Published events</h2>
                {eventState.loading && <span className="text-sm text-slate-400">Refreshing…</span>}
              </div>
              {eventState.events.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#343941] p-6 text-slate-400">
                  No published events yet.
                </p>
              ) : (
                eventState.events.map((event) => (
                  <OrganizerEventRow
                    key={event.eventId}
                    event={event}
                    ticketsSold={event.currentSupply}
                    onOpen={onOpenEvent}
                  />
                ))
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function OrganizerWorkspaceSkeleton() {
  return (
    <div className="space-y-12" aria-busy="true" aria-label="Loading organizer workspace">
      <section className="grid gap-5 sm:grid-cols-2">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </section>
      <section className="space-y-5">
        <Skeleton className="h-7 w-40" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-[#272C33] bg-[#15181C] p-6">
      <span className="material-symbols-outlined absolute right-4 top-4 text-5xl text-[#7C5CFF]/20">{icon}</span>
      <p className="text-xs font-semibold uppercase tracking-widest text-[#c9c4d8]">{label}</p>
      <p className="mt-2 text-4xl font-semibold">{value}</p>
    </div>
  );
}
