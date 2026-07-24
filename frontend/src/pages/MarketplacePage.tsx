import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { buyListing, getTicket } from '../lib/soroban';
import { mirrorListingSale, synchronizationWarning } from '../lib/readModelSync';
import { formatEventDate, stroopsToXlm } from '../types';
import type { ListingWithEvent } from '../hooks/useListings';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { saveAuthIntent } from '../lib/authIntent';

interface MarketplacePageProps {
  listings: ListingWithEvent[];
  loading: boolean;
  error: string | null;
  invalidateListings: () => Promise<void>;
  invalidateTickets: () => void;
}

function SkeletonCard() {
  return (
    <div className="bg-[#15181C] border border-[#272C33] rounded-xl overflow-hidden animate-pulse">
      <div className="h-44 bg-[#272C33]" />
      <div className="p-5 space-y-3">
        <div className="h-5 bg-[#272C33] rounded w-3/4" />
        <div className="h-4 bg-[#272C33] rounded w-1/2" />
        <div className="h-px bg-[#272C33] my-2" />
        <div className="flex justify-between items-center">
          <div className="h-6 bg-[#272C33] rounded w-24" />
          <div className="h-9 bg-[#272C33] rounded-lg w-28" />
        </div>
      </div>
    </div>
  );
}

export function MarketplacePage({ listings, loading, error, invalidateListings, invalidateTickets }: MarketplacePageProps) {
  const { attendeeWallet: wallet, setTxState } = useAppStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const selectedListingId = searchParams.get('listing');

  useEffect(() => {
    if (!selectedListingId || loading) return;
    document.getElementById(`listing-${selectedListingId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [loading, selectedListingId]);

  const handleBuy = async (listing: ListingWithEvent) => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signFn) {
      saveAuthIntent(`/marketplace?listing=${encodeURIComponent(listing.listingId)}`, 'buy_listing');
      navigate(user ? '/account' : '/auth');
      return;
    }

    setBuyingId(listing.listingId);
    setTxState({ status: 'building' });

    try {
      const ticket = await getTicket(listing.ticketId);
      if (!ticket || ticket.owner !== listing.seller || ticket.status !== 'Active') {
        throw new Error('Ticket ownership changed or ticket is no longer active.');
      }

      await buyListing(listing.seller, listing.listingId, wallet.address, wallet.signFn);

      const syncResult = await mirrorListingSale({
        listingId: listing.listingId,
        ticketId: listing.ticketId,
        buyerAddress: wallet.address,
      });

      if (syncResult.ok) {
        await invalidateListings();
        invalidateTickets();
      }

      setTxState({
        status: 'success',
        message: syncResult.ok ? 'Ticket purchased successfully!' : synchronizationWarning(syncResult),
      });
      setTimeout(() => setTxState({ status: 'idle' }), syncResult.ok ? 3000 : 6000);
    } catch (e: unknown) {
      console.error('Buy listing failed:', e);
      const msg = e instanceof Error ? e.message : 'Purchase failed.';
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    } finally {
      setBuyingId(null);
    }
  };

  const priceXlm = (stroops: bigint) =>
    parseFloat(stroopsToXlm(Number(stroops))).toFixed(2);

  return (
    <main className="pt-24 pb-28 max-w-7xl mx-auto px-4 md:px-8 min-h-screen">

      {/* ── Hero ── */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-[#947dff]/15 border border-[#947dff]/20">
            <span className="material-symbols-outlined text-[#cabeff] text-xl">storefront</span>
          </div>
          <span className="text-xs font-bold text-[#cabeff] uppercase tracking-widest">Secondary Market</span>
        </div>
        <h1 className="text-[32px] leading-[1.2] tracking-[-0.01em] font-semibold text-[#e6e0ee] mb-2">
          Ticket Marketplace
        </h1>
        <p className="text-[#c9c4d8] text-base leading-relaxed max-w-2xl">
          Buy and sell eligible tickets through the verified Stellar resale contract.
        </p>
      </div>

      {/* ── Stats bar ── */}
      {!loading && !error && listings.length > 0 && (
        <div className="flex items-center gap-6 mb-8 pb-8 border-b border-[#272C33]">
          <div>
            <p className="text-[10px] text-[#938ea1] uppercase tracking-widest font-bold mb-1">Active Listings</p>
            <p className="text-2xl font-semibold text-[#e6e0ee]">{listings.length}</p>
          </div>
          <div className="w-px h-10 bg-[#272C33]" />
          <div>
            <p className="text-[10px] text-[#938ea1] uppercase tracking-widest font-bold mb-1">Royalties Enforced</p>
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-emerald-400 text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
              <p className="text-sm font-semibold text-emerald-400">On-chain</p>
            </div>
          </div>
          <div className="w-px h-10 bg-[#272C33]" />
          <div>
            <p className="text-[10px] text-[#938ea1] uppercase tracking-widest font-bold mb-1">Settlement</p>
            <p className="text-sm font-semibold text-[#e6e0ee]">Instant · XLM</p>
          </div>
        </div>
      )}

      {/* ── States ── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
            <span className="material-symbols-outlined text-red-400 text-3xl">wifi_off</span>
          </div>
          <p className="text-red-400 font-semibold">Service Unavailable</p>
          <p className="text-sm text-[#938ea1] text-center max-w-xs">{error}</p>
        </div>
      ) : listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-5">
          <div className="w-20 h-20 rounded-full bg-[#272C33] flex items-center justify-center border border-[#36333e]">
            <span className="material-symbols-outlined text-[#938ea1] text-4xl">storefront</span>
          </div>
          <div className="text-center">
            <p className="text-[#e6e0ee] font-semibold text-lg mb-1">No listings yet</p>
            <p className="text-sm text-[#938ea1] max-w-xs">
              When attendees list their tickets for resale, they'll appear here. Check back soon.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {listings.map(listing => {
            const isOwnListing = wallet.readiness === 'ready' && wallet.address === listing.seller;
            const isBeingBought = buyingId === listing.listingId;

            return (
              <div
                key={listing.listingId}
                id={`listing-${listing.listingId}`}
                className={`group bg-[#15181C] border rounded-xl overflow-hidden transition-all duration-300 shadow-xl hover:shadow-[0_8px_30px_rgba(124,92,255,0.12)] flex flex-col ${
                  selectedListingId === listing.listingId
                    ? 'border-[#7C5CFF] ring-2 ring-[#7C5CFF]/30'
                    : 'border-[#272C33] hover:border-[#7C5CFF]/50'
                }`}
              >
                {/* Image with gradient fade */}
                <div className="h-44 overflow-hidden relative flex-shrink-0">
                  <img
                    src={listing.eventImageUrl}
                    alt={listing.eventName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#15181C] via-[#15181C]/30 to-transparent" />

                  {/* Resale badge */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-[#947dff]/90 backdrop-blur-sm text-[#2a0088] px-2.5 py-1 rounded text-[10px] font-bold tracking-wider uppercase">
                    <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>sell</span>
                    Resale
                  </div>

                  {isOwnListing && (
                    <div className="absolute top-3 right-3 bg-[#272C33]/90 backdrop-blur-sm text-[#c9c4d8] px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">
                      Your Listing
                    </div>
                  )}
                </div>

                {/* Card body */}
                <div className="p-5 flex flex-col flex-grow -mt-8 relative z-10">
                  <h3 className="text-xl font-semibold text-[#e6e0ee] mb-1 group-hover:text-[#cabeff] transition-colors leading-tight truncate">
                    {listing.eventName}
                  </h3>

                  <div className="flex items-center gap-2 text-[#c9c4d8] mb-4">
                    <span className="material-symbols-outlined text-[15px]">calendar_today</span>
                    <span className="text-sm">{formatEventDate(listing.eventDateUnix)}</span>
                  </div>

                  {/* Seller row */}
                  <div className="flex items-center justify-between mb-4 bg-[#0f0d16]/60 px-3 py-2.5 rounded-lg border border-[#272C33]/60">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[#938ea1] text-[15px]">person</span>
                      <span className="text-[10px] text-[#938ea1] uppercase font-bold tracking-wider">Seller</span>
                    </div>
                    <span className="font-mono text-xs text-[#cabeff]">
                      {listing.seller.substring(0, 6)}...{listing.seller.substring(listing.seller.length - 4)}
                    </span>
                  </div>

                  {/* Price + CTA */}
                  <div className="flex items-center justify-between mt-auto pt-3 border-t border-[#272C33]/50">
                    <div>
                      <span className="text-[10px] text-[#938ea1] uppercase font-bold tracking-widest block mb-0.5">Ask Price</span>
                      <span className="text-[22px] leading-none font-semibold text-[#cabeff]">
                        {priceXlm(listing.askPriceStroops)}
                        <span className="text-sm font-normal text-[#938ea1] ml-1">XLM</span>
                      </span>
                    </div>

                    {isOwnListing ? (
                      <button
                        disabled
                        className="px-4 py-2.5 bg-[#272C33] text-[#EAEFF4]/40 font-bold text-xs rounded-lg cursor-not-allowed border border-[#36333e]"
                      >
                        Your Listing
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (selectedListingId === listing.listingId) {
                            searchParams.delete('listing');
                            setSearchParams(searchParams, { replace: true });
                          }
                          void handleBuy(listing);
                        }}
                        disabled={isBeingBought}
                        className="px-5 py-2.5 bg-[#7C5CFF] text-[#EAEFF4] font-bold text-xs rounded-lg hover:brightness-110 active:scale-95 transition-all shadow-lg shadow-[#7C5CFF]/20 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {isBeingBought ? (
                          <>
                            <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Buying...
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-[15px]" style={{ fontVariationSettings: "'FILL' 1" }}>shopping_cart</span>
                            Buy Now
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
