import { useEffect, useState } from 'react';
import { Ticket, formatDateTime, xlmToStroops } from '../types';
import { TicketCard } from '../components/tickets/TicketCard';
import { CollectionSkeleton } from '../components/ui/LoadingSkeleton';
import { usePublishedEventsByIds } from '../hooks/useScopedEvents';

import { generateID } from '../lib/utils';
import { refundTicket, listTicket, cancelListing } from '../lib/soroban';
import { fetchOpenListingByTicket } from '../lib/supabase';
import {
  mirrorCancelledListing,
  mirrorCreatedListing,
  mirrorRefundedTicket,
  synchronizationWarning,
} from '../lib/readModelSync';
import { useAppStore } from '../store/useAppStore';
import type { PurchaseOperationResponse } from '../lib/purchaseOperations';

interface ListingMinimal {
  listing_id?: string;
  listingId?: string;
}

interface MyTicketsPageProps {
  tickets: Ticket[];
  loadingTickets: boolean;
  errorTickets: string | null;
  onViewTicket: (ticketId: string) => void;
  onViewReceipt: (operationId: string) => void;
  onShowQR: (ticketId: string) => void;
  onBrowseMore: () => void;
  invalidateTickets: () => void;
  pendingSync: PurchaseOperationResponse[];
  retryPending: () => void;
}

export function MyTicketsPage({
  tickets,
  loadingTickets,
  errorTickets,
  onViewTicket,
  onViewReceipt,
  onShowQR,
  onBrowseMore,
  invalidateTickets,
  pendingSync,
  retryPending,
}: MyTicketsPageProps) {
  const [activeTab, setActiveTab] = useState<'UPCOMING' | 'PAST'>('UPCOMING');
  const [openListings, setOpenListings] = useState<Record<string, unknown>>({});
  const [showListingModal, setShowListingModal] = useState<string | null>(null);
  const [askPrice, setAskPrice] = useState('');
  const [nowUnix, setNowUnix] = useState(0);

  const { attendeeWallet: wallet, setTxState } = useAppStore();
  const eventState = usePublishedEventsByIds(tickets.map((ticket) => ticket.eventId));
  const events = eventState.events;

  const handleRefund = async (ticketId: string) => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signFn) return;
    setTxState({ status: 'building' });
    try {
      await refundTicket(ticketId, wallet.address, wallet.signFn);

      const syncResult = await mirrorRefundedTicket(ticketId);

      if (syncResult.ok) {
        invalidateTickets();
      }

      setTxState({
        status: 'success',
        message: syncResult.ok ? 'Refund processed successfully' : synchronizationWarning(syncResult),
      });
      setTimeout(() => setTxState({ status: 'idle' }), syncResult.ok ? 3000 : 6000);
    } catch (e: unknown) {
      console.error('Refund failed:', e);
      const msg = e instanceof Error ? e.message : 'Refund failed';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  const handleListForSale = async () => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signFn || !showListingModal) return;

    const price = parseFloat(askPrice);
    if (isNaN(price) || price <= 0) {
      alert("Invalid price.");
      return;
    }

    setTxState({ status: 'building' });

    try {
      const ticket = upcomingTickets.find(t => t.ticketId === showListingModal);
      if (!ticket) throw new Error("Ticket not found.");

      const listingId = generateID();
      const askPriceStroops = xlmToStroops(price);

      await listTicket(
        wallet.address,
        listingId,
        ticket.ticketId,
        ticket.eventId,
        askPriceStroops,
        wallet.signFn
      );

      const syncResult = await mirrorCreatedListing({
        listingId,
        sellerAddress: wallet.address,
        ticketId: ticket.ticketId,
        eventId: ticket.eventId,
        askPriceStroops,
      });

      setShowListingModal(null);
      setAskPrice('');

      if (syncResult.ok) {
        // Refresh local state manually to avoid full reload delay
        setOpenListings(prev => ({ ...prev, [ticket.ticketId]: { listing_id: listingId } }));
      }

      setTxState({
        status: 'success',
        message: syncResult.ok ? 'Ticket listed for sale!' : synchronizationWarning(syncResult),
      });
      setTimeout(() => setTxState({ status: 'idle' }), syncResult.ok ? 3000 : 6000);
    } catch (e: unknown) {
      console.error('List ticket failed:', e);
      const msg = e instanceof Error ? e.message : 'Listing failed';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  const handleCancelListing = async (ticketId: string) => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signFn) return;

    const listing = openListings[ticketId] as ListingMinimal;
    const lid = listing.listing_id || listing.listingId;
    if (!lid) return;

    setTxState({ status: 'building' });
    try {
      await cancelListing(wallet.address, lid, wallet.signFn);

      const syncResult = await mirrorCancelledListing(lid);

      if (syncResult.ok) {
        setOpenListings(prev => {
          const next = { ...prev };
          delete next[ticketId];
          return next;
        });
      }

      setTxState({
        status: 'success',
        message: syncResult.ok ? 'Listing cancelled' : synchronizationWarning(syncResult),
      });
      setTimeout(() => setTxState({ status: 'idle' }), syncResult.ok ? 3000 : 6000);
    } catch (e: unknown) {
      console.error('Cancel listing failed:', e);
      const msg = e instanceof Error ? e.message : 'Cancel failed';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  const loading = loadingTickets || eventState.loading;
  const error = errorTickets || eventState.error;

  const upcomingTickets = tickets.filter((ticket) => {
    const event = events.find((candidate) => candidate.eventId === ticket.eventId);
    const eventEnds = event ? (event.endUnix || event.dateUnix) : 0;
    return ticket.status === 'Active' && eventEnds >= nowUnix;
  });
  const upcomingIds = new Set(upcomingTickets.map((ticket) => ticket.ticketId));
  const pastTickets = tickets.filter((ticket) => !upcomingIds.has(ticket.ticketId)).sort((a, b) => {
    const da = a.purchasedAt ? new Date(a.purchasedAt).getTime() : 0;
    const db = b.purchasedAt ? new Date(b.purchasedAt).getTime() : 0;
    return db - da;
  });

  useEffect(() => {
    const updateNow = () => setNowUnix(Math.floor(Date.now() / 1000));
    updateNow();
    const interval = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const active = tickets.filter((ticket) => ticket.status === 'Active');
    if (active.length === 0) return;

    let isMounted = true;
    async function checkListings() {
      const results: Record<string, unknown> = {};
      await Promise.all(active.map(async (t) => {
        const listing = await fetchOpenListingByTicket(t.ticketId);
        if (listing) {
          results[t.ticketId] = listing;
        }
      }));
      if (isMounted) {
        setOpenListings(results);
      }
    }
    checkListings();
    return () => { isMounted = false; };
  }, [tickets]);

  return (
    <main className="pt-24 pb-32 px-4 md:px-8 max-w-7xl mx-auto min-h-screen">
      {/* Header Section */}
      <section className="mb-10">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">My Tickets</h1>
        <p className="text-[#c9c4d8] text-sm md:text-base">View your event tickets, entry status, and event details.</p>
      </section>
      {pendingSync.length > 0 && (
        <section className="mb-8 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
          <p className="font-semibold">Some confirmed tickets are still syncing.</p>
          <p className="mt-1 text-sm text-amber-200/80">Your payment will not be repeated.</p>
          <button onClick={retryPending} className="mt-3 rounded-lg border border-amber-300/40 px-3 py-2 text-sm">Retry synchronization</button>
        </section>
      )}

      {/* Tabs */}
      <nav className="flex gap-6 border-b border-[#272C33] mb-10">
        <button
          onClick={() => setActiveTab('UPCOMING')}
          className={`pb-4 text-sm font-semibold transition-colors ${activeTab === 'UPCOMING' ? 'border-b-2 border-[#7C5CFF] text-[#7C5CFF]' : 'border-b-2 border-transparent text-[#c9c4d8] hover:text-white'}`}
        >
          UPCOMING
        </button>
        <button
          onClick={() => setActiveTab('PAST')}
          className={`pb-4 text-sm font-semibold transition-colors ${activeTab === 'PAST' ? 'border-b-2 border-[#7C5CFF] text-[#7C5CFF]' : 'border-b-2 border-transparent text-[#c9c4d8] hover:text-white'}`}
        >
          PAST
        </button>
      </nav>

      {/* Ticket Grid */}
      {activeTab === 'UPCOMING' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full">
              <CollectionSkeleton variant="ticket" count={3} />
            </div>
          ) : error ? (
            <div className="col-span-full bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl text-center">
              {error}
            </div>
          ) : (
            upcomingTickets.map(ticket => {
              const event = events.find(e => e.eventId === ticket.eventId);
              if (!event) return null;
              return (
                <TicketCard
                  key={ticket.ticketId}
                  ticket={ticket}
                  event={event}
                  onViewTicket={onViewTicket}
                  onViewReceipt={onViewReceipt}
                  onShowQR={onShowQR}
                  onRefund={event.status === 'Cancelled' ? handleRefund : undefined}
                  onListForSale={() => setShowListingModal(ticket.ticketId)}
                  onCancelListing={() => handleCancelListing(ticket.ticketId)}
                  hasOpenListing={!!openListings[ticket.ticketId]}
                />
              );
            })
          )}

          {/* Browse-more card */}
          {!loading && (
            <button
              onClick={onBrowseMore}
              className="bg-[#15181C] border border-dashed border-[#272C33] rounded-xl flex flex-col items-center justify-center p-16 min-h-[300px] text-center opacity-60 hover:opacity-100 transition-opacity"
            >
              <span className="material-symbols-outlined text-[48px] text-[#c9c4d8] mb-4">add_circle</span>
              <p className="text-xs font-semibold tracking-wider uppercase text-[#e6e0ee]">BROWSE MORE EVENTS</p>
            </button>
          )}
        </div>
      ) : (
        <section className="mt-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">Past tickets</h2>
          </div>
          <div className="bg-[#15181C]/70 backdrop-blur-md border border-[#272C33] rounded-xl p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[#c9c4d8] border-b border-[#272C33]">
                    <th className="pb-4 text-xs font-semibold tracking-wider uppercase">EVENT</th>
                    <th className="pb-4 text-xs font-semibold tracking-wider uppercase">PURCHASED</th>
                    <th className="pb-4 text-xs font-semibold tracking-wider uppercase">STATUS</th>
                    <th className="pb-4 text-xs font-semibold tracking-wider uppercase text-right">ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#272C33]/30">
                  {pastTickets.map(ticket => {
                    const event = events.find(e => e.eventId === ticket.eventId);
                    if (!event) return null;
                    return (
                      <tr key={ticket.ticketId} className="group hover:bg-white/5 transition-colors">
                        <td className="py-6">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded bg-[#272C33] overflow-hidden">
                              <img src={event.imageUrl} alt={event.name} className="w-full h-full object-cover" />
                            </div>
                            <span className="text-base">{event.name}</span>
                          </div>
                        </td>
                        <td className="py-6 text-[#c9c4d8] text-sm">{formatDateTime(ticket.purchasedAt)}</td>
                        <td className="py-6">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                            ticket.status === 'Active' ? 'bg-emerald-500/20 text-emerald-400' :
                            ticket.status === 'Used' ? 'bg-[#272C33] text-slate-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>
                            {ticket.status}
                          </span>
                        </td>
                        <td className="py-6 text-right">
                          <button onClick={() => onViewTicket(ticket.ticketId)} className="text-sm text-[#7C5CFF] hover:underline">
                            View ticket
                          </button>
                          {ticket.receiptOperationId && (
                            <button onClick={() => onViewReceipt(ticket.receiptOperationId!)} className="ml-4 text-sm text-[#c9c4d8] hover:underline">
                              Receipt
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {pastTickets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-400">
                        No past tickets.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {showListingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#15181C] border border-[#272C33] rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-xl font-bold text-white mb-4">List Ticket for Sale</h3>
            <p className="text-sm text-slate-400 mb-6">
              Enter your ask price in XLM. A royalty fee may be automatically deducted by the event organizer upon sale.
            </p>
            <div className="mb-6">
              <label className="block text-xs font-semibold text-[#c9c4d8] uppercase tracking-widest mb-2">Price (XLM)</label>
              <input
                type="number"
                value={askPrice}
                onChange={e => setAskPrice(e.target.value)}
                placeholder="100.00"
                min="0.1"
                step="0.1"
                className="w-full bg-[#0f0d16] border border-[#272C33] rounded-lg px-4 py-3 text-white placeholder:text-slate-600 outline-none focus:border-[#7C5CFF]"
              />
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setShowListingModal(null)}
                className="flex-1 py-3 bg-[#272C33] text-white font-semibold rounded-lg hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleListForSale}
                className="flex-1 py-3 bg-[#7C5CFF] text-white font-semibold rounded-lg hover:brightness-110 transition-colors"
              >
                Confirm Listing
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
