import { Event, EventStatus } from '../../types';
import {
  deriveOrganizerLifecycle,
  formatEventStart,
  ORGANIZER_LIFECYCLE_LABELS,
} from '../../lib/eventModel';

interface OrganizerEventRowProps {
  readonly event: Event;
  readonly ticketsSold: number;
  readonly onOpen: (eventId: string) => void;
}

function StatusBadge({ status, event }: { status: EventStatus; event: Event }) {
  const label = ORGANIZER_LIFECYCLE_LABELS[deriveOrganizerLifecycle(event)];
  if (status === 'Completed') {
    return (
      <span className="bg-[#7C5CFF]/10 text-[#7C5CFF] px-3 py-1 rounded-full text-[12px] font-semibold tracking-wider">
        {label}
      </span>
    );
  }
  if (status === 'Active') {
    return (
      <span className="bg-[#272C33] text-[#EAEFF4]/60 px-3 py-1 rounded-full text-[12px] font-semibold tracking-wider">
        {label}
      </span>
    );
  }
  return (
    <span className="bg-[#272C33] text-[#EAEFF4]/60 px-3 py-1 rounded-full text-[12px] font-semibold tracking-wider">
      {label}
    </span>
  );
}

export function OrganizerEventRow({
  event,
  ticketsSold,
  onOpen,
}: OrganizerEventRowProps) {
  const soldPercent = event.capacity > 0
    ? Math.round((ticketsSold / event.capacity) * 100)
    : 0;

  return (
    <div
      className={`bg-[#15181C]/70 backdrop-blur-md border border-[#272C33] rounded-xl p-6 flex flex-col lg:flex-row items-center gap-6 hover:border-[#7C5CFF]/40 transition-colors ${event.status === 'Active' ? 'opacity-80' : ''}`}
    >
      {/* Thumbnail */}
      <img
        src={event.imageUrl}
        alt={event.name}
        className="w-24 h-24 rounded-lg object-cover border border-[#272C33] flex-shrink-0"
      />

      {/* Event Info */}
      <div className="flex-1 w-full">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="text-2xl font-semibold text-[#EAEFF4]">{event.name}</h3>
            <div className="flex items-center gap-4 mt-1 flex-wrap">
              <span className="flex items-center gap-1 text-[#c9c4d8] text-sm">
                <span className="material-symbols-outlined text-sm">calendar_today</span>
                {formatEventStart(event)}
              </span>
              {event.venue && (
                <span className="flex items-center gap-1 text-[#c9c4d8] text-sm">
                  <span className="material-symbols-outlined text-sm">location_on</span>
                  {event.venue}
                </span>
              )}
            </div>
          </div>
          <StatusBadge status={event.status} event={event} />
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between items-end mb-1">
            <span className="text-[#c9c4d8] text-sm">Sales Progress</span>
            <span className="text-[#EAEFF4] text-sm">
              {ticketsSold} / {(event.capacity ?? 0).toLocaleString()} ({soldPercent}%)
            </span>
          </div>
          <div className="w-full bg-[#272C33] h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-[#7C5CFF] h-full rounded-full transition-all"
              style={{ width: `${soldPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Event actions */}
      <div className="lg:w-64 w-full border-t lg:border-t-0 lg:border-l border-[#272C33] pt-4 lg:pt-0 lg:pl-6 flex flex-col gap-3">
        <button
          onClick={() => onOpen(event.eventId)}
          className="w-full bg-[#7C5CFF] text-white py-2.5 rounded-lg text-xs font-bold"
        >
          Manage Event
        </button>
        <p className="text-center text-xs text-[#938ea1] lg:text-left">
          Lifecycle actions and receipts are available inside this event's management page.
        </p>
      </div>
    </div>
  );
}
