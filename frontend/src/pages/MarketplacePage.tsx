import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { prepareBuyListing } from '../lib/soroban';
import {
  prepareTicketOperation,
  submitPreparedTicketOperation,
  ticketOperationMessage,
  type PreparedTicketOperation,
} from '../lib/ticketOperations';
import { formatEventDate, stroopsToXlm } from '../types';
import type { ListingWithEvent } from '../hooks/useListings';
import { useTicketOperationRecovery } from '../hooks/useTicketOperationRecovery';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { saveAuthIntent } from '../lib/authIntent';
import { CollectionSkeleton } from '../components/ui/LoadingSkeleton';
import { TicketOperationRecovery } from '../components/tickets/TicketOperationRecovery';
import { formatStroops } from '../lib/stellar';
import { userFacingError } from '../lib/utils';

interface MarketplacePageProps {
  listings: ListingWithEvent[];
  loading: boolean;
  error: string | null;
  invalidateListings: () => Promise<void>;
}

export function MarketplacePage({ listings, loading, error, invalidateListings }: MarketplacePageProps) {
  const { attendeeWallet: wallet, setTxState } = useAppStore();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [review, setReview] = useState<{ listing: ListingWithEvent; prepared: PreparedTicketOperation } | null>(null);
  const ticketOperationRecovery = useTicketOperationRecovery();
  const selectedListingId = searchParams.get('listing');
  const selectedSeller = searchParams.get('seller');

  useEffect(() => {
    if (!selectedListingId || loading) return;
    const selected = listings.find((listing) =>
      listing.listingId === selectedListingId &&
      (!selectedSeller || listing.seller === selectedSeller));
    if (!selected) return;
    document.getElementById(`listing-${selected.seller}-${selected.listingId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [listings, loading, selectedListingId, selectedSeller]);

  const handleBuy = async (listing: ListingWithEvent) => {
    if (wallet.readiness !== 'ready' || !wallet.address || !wallet.signFn) {
      saveAuthIntent(
        `/marketplace?seller=${encodeURIComponent(listing.seller)}&listing=${encodeURIComponent(listing.listingId)}`,
        'buy_listing',
      );
      navigate(user ? '/account' : '/auth');
      return;
    }

    setBuyingId(`${listing.seller}:${listing.listingId}`);
    setTxState({ status: 'building' });

    try {
      const prepared = await prepareTicketOperation({
        allocation: {
          operationType: 'buy_listing',
          sellerAddress: listing.seller,
          listingId: listing.listingId,
          idempotencyKey: crypto.randomUUID(),
        },
        prepare: (current) => prepareBuyListing(
          current.seller_address!,
          current.listing_id!,
          current.actor_address,
        ),
        onChange: ticketOperationRecovery.remember,
      });
      setReview({ listing, prepared });
      setTxState({ status: 'idle' });
    } catch (e: unknown) {
      console.error('Buy listing failed:', e);
      const msg = userFacingError(e, 'Could not prepare this listing purchase.');
      setTxState({ status: 'error', errorMessage: msg });
      setTimeout(() => setTxState({ status: 'idle' }), 3000);
    } finally {
      setBuyingId(null);
    }
  };

  const confirmBuy = async () => {
    if (!review || !wallet.signFn) return;
    setBuyingId(`${review.listing.seller}:${review.listing.listingId}`);
    setTxState({ status: 'signing' });
    try {
      const operation = await submitPreparedTicketOperation(review.prepared, wallet.signFn, ticketOperationRecovery.remember);
      if (operation.state === 'chain_failed') throw new Error(operation.failure_detail || 'Stellar rejected the marketplace purchase.');
      if (operation.state === 'complete') await invalidateListings();
      setReview(null);
      setTxState({ status: 'success', message: ticketOperationMessage(operation, 'Ownership transferred on Stellar') });
      setTimeout(() => setTxState({ status: 'idle' }), operation.state === 'complete' ? 3000 : 7000);
    } catch (e) {
      console.error('Buy listing failed:', e);
      setTxState({ status: 'error', errorMessage: userFacingError(e, 'The marketplace purchase could not be completed.') });
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

      <TicketOperationRecovery
        operations={ticketOperationRecovery.operations}
        busyOperationId={ticketOperationRecovery.busyOperationId}
        error={ticketOperationRecovery.error}
        onRecover={(operation) => {
          void ticketOperationRecovery.recover(operation).then(async (recovered) => {
            ticketOperationRecovery.remember(recovered);
            if (recovered.state === 'complete') {
              await invalidateListings();
            }
          }).catch(() => undefined);
        }}
      />

      {review && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onKeyDown={(event) => { if (event.key === 'Escape') setReview(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="marketplace-review-title" onKeyDown={(event) => { if (event.key === 'Escape') setReview(null); }} className="w-full max-w-md rounded-xl border border-[#272C33] bg-[#15181C] p-6 shadow-2xl">
            <p className="text-sm font-semibold text-[#cabeff]">Review purchase</p>
            <h2 id="marketplace-review-title" className="mt-1 text-2xl font-bold">{review.listing.eventName}</h2>
            <p className="mt-1 text-sm text-[#c9c4d8]">{formatEventDate(review.listing.eventDateUnix)}</p>
            <dl className="mt-6 space-y-3 text-sm">
              <ReviewLine label="Ticket" value="1 × General Admission" />
              <ReviewLine label="Seller" value={`${review.listing.seller.slice(0, 6)}…${review.listing.seller.slice(-4)}`} />
              <ReviewLine label="Ask price" value={`${formatStroops(review.listing.askPriceStroops)} XLM`} />
              <ReviewLine label="Estimated network fee" value={`${formatStroops(review.prepared.transaction.estimatedFeeStroops)} XLM`} />
              <ReviewLine label="Estimated total debit" value={`${formatStroops(review.listing.askPriceStroops + review.prepared.transaction.estimatedFeeStroops)} XLM`} strong />
            </dl>
            <p className="mt-5 text-sm text-[#c9c4d8]">Ownership transfers on-chain only after your wallet approves this transaction.</p>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setReview(null)} className="flex-1 rounded-lg border border-[#36333e] px-4 py-3 text-sm">Cancel</button>
              <button type="button" autoFocus onClick={() => void confirmBuy()} className="flex-1 rounded-lg bg-[#7C5CFF] px-4 py-3 text-sm font-bold">Approve in wallet</button>
            </div>
          </section>
        </div>
      )}

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
        <CollectionSkeleton variant="listing" className="gap-8" />
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
            const isBeingBought = buyingId === `${listing.seller}:${listing.listingId}`;
            const isSelected = selectedListingId === listing.listingId &&
              (!selectedSeller || selectedSeller === listing.seller);

            return (
              <div
                key={`${listing.seller}:${listing.listingId}`}
                id={`listing-${listing.seller}-${listing.listingId}`}
                className={`group bg-[#15181C] border rounded-xl overflow-hidden transition-all duration-300 shadow-xl hover:shadow-[0_8px_30px_rgba(124,92,255,0.12)] flex flex-col ${
                  isSelected
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

                  <p className="mb-3 text-sm text-[#c9c4d8]">1 × General Admission</p>

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
                  <p className="mb-4 text-xs text-[#938ea1]">Eligibility rechecked before signing.</p>

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
                          if (isSelected) {
                            searchParams.delete('listing');
                            searchParams.delete('seller');
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

function ReviewLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-4"><dt className="text-[#938ea1]">{label}</dt><dd className={strong ? 'font-semibold text-white' : ''}>{value}</dd></div>;
}
