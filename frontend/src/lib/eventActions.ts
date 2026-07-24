import { formatInTimeZone } from 'date-fns-tz';
import { createEvent as createIcsEvent } from 'ics';
import type { Event } from '../types';

function publicOrigin(): string {
  const configured = import.meta.env.VITE_APP_ORIGIN as string | undefined;
  return (configured || window.location.origin).replace(/\/+$/, '');
}

export function eventUrl(event: Event): string {
  return `${publicOrigin()}/events/${encodeURIComponent(event.eventId)}`;
}

function utcCalendarStamp(unix: number): string {
  return formatInTimeZone(new Date(unix * 1000), 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function location(event: Event): string {
  return [event.venue, event.address, event.city].filter(Boolean).join(', ');
}

function calendarDescription(event: Event): string {
  return [
    event.summary,
    '',
    `Entry: ${event.entryInstructions}`,
    '',
    eventUrl(event),
  ].join('\n');
}

export function googleCalendarUrl(event: Event): string {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', event.name);
  url.searchParams.set(
    'dates',
    `${utcCalendarStamp(event.dateUnix)}/${utcCalendarStamp(event.endUnix)}`,
  );
  url.searchParams.set('ctz', event.timezone);
  url.searchParams.set('details', calendarDescription(event));
  url.searchParams.set('location', location(event));
  return url.toString();
}

export function outlookCalendarUrl(event: Event): string {
  const url = new URL('https://outlook.live.com/calendar/0/deeplink/compose');
  url.searchParams.set('path', '/calendar/action/compose');
  url.searchParams.set('rru', 'addevent');
  url.searchParams.set('subject', event.name);
  url.searchParams.set('startdt', new Date(event.dateUnix * 1000).toISOString());
  url.searchParams.set('enddt', new Date(event.endUnix * 1000).toISOString());
  url.searchParams.set('body', calendarDescription(event));
  url.searchParams.set('location', location(event));
  return url.toString();
}

export function mapsUrl(event: Event): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', location(event));
  return url.toString();
}

export function downloadIcs(event: Event): void {
  const result = createIcsEvent({
    start: event.dateUnix * 1000,
    end: event.endUnix * 1000,
    startInputType: 'utc',
    startOutputType: 'utc',
    endInputType: 'utc',
    endOutputType: 'utc',
    title: event.name,
    description: calendarDescription(event),
    location: location(event),
    url: eventUrl(event),
    categories: [event.category],
    uid: `${event.eventId}@stellartickets`,
    status: event.status === 'Cancelled' ? 'CANCELLED' : 'CONFIRMED',
    productId: 'StellarTickets/Phase2',
  });
  if (result.error || !result.value) {
    throw result.error || new Error('Calendar file could not be generated.');
  }
  const blob = new Blob([result.value], { type: 'text/calendar;charset=utf-8' });
  const anchor = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  anchor.href = objectUrl;
  anchor.download = `${event.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'event'}.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function shareEvent(event: Event): Promise<'shared' | 'copied'> {
  const data = {
    title: event.name,
    text: event.summary,
    url: eventUrl(event),
  };
  if (navigator.share) {
    await navigator.share(data);
    return 'shared';
  }
  await navigator.clipboard.writeText(data.url);
  return 'copied';
}
