import { useState } from 'react';
import {
  downloadIcs,
  googleCalendarUrl,
  mapsUrl,
  outlookCalendarUrl,
  shareEvent,
} from '../../lib/eventActions';
import type { Event } from '../../types';

export function EventActions({ event, compact = false }: { event: Event; compact?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);

  const share = async () => {
    try {
      const result = await shareEvent(event);
      setMessage(result === 'copied' ? 'Event link copied.' : 'Event shared.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : 'Could not share event.');
    }
  };

  const linkClass =
    'rounded-lg border border-[#36333e] px-3 py-2 text-sm text-[#c9c4d8] hover:border-[#7C5CFF] hover:text-white transition-colors';

  if (compact) {
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void share()} className={linkClass}>Share</button>
          <button type="button" onClick={() => downloadIcs(event)} className={linkClass}>Add to calendar</button>
          <a href={mapsUrl(event)} target="_blank" rel="noreferrer" className={linkClass}>Map</a>
        </div>
        {message && <p className="mt-2 text-xs text-[#938ea1]">{message}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void share()} className={linkClass}>
          Share event
        </button>
        <a href={googleCalendarUrl(event)} target="_blank" rel="noreferrer" className={linkClass}>
          Google Calendar
        </a>
        <a href={outlookCalendarUrl(event)} target="_blank" rel="noreferrer" className={linkClass}>
          Outlook
        </a>
        <button type="button" onClick={() => downloadIcs(event)} className={linkClass}>
          Download .ics
        </button>
        <a href={mapsUrl(event)} target="_blank" rel="noreferrer" className={linkClass}>
          Open in maps
        </a>
      </div>
      {message && <p className="text-xs text-[#938ea1]">{message}</p>}
    </div>
  );
}
