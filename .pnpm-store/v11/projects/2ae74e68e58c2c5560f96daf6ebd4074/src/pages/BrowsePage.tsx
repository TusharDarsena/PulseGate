import React, { useState, useMemo } from 'react';
import { Event, stroopsToXlm, formatEventDate } from '../types';

interface BrowsePageProps {
  events: Event[];
  loading: boolean;
  error: string | null;
  onEventClick: (eventId: string) => void;
}

const CATEGORIES = ['All', 'Music', 'Sports', 'Theater', 'Comedy', 'Festivals', 'Tech'];

const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80';

/* ── Skeleton ─────────────────────────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="bg-[#15181C] border border-[#272C33] rounded-xl overflow-hidden animate-pulse">
      <div className="aspect-video bg-[#272C33]/50" />
      <div className="p-5 space-y-3">
        <div className="h-6 bg-[#272C33]/50 rounded w-3/4" />
        <div className="space-y-2">
          <div className="h-4 bg-[#272C33]/50 rounded w-1/2" />
          <div className="h-4 bg-[#272C33]/50 rounded w-2/3" />
        </div>
        <div className="flex justify-between items-center pt-2 border-t border-[#272C33]/30">
          <div className="space-y-1">
            <div className="h-2 bg-[#272C33]/50 rounded w-8" />
            <div className="h-6 bg-[#272C33]/50 rounded w-20" />
          </div>
          <div className="h-10 bg-[#272C33]/50 rounded-lg w-28" />
        </div>
      </div>
    </div>
  );
}


/* ── BrowsePage ───────────────────────────────────────────────────────────── */
export function BrowsePage({ events, loading, error, onEventClick }: BrowsePageProps) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      const matchesCategory =
        activeCategory === 'All' ||
        event.category?.toLowerCase() === activeCategory.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (event.venue ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (event.city ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [events, activeCategory, searchQuery]);

  const ticketsLeft = (event: Event) => Math.max(0, event.capacity - event.currentSupply);

  const ticketsLeftLabel = (event: Event) => {
    const left = ticketsLeft(event);
    if (left === 0) return '0 LEFT';
    if (left >= 150) return '150+ LEFT';
    return `${left} LEFT`;
  };

  return (
    <>
      {/*
        pt-20  → clears the fixed top nav (h-16) with a little breathing room on mobile
        pt-24  → extra clearance on md+ where the nav may be taller
        pb-24  → clears the fixed bottom nav on mobile
        md:pb-20 → normal bottom padding on desktop (no bottom nav)
      */}
      <main className="pt-20 md:pt-24 pb-24 md:pb-20 max-w-7xl mx-auto px-4 md:px-8 min-h-screen w-full overflow-x-hidden">

        {/* ── Hero ── */}
        <div className="mb-8 md:mb-10">
          <h1 className="text-page-title text-on-surface mb-2">
            Explore Experiences
          </h1>
          <p className="text-on-surface-variant text-sm md:text-base max-w-2xl">
            Discover exclusive NFT-backed events. Secure, verifiable, and permanent digital
            collectibles for every ticket.
          </p>
        </div>

        {/* ── Search + Category bar ── */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6 md:mb-8">

          {/* Search — full-width on mobile, fixed-width on sm+ */}
          <div className="flex items-center bg-[#15181C] border border-[#272C33] rounded-lg px-3 py-2 focus-within:border-[#7C5CFF] transition-all w-full sm:w-64 flex-shrink-0">
            <span className="material-symbols-outlined text-outline-variant text-sm mr-2">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search events..."
              className="bg-transparent border-none focus:ring-0 text-sm text-on-surface placeholder:text-outline-variant w-full outline-none"
            />
          </div>

          {/*
            Category chips:
            -mx-4 px-4   → bleed to screen edges on mobile so chips scroll fully edge-to-edge
            sm:mx-0 sm:px-0 → reset on larger screens
            overflow-x-auto + [scrollbar-width:none] + [-ms-overflow-style:none] → hide scrollbar
          */}
          <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 flex-1 no-scrollbar min-w-0">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap px-4 sm:px-6 py-2 sm:py-2.5 rounded-full text-sm font-medium tracking-wide transition-all duration-200 active:scale-95 flex-shrink-0 ${activeCategory === cat
                    ? 'bg-primary-container text-on-primary-container shadow-lg shadow-primary-container/20'
                    : 'bg-[#15181C] border border-[#272C33] text-on-surface-variant hover:bg-[#272C33] hover:text-white'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* ── States ── */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 w-full">
            {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-red-400 text-3xl">wifi_off</span>
            </div>
            <p className="text-red-400 font-semibold text-base font-semibold">Service Unavailable</p>
            <p className="text-sm text-outline text-center max-w-xs">{error}</p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <span className="material-symbols-outlined text-outline text-[48px]">search_off</span>
            <div>
              <p className="text-on-surface font-semibold text-lg font-semibold mb-1">No events found</p>
              <p className="text-sm text-outline">
                {searchQuery ? 'Try a different search term.' : 'Be the first to create one!'}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 w-full">
            {filteredEvents.map(event => {
              const left = ticketsLeft(event);
              const isSoldOut = left === 0 || event.status !== 'Active';

              return (
                <div
                  key={event.eventId}
                  onClick={() => onEventClick(event.eventId)}
                  className="group bg-[#15181C] border border-[#272C33] rounded-xl overflow-hidden hover:border-[#7C5CFF]/50 transition-all duration-300 shadow-xl hover:shadow-[#7C5CFF]/10 cursor-pointer flex flex-col"
                >
                  {/* Image */}
                  <div className="relative aspect-video overflow-hidden flex-shrink-0">
                    <img
                      src={event.imageUrl || FALLBACK_IMAGE}
                      alt={event.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      onError={e => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE; }}
                    />
                    {/* Status badge */}
                    <div
                      className={`absolute top-3 left-3 px-2 py-1 rounded text-[10px] font-bold tracking-wider uppercase ${event.status === 'Active'
                          ? 'bg-primary-container text-on-primary-container'
                          : 'bg-surface-container-highest text-secondary'
                        }`}
                    >
                      {event.status}
                    </div>
                    {/* Tickets left badge */}
                    <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md text-white px-2 py-1 rounded text-[10px] font-bold">
                      {ticketsLeftLabel(event)}
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="p-4 sm:p-5 flex flex-col flex-grow">
                    {/* Title — smaller on mobile to avoid overflow */}
                    <h3 className="text-card-title text-on-surface mb-3 group-hover:text-[#7C5CFF] transition-colors truncate">
                      {event.name}
                    </h3>

                    <div className="space-y-2 mb-4 sm:mb-5 flex-grow">
                      <div className="flex items-center gap-2 text-on-surface-variant">
                        <span className="material-symbols-outlined text-[18px] flex-shrink-0">location_on</span>
                        <span className="text-sm truncate">
                          {[event.venue, event.city].filter(Boolean).join(', ') || 'Venue TBA'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-on-surface-variant">
                        <span className="material-symbols-outlined text-[18px] flex-shrink-0">calendar_today</span>
                        <span className="text-sm">{formatEventDate(event.dateUnix)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-[#272C33]/30">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-outline uppercase font-bold tracking-widest">Price</span>
                        {/* Price — tighter on very small screens */}
                        <span className="text-price text-[#7C5CFF]">
                          {stroopsToXlm(event.pricePerTicket)} XLM
                        </span>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); onEventClick(event.eventId); }}
                        disabled={isSoldOut}
                        className={`px-4 sm:px-5 py-2.5 rounded-lg text-sm font-bold tracking-wide transition-all active:scale-95 ${isSoldOut
                            ? 'bg-[#272C33] text-on-surface/40 cursor-not-allowed'
                            : 'bg-[#7C5CFF] text-[#EAEFF4] hover:brightness-110 shadow-lg shadow-[#7C5CFF]/20'
                          }`}
                      >
                        {isSoldOut ? 'Sold Out' : 'Get Tickets'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="pb-safe" />
      </main>

    </>
  );
}