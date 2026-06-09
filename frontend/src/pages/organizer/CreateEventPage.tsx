import React, { useState } from 'react';

interface CreateEventFormData {
  name: string;
  date: string;
  time: string;
  venue: string;
  city: string;
  capacity: string;
  priceXlm: string;
  imageUrl: string;
  description: string;
}

interface CreateEventPageProps {
  readonly onSubmit: (readModelSynced: boolean) => void;
}

const EMPTY_FORM: CreateEventFormData = {
  name: '',
  date: '',
  time: '',
  venue: '',
  city: '',
  capacity: '',
  priceXlm: '',
  imageUrl: '',
  description: '',
};

import { useAppStore } from '../../store/useAppStore';
import { createEvent } from '../../lib/soroban';
import { mirrorCreatedEvent, synchronizationWarning } from '../../lib/readModelSync';
import { xlmToStroops } from '../../types';

export function CreateEventPage({ onSubmit }: CreateEventPageProps) {
  const [form, setForm] = useState<CreateEventFormData>(EMPTY_FORM);

  const handleChange = (field: keyof CreateEventFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const { wallet, setTxState } = useAppStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.isConnected || !wallet.publicKey || !wallet.signFn) {
      alert('Please connect your organizer wallet (Freighter) first.');
      return;
    }

    setTxState({ status: 'building' });
    try {
      const dateTimeStr = `${form.date}T${form.time}:00`;
      const dateUnix = Math.floor(new Date(dateTimeStr).getTime() / 1000);

      const price = parseFloat(form.priceXlm);
      if (price > 900_000_000) {
        alert('Price exceeds maximum safe limit for MVP precision.');
        setTxState({ status: 'idle' });
        return;
      }

      const priceStroops = xlmToStroops(price);
      const capacity = parseInt(form.capacity, 10);

      // Use timestamp-based ID — links on-chain event to Supabase metadata
      const eventId = Date.now().toString();

      await createEvent(
        { eventId, name: form.name, dateUnix, capacityXlm: capacity, priceStroops },
        wallet.publicKey,
        wallet.signFn,
      );

      const syncResult = await mirrorCreatedEvent({
        eventId,
        organizerAddress: wallet.publicKey,
        name: form.name,
        description: form.description || null,
        imageUrl: form.imageUrl || null,
        venue: form.venue || null,
        city: form.city || null,
        category: null,
        dateUnix,
        capacity: capacity,
        pricePerTicket: Number(priceStroops),
      });

      setTxState({
        status: 'success',
        hash: eventId,
        message: syncResult.ok ? undefined : synchronizationWarning(syncResult),
      });
      setTimeout(() => {
        setTxState({ status: 'idle' });
        onSubmit(syncResult.ok);
      }, syncResult.ok ? 1500 : 6000);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create event';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    }
  };

  const inputClass =
    'w-full bg-[#15181C] border border-[#272C33] rounded-lg p-4 text-[#e6e0ee] placeholder-[#938ea1] focus:outline-none focus:border-[#7C5CFF] focus:ring-1 focus:ring-[#7C5CFF] transition-all';

  const labelClass = 'block text-xs font-semibold text-[#c9c4d8] uppercase tracking-widest mb-2';

  return (
    <div className="bg-[#14121b] text-[#e6e0ee] min-h-screen pt-16">

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          {/* ── Form ── */}
          <section className="lg:col-span-7 space-y-10">
            <div>
              <h2 className="text-3xl font-semibold text-[#e6e0ee] mb-2">Event Essentials</h2>
              <p className="text-base text-[#c9c4d8]">
                Provide the foundational details for your Stellar NFT-gated event.
              </p>
            </div>

            <form className="space-y-6" onSubmit={handleSubmit}>
              {/* Event Name */}
              <div>
                <label className={labelClass}>Event Name</label>
                <input
                  type="text"
                  className={inputClass}
                  placeholder="e.g. Stellar Interstellar Gala"
                  value={form.name}
                  onChange={handleChange('name')}
                  required
                />
              </div>

              {/* Date + Time */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Date</label>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.date}
                    onChange={handleChange('date')}
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>Time</label>
                  <input
                    type="time"
                    className={inputClass}
                    value={form.time}
                    onChange={handleChange('time')}
                    required
                  />
                </div>
              </div>

              {/* Venue + City */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Venue</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="Venue Name"
                    value={form.venue}
                    onChange={handleChange('venue')}
                  />
                </div>
                <div>
                  <label className={labelClass}>City</label>
                  <input
                    type="text"
                    className={inputClass}
                    placeholder="City, Country"
                    value={form.city}
                    onChange={handleChange('city')}
                  />
                </div>
              </div>

              {/* Capacity + Price */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className={labelClass}>Capacity</label>
                  <div className="relative">
                    <input
                      type="number"
                      className={`${inputClass} pl-12`}
                      placeholder="0"
                      min="1"
                      value={form.capacity}
                      onChange={handleChange('capacity')}
                      required
                    />
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#938ea1]">
                      group
                    </span>
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Price (XLM)</label>
                  <div className="relative">
                    <input
                      type="number"
                      className={`${inputClass} pl-12`}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      value={form.priceXlm}
                      onChange={handleChange('priceXlm')}
                      required
                    />
                    <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-[#938ea1]">
                      payments
                    </span>
                  </div>
                </div>
              </div>

              {/* Image URL */}
              <div>
                <label className={labelClass}>Event Poster URL</label>
                <input
                  type="url"
                  className={inputClass}
                  placeholder="https://..."
                  value={form.imageUrl}
                  onChange={handleChange('imageUrl')}
                />
              </div>

              {/* Description */}
              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  className={inputClass}
                  placeholder="Describe your event's unique experience..."
                  rows={4}
                  value={form.description}
                  onChange={handleChange('description')}
                />
              </div>

              {/* Disclaimer */}
              <div className="bg-[#272C33]/20 border border-[#7C5CFF]/30 p-3 rounded-lg flex items-start gap-3 mt-4">
                <span className="material-symbols-outlined text-[#7C5CFF] text-sm mt-0.5">info</span>
                <p className="text-xs text-[#c9c4d8] leading-relaxed">
                  Core details (capacity, price, date) are stored permanently on the Stellar blockchain.
                  Rich metadata (name, venue, image, description) is stored in our database and linked by event ID.
                </p>
              </div>

              <button
                type="submit"
                className="w-full bg-[#7C5CFF] hover:bg-[#8d72ff] text-[#EAEFF4] font-semibold text-xl py-4 rounded-xl transition-all shadow-[0_0_20px_rgba(124,92,255,0.3)] active:scale-[0.98]"
              >
                Create Event on Stellar
              </button>
            </form>
          </section>

          {/* ── Live Preview ── */}
          <aside className="lg:col-span-5">
            <div className="sticky top-28 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-[#7C5CFF] uppercase tracking-widest">
                  Live Preview
                </h3>
                <span className="flex items-center gap-2 text-xs text-[#c9c4d8]">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  Real-time rendering
                </span>
              </div>

              {/* NFT Ticket Preview Card */}
              <div className="bg-[#15181C] border border-[#272C33] rounded-xl overflow-hidden shadow-2xl group">
                <div className="aspect-[4/5] relative overflow-hidden">
                  <img
                    src={
                      form.imageUrl ||
                      'https://images.unsplash.com/photo-1540039155732-d67414006c3a?w=600&q=80'
                    }
                    alt="Event Preview"
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        'https://images.unsplash.com/photo-1540039155732-d67414006c3a?w=600&q=80';
                    }}
                  />
                  <div className="absolute top-4 right-4 bg-[#7C5CFF]/90 backdrop-blur-md px-3 py-1 rounded-full border border-white/20">
                    <p className="font-mono text-sm text-white">
                      XLM {form.priceXlm || '0.00'}
                    </p>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  <div className="space-y-2">
                    <span className="bg-[#7C5CFF]/10 text-[#7C5CFF] px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tighter">
                      Verified Creator
                    </span>
                    <h4 className="text-2xl font-semibold text-[#e6e0ee] truncate">
                      {form.name || 'Stellar Interstellar Gala'}
                    </h4>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#7C5CFF] text-sm">
                        calendar_today
                      </span>
                      <span className="text-[#c9c4d8] text-sm">
                        {form.date || 'Oct 24, 2024'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#7C5CFF] text-sm">
                        schedule
                      </span>
                      <span className="text-[#c9c4d8] text-sm">
                        {form.time || '20:00 PM'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <span className="material-symbols-outlined text-[#7C5CFF] text-sm">
                        location_on
                      </span>
                      <span className="text-[#c9c4d8] text-sm truncate">
                        {[form.venue, form.city].filter(Boolean).join(', ') || 'Nebula Lounge, San Francisco'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-[#272C33] flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-[#c9c4d8] uppercase tracking-widest font-medium">
                        Network
                      </span>
                      <span className="font-mono text-sm text-[#e6e0ee]">Stellar Testnet</span>
                    </div>
                    <div className="w-12 h-12 bg-white rounded-lg p-1 flex items-center justify-center">
                      <span className="material-symbols-outlined text-black">qr_code_2</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Info tip */}
              <div className="bg-[#272C33]/30 border border-[#272C33] p-4 rounded-lg flex gap-3">
                <span className="material-symbols-outlined text-[#7C5CFF] flex-shrink-0">info</span>
                <p className="text-xs text-[#c9c4d8] leading-relaxed">
                  Once created, your tickets will be minted as NFTs on the Stellar network. Ensure
                  your capacity and price are final before deployment.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
