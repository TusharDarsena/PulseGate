import { useEffect, useState } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { AppHeader } from './components/layout/AppHeader';
import { BottomNav } from './components/layout/BottomNav';
import { TxOverlay } from './components/ui/TxOverlay';
import { useListings } from './hooks/useListings';
import { useTickets } from './hooks/useTickets';
import { useWallet } from './hooks/useWallet';
import { saveAuthIntent, type ProtectedAction } from './lib/authIntent';
import { AccountPage } from './pages/AccountPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { AuthPage } from './pages/AuthPage';
import { BrowsePage } from './pages/BrowsePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { HowItWorksPage } from './pages/HowItWorksPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { PurchasePage } from './pages/PurchasePage';
import { PurchaseReceiptPage } from './pages/PurchaseReceiptPage';
import { QRDisplayPage } from './pages/QRDisplayPage';
import { ScannerPage } from './pages/ScannerPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { CreateEventPage } from './pages/organizer/CreateEventPage';
import { DashboardPage } from './pages/organizer/DashboardPage';
import { EventDraftPage } from './pages/organizer/EventDraftPage';
import { OrganizerEventPage } from './pages/organizer/OrganizerEventPage';
import { useAppStore } from './store/useAppStore';

export function RequireAuth({
  children,
  action,
  attendeeWallet = false,
}: {
  children: React.ReactNode;
  action: ProtectedAction;
  attendeeWallet?: boolean;
}) {
  const { user, loading, walletRestoring, provisionWallet } = useAuth();
  const wallet = useAppStore((state) => state.attendeeWallet);
  const location = useLocation();
  const navigate = useNavigate();
  const [provisioningError, setProvisioningError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      saveAuthIntent(`${location.pathname}${location.search}`, action);
    }
  }, [action, loading, location.pathname, location.search, user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Restoring account…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!attendeeWallet) return children;
  if (walletRestoring) {
    return <div className="min-h-screen flex items-center justify-center">Restoring ticket wallet...</div>;
  }
  if (wallet.readiness === 'ready') return children;

  return (
    <main className="min-h-screen pt-28 px-4 flex justify-center">
      <section className="max-w-lg h-fit rounded-xl border border-[#272C33] bg-[#15181C] p-8">
        <h1 className="text-2xl font-bold mb-3">Ticket wallet required</h1>
        {wallet.readiness === 'recovery_required' && wallet.address ? (
          <>
            <p className="text-amber-300">
              Your recorded wallet could not be restored. Recovery is required; PulseGate will
              not create a replacement wallet.
            </p>
            <button onClick={() => navigate('/account')} className="mt-5 bg-amber-500 px-4 py-2 rounded-lg text-black">
              Recover wallet
            </button>
          </>
        ) : wallet.readiness === 'recovery_required' ? (
          <>
            <p className="text-slate-400 mb-5">
              Wallet setup was interrupted before an address was recorded. Retry setup to safely
              reconcile the unfinished Dfns registration.
            </p>
            <button
              onClick={() => {
                setProvisioningError(null);
                void provisionWallet().catch((error) => {
                  setProvisioningError(
                    error instanceof Error ? error.message : 'Wallet setup could not be completed.',
                  );
                });
              }}
              className="bg-[#7C5CFF] px-4 py-2 rounded-lg"
            >
              Retry wallet setup
            </button>
            {provisioningError && <p role="alert" className="mt-3 text-amber-300">{provisioningError}</p>}
          </>
        ) : wallet.readiness === 'not_provisioned' ? (
          <>
            <p className="text-slate-400 mb-5">Prepare or restore your delegated Stellar Testnet wallet to continue.</p>
            <button onClick={() => void provisionWallet()} className="bg-[#7C5CFF] px-4 py-2 rounded-lg">
              Prepare wallet
            </button>
          </>
        ) : wallet.readiness === 'provisioning' ? (
          <>
            <p className="text-slate-400 mb-5">
              Preparing your ticket wallet. If the passkey prompt was cancelled or did not open, retry setup.
            </p>
            <button
              onClick={() => {
                setProvisioningError(null);
                void provisionWallet().catch((error) => {
                  setProvisioningError(
                    error instanceof Error ? error.message : 'Wallet setup could not be completed.',
                  );
                });
              }}
              className="bg-[#7C5CFF] px-4 py-2 rounded-lg"
            >
              Retry wallet setup
            </button>
            {provisioningError && <p role="alert" className="mt-3 text-amber-300">{provisioningError}</p>}
          </>
        ) : (
          <p className="text-amber-300">
            {wallet.errorMessage ?? 'Ticket wallet readiness could not be confirmed. Refresh to retry.'}
          </p>
        )}
      </section>
    </main>
  );
}

function RequireOrganizerWallet({ children }: { children: React.ReactNode }) {
  const organizerWallet = useAppStore((state) => state.organizerWallet);
  if (!organizerWallet.isConnected) {
    return <Navigate to="/account" replace />;
  }
  return <>{children}</>;
}

function EventRoute() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  return <EventDetailPage eventId={eventId} onPurchase={() => navigate(`/events/${eventId}/checkout`)} />;
}

function CheckoutRoute() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  return (
    <PurchasePage
      eventId={eventId}
      onBack={() => navigate(`/events/${eventId}`)}
      onOpenReceipt={(operationId) => navigate(`/purchases/${operationId}`)}
    />
  );
}

function TicketQrRoute() {
  const { ticketId = '' } = useParams();
  return <QRDisplayPage ticketId={ticketId} />;
}

function MarketplaceRoute() {
  const listingsState = useListings();
  return (
    <MarketplacePage
      listings={listingsState.listings}
      loading={listingsState.loading}
      error={listingsState.error}
      invalidateListings={listingsState.invalidate}
    />
  );
}

function MyTicketsRoute() {
  const ticketsState = useTickets();
  const navigate = useNavigate();
  return (
    <MyTicketsPage
      tickets={ticketsState.tickets}
      loadingTickets={ticketsState.loading}
      errorTickets={ticketsState.error}
      onViewTicket={(id) => navigate(`/tickets/${id}`)}
      onViewReceipt={(id) => navigate(`/purchases/${id}`)}
      onShowQR={(id) => navigate(`/tickets/${id}/qr`)}
      onBrowseMore={() => navigate('/events')}
      invalidateTickets={ticketsState.invalidate}
      pendingSync={ticketsState.pendingSync}
      retryPending={ticketsState.retryPending}
    />
  );
}

function App() {
  useWallet();
  const { txState } = useAppStore();
  const navigate = useNavigate();

  return (
    <>
      <TxOverlay txState={txState} />
      <AppHeader />
      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/events" element={
          <BrowsePage onEventClick={(id) => navigate(`/events/${id}`)} />
        } />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/events/:eventId" element={<EventRoute />} />
        <Route path="/events/:eventId/checkout" element={
          <RequireAuth action="open_checkout" attendeeWallet>
            <CheckoutRoute />
          </RequireAuth>
        } />
        <Route path="/purchases/:operationId" element={
          <RequireAuth action="open_purchase">
            <PurchaseReceiptPage />
          </RequireAuth>
        } />
        <Route path="/marketplace" element={
          <MarketplaceRoute />
        } />
        <Route path="/tickets" element={
          <RequireAuth action="open_tickets">
            <MyTicketsRoute />
          </RequireAuth>
        } />
        <Route path="/tickets/:ticketId" element={
          <RequireAuth action="open_ticket"><TicketDetailPage /></RequireAuth>
        } />
        <Route path="/tickets/:ticketId/qr" element={
          <RequireAuth action="open_ticket" attendeeWallet><TicketQrRoute /></RequireAuth>
        } />
        <Route path="/account" element={
          <RequireAuth action="open_account"><AccountPage /></RequireAuth>
        } />
        <Route path="/organizer/events" element={
          <RequireAuth action="open_organizer">
            <RequireOrganizerWallet>
              <DashboardPage
                onCreateEvent={() => navigate('/organizer/events/new')}
                onOpenDraft={(id) => navigate(`/organizer/drafts/${id}`)}
                onOpenEvent={(id) => navigate(`/organizer/events/${id}`)}
              />
            </RequireOrganizerWallet>
          </RequireAuth>
        } />
        <Route path="/organizer/events/new" element={
          <RequireAuth action="open_organizer">
            <RequireOrganizerWallet>
              <CreateEventPage />
            </RequireOrganizerWallet>
          </RequireAuth>
        } />
        <Route path="/organizer/drafts/:draftId" element={
          <RequireAuth action="open_organizer">
            <RequireOrganizerWallet>
              <EventDraftPage />
            </RequireOrganizerWallet>
          </RequireAuth>
        } />
        <Route path="/organizer/events/:eventId" element={
          <RequireAuth action="open_organizer">
            <RequireOrganizerWallet>
              <OrganizerEventPage />
            </RequireOrganizerWallet>
          </RequireAuth>
        } />
        <Route path="/organizer/events/:eventId/check-in" element={
          <RequireAuth action="open_organizer">
            <RequireOrganizerWallet>
              <ScannerPage />
            </RequireOrganizerWallet>
          </RequireAuth>
        } />
        <Route path="*" element={
          <main className="min-h-screen pt-28 px-6 text-center">
            <h1 className="text-3xl font-bold">Page not found</h1>
            <p className="mt-3 text-slate-400">The page may have moved or the address may be incorrect.</p>
            <div className="mt-6 flex justify-center gap-3"><button type="button" onClick={() => navigate(-1)} className="rounded-lg border border-[#36333e] px-4 py-2">Go back</button><button type="button" onClick={() => navigate('/events')} className="rounded-lg bg-[#7C5CFF] px-4 py-2">Browse events</button></div>
          </main>
        } />
      </Routes>
      <BottomNav />

    </>
  );
}

export default App;
