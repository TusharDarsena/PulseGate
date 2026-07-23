import React from 'react';
import { Ticket, Event, formatEventDate } from '../../types';

interface TicketCardProps {
  ticket: Ticket;
  event: Event;
  onShowQR: (ticketId: string) => void;
  onRefund?: (ticketId: string) => void;
  onListForSale?: (ticketId: string) => void;
  onCancelListing?: (ticketId: string) => void;
  hasOpenListing?: boolean;
}

export function TicketCard({ ticket, event, onShowQR, onRefund, onListForSale, onCancelListing, hasOpenListing }: TicketCardProps) {
  return (
    <div className="bg-[#15181C] border border-[#272C33] rounded-xl overflow-hidden relative group hover:border-[#7C5CFF]/50 transition-all duration-300">
      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#7C5CFF]"></div>
      <div className="p-6 flex flex-col h-full">
        <div className="flex justify-between items-start mb-6">
          <div>
            <span className="bg-[#7C5CFF]/10 text-[#7C5CFF] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mb-2 inline-block">
              {ticket.status === 'Used' ? 'USED' : ticket.status === 'Refunded' ? 'REFUNDED' : event.status === 'Cancelled' ? 'CANCELLED EVENT' : 'VIP ACCESS'}
            </span>
            <h3 className="text-2xl font-semibold leading-tight text-white">{event.name}</h3>
          </div>
          <div className="w-12 h-12 rounded-lg bg-[#272C33] overflow-hidden flex-shrink-0">
            <img src={event.imageUrl} alt={event.name} className="w-full h-full object-cover" />
          </div>
        </div>
        
        <div className="space-y-4 mb-8 flex-grow">
          <div className="flex items-center gap-2 text-[#c9c4d8]">
            <span className="material-symbols-outlined text-[18px]">calendar_today</span>
            <p className="text-sm">{formatEventDate(event.dateUnix)}</p>
          </div>
          <div className="flex items-center gap-2 text-[#c9c4d8]">
            <span className="material-symbols-outlined text-[18px]">location_on</span>
            <p className="text-sm">{event.venue}, {event.city}</p>
          </div>
        </div>
        
        <div className="bg-[#0E1113]/50 p-4 rounded-lg mb-6 border border-[#272C33]/50">
          <p className="text-[10px] uppercase text-[#c9c4d8] mb-1 font-bold">Ticket Identity Hash</p>
          <p className="font-mono text-[#7C5CFF] break-all truncate text-sm">
            {ticket.ticketId}
          </p>
        </div>
        
        <div className="flex flex-col gap-2">
          {hasOpenListing && onCancelListing ? (
            <button 
              onClick={() => onCancelListing(ticket.ticketId)}
              className="w-full py-3 bg-[#272C33] text-[#ffb4ab] font-semibold text-xs rounded-lg hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]">cancel</span>
              CANCEL LISTING
            </button>
          ) : event.status === 'Cancelled' && onRefund ? (
            <button 
              onClick={() => onRefund(ticket.ticketId)}
              className="w-full py-3 bg-[#ffb4ab] text-[#690005] font-semibold text-xs rounded-lg hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>money_off</span>
              CLAIM REFUND
            </button>
          ) : (
            <>
              <button 
                onClick={() => onShowQR(ticket.ticketId)}
                disabled={ticket.status !== 'Active'}
                className="w-full py-3 bg-[#7C5CFF] text-[#EAEFF4] font-semibold text-xs rounded-lg hover:brightness-110 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>qr_code_2</span>
                {ticket.status !== 'Active' ? 'TICKET USED' : 'SHOW QR'}
              </button>
              {ticket.status === 'Active' && onListForSale && event.status !== 'Cancelled' && (
                <button 
                  onClick={() => onListForSale(ticket.ticketId)}
                  className="w-full py-3 bg-transparent border border-[#7C5CFF]/30 text-[#7C5CFF] font-semibold text-xs rounded-lg hover:bg-[#7C5CFF]/10 active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[20px]">storefront</span>
                  LIST FOR SALE
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
