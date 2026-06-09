import React from 'react';
import { Event, stroopsToXlm, formatEventDate } from '../types';
import { Button } from '../components/ui/Button';
import { useAppStore } from '../store/useAppStore';
import { purchaseTicket } from '../lib/soroban';
import { generateID } from '../lib/utils';

import { useWallet } from '../hooks/useWallet';
import { useXlmPrice } from '../hooks/useXlmPrice';

import { mirrorPurchasedTicket, synchronizationWarning } from '../lib/readModelSync';

interface PurchasePageProps {
  eventId: string;
  events: Event[];
  onBack: () => void;
  onPurchaseComplete: (ticketId: string) => void;
  invalidateEvents: () => Promise<void>;
  invalidateTickets: () => void;
}

export function PurchasePage({ eventId, events, onBack, onPurchaseComplete, invalidateEvents, invalidateTickets }: PurchasePageProps) {
  const event = events.find(e => e.eventId === eventId);

  const quantity = 1;
  const { wallet, setTxState } = useAppStore();
  const { connectAttendee } = useWallet();
  const { usdPerXlm } = useXlmPrice();
  const priceXlm = event ? parseFloat(stroopsToXlm(event.pricePerTicket)) : 0;
  const totalPrice = priceXlm * quantity;
  const totalUsd = usdPerXlm ? totalPrice * usdPerXlm : null;

  if (!event) return <div className="p-20 text-center text-slate-400">Event not found</div>;

  const handlePurchase = async () => {
    if (!wallet.isConnected || !wallet.publicKey || !wallet.signFn) return;

    setTxState({ status: 'building' });
    try {
      const ticketId = generateID();
      await purchaseTicket(event.eventId, wallet.publicKey, ticketId, wallet.signFn);
      
      const syncResult = await mirrorPurchasedTicket({
        ticketId,
        eventId: event.eventId,
        ownerAddress: wallet.publicKey,
      });

      if (syncResult.ok) {
        await invalidateEvents();
        invalidateTickets();
      }

      setTxState({
        status: 'success',
        message: syncResult.ok ? undefined : synchronizationWarning(syncResult),
      });

      // Wait for success animation before navigating
      setTimeout(() => {
        setTxState({ status: 'idle' });
        onPurchaseComplete(ticketId);
      }, syncResult.ok ? 1500 : 6000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Purchase failed';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  return (
    <div className="bg-[#0E1113] min-h-screen text-[#EAEFF4]">

      <main className="pt-24 pb-32 px-4 md:px-8 max-w-7xl mx-auto">
        {/* Progress Indicator */}
        <div className="flex items-center justify-between mb-8 px-2">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#7C5CFF] text-white flex items-center justify-center font-bold">1</div>
            <span className="text-xs font-semibold text-[#7C5CFF]">Quantity</span>
          </div>
          <div className="h-[1px] flex-1 bg-[#272C33] mx-4 -mt-6"></div>
          <div className="flex flex-col items-center gap-2 opacity-40">
            <div className="w-8 h-8 rounded-full bg-[#272C33] text-white flex items-center justify-center font-bold">2</div>
            <span className="text-xs font-semibold">Confirm</span>
          </div>
        </div>

        {/* Event Summary Card */}
        <div className="bg-[#15181C] border border-[#272C33] rounded-xl overflow-hidden mb-8">
          <div className="flex flex-col md:flex-row">
            <div className="w-full md:w-48 h-48 md:h-auto overflow-hidden">
              <img src={event.imageUrl} alt={event.name} className="w-full h-full object-cover" />
            </div>
            <div className="p-6 flex flex-col justify-center gap-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-[#7C5CFF]/10 text-[#7C5CFF] text-[10px] font-bold rounded uppercase tracking-wider">On Sale</span>
                <span className="text-xs font-semibold text-[#938ea1]">NFT Pass • Stellar Network</span>
              </div>
              <h2 className="text-2xl font-bold">{event.name}</h2>
              <div className="flex items-center gap-4 text-sm text-[#938ea1]">
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">calendar_today</span>
                  {formatEventDate(event.dateUnix)}
                </div>
                <div className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">location_on</span>
                  {event.venue ?? 'TBA'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Ticket Selection Section */}
        <div className="bg-[#15181C] border border-[#272C33] rounded-xl p-8 mb-8">
          <div className="text-center mb-10">
            <h3 className="text-xs font-semibold text-[#938ea1] uppercase tracking-[0.2em] mb-2">Select Quantity</h3>
            <p className="text-sm text-[#938ea1]">General Admission - Tier 1</p>
          </div>
          <div className="flex items-center justify-center gap-12 mb-10">
            <div className="text-center w-24">
              <span className="text-[80px] font-bold leading-none">01</span>
            </div>
          </div>
          
          <div className="border-t border-[#272C33] pt-6 flex justify-between items-center">
            <div>
              <span className="text-xs font-semibold text-[#938ea1] block mb-1">Price per ticket</span>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold">{priceXlm.toFixed(2)} XLM</span>
                {usdPerXlm !== null && <span className="text-sm text-[#938ea1]">(~${(priceXlm * usdPerXlm).toFixed(2)})</span>}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-[#938ea1] block mb-1">Total Amount</span>
              <div className="flex items-center gap-2 justify-end">
                <span className="text-2xl font-bold text-[#7C5CFF]">{totalPrice.toFixed(2)} XLM</span>
                {totalUsd !== null && <span className="text-sm text-[#938ea1] font-normal">(~${totalUsd.toFixed(2)})</span>}
              </div>
            </div>
          </div>
        </div>

        {/* Payment Source Note */}
        <div className="bg-[#15181C]/80 backdrop-blur-md border border-[#272C33] rounded-lg p-4 flex items-start gap-4 mb-8">
          <span className="material-symbols-outlined text-[#7C5CFF]">info</span>
          <div className="flex-1">
            <p className="text-sm">Payment will be processed from your connected <strong>Stellar Wallet</strong>.</p>
            <p className="text-xs text-[#938ea1] mt-1">Please ensure you have enough XLM to cover transaction fees.</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-4">
          {wallet.isConnected ? (
            <Button 
              onClick={handlePurchase} 
              size="lg" 
              className="w-full py-4 text-lg"
            >
              Continue to Payment
            </Button>
          ) : (
            <Button 
              onClick={connectAttendee} 
              size="lg" 
              className="w-full py-4 text-lg"
            >
              Connect Wallet to continue
            </Button>
          )}
          <Button variant="secondary" onClick={onBack} size="lg" className="w-full py-4 text-lg">
            Cancel
          </Button>
        </div>
      </main>
    </div>
  );
}
