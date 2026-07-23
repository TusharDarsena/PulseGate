import React from 'react';
import { Event, stroopsToXlm, formatEventDate } from '../../types';
import { Card, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface EventCardProps {
  event: Event;
  onClick: (eventId: string) => void;
  onAction?: (eventId: string) => void;
  actionLabel?: string;
  actionVariant?: 'primary' | 'secondary';
}

export function EventCard({ event, onClick, onAction, actionLabel = 'Get Tickets', actionVariant = 'primary' }: EventCardProps) {
  const handleAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onAction) onAction(event.eventId);
    else onClick(event.eventId);
  };

  return (
    <Card 
      onClick={() => onClick(event.eventId)}
      className="group cursor-pointer hover:border-[#7C5CFF]/50 transition-all duration-300 shadow-xl hover:shadow-[0_0_20px_rgba(124,92,255,0.1)]"
    >
      <div className="relative aspect-video overflow-hidden">
        <img 
          src={event.imageUrl || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80'} 
          alt={event.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        <div className="absolute top-3 left-3">
          <Badge variant={event.status === 'Active' ? 'default' : 'outline'}>
            {event.status}
          </Badge>
        </div>
        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md text-white px-2 py-1 rounded text-[10px] font-bold">
          {Math.max(0, event.capacity - event.currentSupply)} LEFT
        </div>
      </div>
      
      <CardContent className="p-5">
        <h3 className="text-xl font-bold text-white mb-3 group-hover:text-[#7C5CFF] transition-colors truncate">
          {event.name}
        </h3>
        
        <div className="space-y-2 mb-5">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="material-symbols-outlined text-[18px]">location_on</span>
            <span className="text-sm truncate">{event.venue || 'TBA'} {event.city ? `, ${event.city}` : ''}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="material-symbols-outlined text-[18px]">calendar_today</span>
            <span className="text-sm">{formatEventDate(event.dateUnix)}</span>
          </div>
        </div>
        
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Price</span>
            <span className="text-xl font-bold text-[#7C5CFF]">{stroopsToXlm(event.pricePerTicket)} XLM</span>
          </div>
          <Button 
            variant={actionVariant}
            onClick={handleAction}
          >
            {actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
