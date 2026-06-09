import React, { useState, useEffect } from 'react';
import { Event } from '../../types';
import { OrganizerEventRow } from '../../components/organizer/OrganizerEventRow';

interface DashboardPageProps {
  readonly events: Event[];
  readonly onCreateEvent: () => void;
  readonly onScanTickets: () => void;
  readonly invalidateEvents: () => Promise<void>;
}

import { useAppStore } from '../../store/useAppStore';
import { useWallet } from '../../hooks/useWallet';
import { releaseFunds, cancelEvent } from '../../lib/soroban';
import {
  mirrorCancelledEvent,
  mirrorCompletedEvent,
  synchronizationWarning,
} from '../../lib/readModelSync';

export function DashboardPage({ events, onCreateEvent, onScanTickets, invalidateEvents }: DashboardPageProps) {
  const { wallet, setTxState } = useAppStore();
  const { connectOrganizer } = useWallet();
  const [now, setNow] = useState(0);

  useEffect(() => {
    setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const organizerEvents = wallet.publicKey
    ? events.filter(e => e.organizer === wallet.publicKey)
    : [];

  const activeEvents = organizerEvents.filter(e => e.status === 'Active');

  const totalEvents = organizerEvents.length;
  const totalTicketsSold = organizerEvents.reduce((s, event) => s + (event.currentSupply ?? 0), 0);
  const totalEscrow = activeEvents.reduce((s, event) => s + ((event.currentSupply ?? 0) * ((event.pricePerTicket ?? 0) / 10_000_000)), 0);

  const handleRelease = async (eventId: string) => {
    if (!wallet.isConnected || !wallet.publicKey || !wallet.signFn) return;
    setTxState({ status: 'signing' });
    try {
      await releaseFunds(eventId, wallet.publicKey, wallet.signFn);
      
      const syncResult = await mirrorCompletedEvent(eventId);
      if (syncResult.ok) await invalidateEvents();

      setTxState({
        status: 'success',
        message: syncResult.ok ? 'Funds released successfully!' : synchronizationWarning(syncResult),
      });
      setTimeout(() => setTxState({ status: 'idle' }), syncResult.ok ? 3000 : 6000);
    } catch (e: unknown) {
      console.error('Release funds failed', e);
      const msg = e instanceof Error ? e.message : 'Failed to release funds';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  const handleCancel = async (eventId: string) => {
    if (!wallet.isConnected || !wallet.publicKey || !wallet.signFn) return;
    setTxState({ status: 'signing' });
    try {
      await cancelEvent(eventId, wallet.publicKey, wallet.signFn);
      
      const syncResult = await mirrorCancelledEvent(eventId);
      if (syncResult.ok) await invalidateEvents();

      setTxState({
        status: 'success',
        message: syncResult.ok ? 'Event cancelled successfully.' : synchronizationWarning(syncResult),
      });
      setTimeout(() => setTxState({ status: 'idle' }), syncResult.ok ? 3000 : 6000);
    } catch (e: unknown) {
      console.error('Cancel event failed', e);
      const msg = e instanceof Error ? e.message : 'Failed to cancel event';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  if (!wallet.isConnected) {
    return (
      <div className="bg-[#14121b] text-[#e6e0ee] min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 w-full overflow-x-hidden text-center">
        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 tracking-tighter text-center w-full max-w-4xl">Organizer Hub</h1>
        <p className="text-[#c9c4d8] mb-8 sm:mb-10 w-full max-w-xs sm:max-w-md md:max-w-2xl lg:max-w-3xl text-center mx-auto leading-relaxed text-sm sm:text-base">
          Connect your Freighter wallet to manage events, scan tickets, and withdraw funds.
        </p>
        <button
          onClick={connectOrganizer}
          className="bg-[#7C5CFF] hover:bg-[#8d72ff] text-[#EAEFF4] font-semibold text-lg py-3 px-8 rounded-xl transition-all shadow-[0_0_20px_rgba(124,92,255,0.3)] active:scale-[0.98]"
        >
          Connect Freighter
        </button>
      </div>
    );
  }

  return (
    <div className="bg-[#14121b] text-[#e6e0ee] min-h-screen pt-16">
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-10 sm:py-12 pb-24 sm:pb-32">
        {/* Header Actions */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-16">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-[#e6e0ee] tracking-tight">Organizer Hub</h1>
            <p className="text-base text-[#c9c4d8] mt-1">
              Manage your stellar event inventory and settlements.
            </p>
          </div>
          <div className="flex items-center gap-4 w-full md:w-auto">
            <button
              onClick={onScanTickets}
              className="flex-1 md:flex-none border border-[#272C33] text-[#e6e0ee] px-6 py-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#272C33] transition-all"
            >
              <span className="material-symbols-outlined">qr_code_scanner</span>
              Scan Tickets
            </button>
            <button
              onClick={onCreateEvent}
              className="flex-1 md:flex-none bg-[#7C5CFF] text-[#EAEFF4] px-6 py-3 rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:brightness-110 transition-all shadow-[0_0_20px_rgba(124,92,255,0.2)]"
            >
              <span className="material-symbols-outlined">add_circle</span>
              Create Event
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {/* Total Events */}
          <div className="bg-[#15181C]/70 backdrop-blur-md border border-[#272C33] p-6 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl">event</span>
            </div>
            <p className="text-[#c9c4d8] text-[10px] font-semibold uppercase tracking-widest mb-2">
              Total Events
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-[#e6e0ee]">{totalEvents}</span>
            </div>
          </div>

          {/* Tickets Sold */}
          <div className="bg-[#15181C]/70 backdrop-blur-md border border-[#272C33] p-6 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl">confirmation_number</span>
            </div>
            <p className="text-[#c9c4d8] text-[10px] font-semibold uppercase tracking-widest mb-2">
              Tickets Sold
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-[#e6e0ee]">
                {totalTicketsSold.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Escrow */}
          <div className="bg-[#15181C]/70 backdrop-blur-md border border-[#272C33] p-6 rounded-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <span className="material-symbols-outlined text-6xl">account_balance_wallet</span>
            </div>
            <p className="text-[#c9c4d8] text-[10px] font-semibold uppercase tracking-widest mb-2">
              In Escrow (XLM)
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-[#7C5CFF]">
                {totalEscrow.toLocaleString()}.00
              </span>
              <span className="text-[#c9c4d8] font-mono text-sm">XLM</span>
            </div>
          </div>
        </section>

        {/* Active Events */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-[#e6e0ee]">Active Events</h2>
            <div className="flex gap-2">
              <span className="text-xs font-semibold text-[#c9c4d8]">Sorted by:</span>
              <span className="text-xs font-semibold text-[#7C5CFF] cursor-pointer border-b border-[#7C5CFF]/30">
                Upcoming
              </span>
            </div>
          </div>

          {organizerEvents.map((event) => {
            const ticketsSold = event.currentSupply;
            const escrowXlm = event.status === 'Active' ? ticketsSold * (event.pricePerTicket / 10_000_000) : 0;
            const canRelease = event.status === 'Active' && event.dateUnix * 1000 < now;
            const lockedUntilLabel = canRelease || event.status === 'Completed' || event.status === 'Cancelled' ? undefined : `Locked Until ${new Date(event.dateUnix * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

            return (
              <OrganizerEventRow
                key={event.eventId}
                event={event}
                ticketsSold={ticketsSold}
                escrowXlm={escrowXlm}
                canRelease={canRelease}
                lockedUntilLabel={lockedUntilLabel}
                onRelease={handleRelease}
                onCancel={handleCancel}
              />
            );
          })}
        </section>

        {/* Transaction History */}
        <section className="mt-16">
          <div className="flex items-center gap-2 mb-6">
            <span className="material-symbols-outlined text-[#7C5CFF]">history</span>
            <h2 className="text-2xl font-semibold text-[#e6e0ee]">Stellar Transaction History</h2>
          </div>

          <div className="bg-[#15181C]/70 backdrop-blur-md border border-[#272C33] rounded-xl p-8 text-center text-slate-400">
            Transaction history coming soon
          </div>
        </section>
      </main>
    </div>
  );
}
