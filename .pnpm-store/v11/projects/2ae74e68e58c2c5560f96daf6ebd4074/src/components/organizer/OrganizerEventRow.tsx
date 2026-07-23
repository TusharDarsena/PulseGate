import React, { useState } from 'react';
import { Event, EventStatus, formatEventDate } from '../../types';

interface OrganizerEventRowProps {
  readonly event: Event;
  readonly ticketsSold: number;
  readonly escrowXlm: number;
  readonly canRelease: boolean;
  readonly lockedUntilLabel?: string;
  readonly onRelease: (eventId: string) => void;
  readonly onCancel?: (eventId: string) => void;
  readonly onOpen: (eventId: string) => void;
}

function StatusBadge({ status }: { status: EventStatus }) {
  if (status === 'Completed') {
    return (
      <span className="bg-[#7C5CFF]/10 text-[#7C5CFF] px-3 py-1 rounded-full text-[12px] font-semibold tracking-wider">
        Completed
      </span>
    );
  }
  if (status === 'Active') {
    return (
      <span className="bg-[#272C33] text-[#EAEFF4]/60 px-3 py-1 rounded-full text-[12px] font-semibold tracking-wider">
        Upcoming
      </span>
    );
  }
  return (
    <span className="bg-[#272C33] text-[#EAEFF4]/60 px-3 py-1 rounded-full text-[12px] font-semibold tracking-wider">
      Pending
    </span>
  );
}

export function OrganizerEventRow({
  event,
  ticketsSold,
  escrowXlm,
  canRelease,
  lockedUntilLabel,
  onRelease,
  onCancel,
  onOpen,
}: OrganizerEventRowProps) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const soldPercent = event.capacity > 0
    ? Math.round((ticketsSold / event.capacity) * 100)
    : 0;

  return (
    <div
      className={`bg-[#15181C]/70 backdrop-blur-md border border-[#272C33] rounded-xl p-6 flex flex-col lg:flex-row items-center gap-6 hover:border-[#7C5CFF]/40 transition-colors ${event.status === 'Active' ? 'opacity-80' : ''}`}
    >
      {/* Thumbnail */}
      <img
        src={event.imageUrl ?? 'https://images.unsplash.com/photo-1540039155732-d67414006c3a?w=200&q=80'}
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
                {formatEventDate(event.dateUnix)}
              </span>
              {event.venue && (
                <span className="flex items-center gap-1 text-[#c9c4d8] text-sm">
                  <span className="material-symbols-outlined text-sm">location_on</span>
                  {event.venue}
                </span>
              )}
            </div>
          </div>
          <StatusBadge status={event.status} />
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

      {/* Escrow panel */}
      <div className="lg:w-64 w-full border-t lg:border-t-0 lg:border-l border-[#272C33] pt-4 lg:pt-0 lg:pl-6 flex flex-col gap-3">
        <button
          onClick={() => onOpen(event.eventId)}
          className="w-full bg-[#7C5CFF] text-white py-2.5 rounded-lg text-xs font-bold"
        >
          Manage Event
        </button>
        <div className="text-center lg:text-left">
          <p className="text-[#c9c4d8] text-xs font-semibold uppercase tracking-wider">
            {canRelease ? 'Available to Release' : 'Locked in Escrow'}
          </p>
          <p className="text-[#EAEFF4] text-2xl font-semibold">
            {escrowXlm.toLocaleString()} XLM
          </p>
        </div>

        {canRelease ? (
          <button
            onClick={() => onRelease(event.eventId)}
            className="w-full bg-[#ffb4ab] text-[#690005] py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-sm">lock_open</span>
            Release Funds
          </button>
        ) : (
          <button
            disabled
            className="w-full bg-[#272C33] text-[#EAEFF4]/30 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm">lock</span>
            {lockedUntilLabel ?? 'Locked'}
          </button>
        )}
        
        {event.status === 'Active' && onCancel && (
          <>
            {showCancelConfirm ? (
              <div className="w-full mt-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-xs text-red-400 mb-3 text-center leading-relaxed">
                  This will cancel the event and allow all attendees to claim refunds. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    className="flex-1 py-2 bg-[#272C33] text-white rounded-lg text-xs font-bold hover:bg-white/10 transition-colors"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={() => { setShowCancelConfirm(false); onCancel(event.eventId); }}
                    className="flex-1 py-2 bg-red-500 text-white rounded-lg text-xs font-bold hover:opacity-90 transition-opacity"
                  >
                    Confirm Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="w-full mt-2 border border-red-500/30 text-red-400 py-2 rounded-lg text-xs font-bold hover:bg-red-500/10 transition-colors"
              >
                Cancel Event
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
