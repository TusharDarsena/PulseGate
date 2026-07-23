import { useEffect } from 'react';
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
import { useEvents } from './hooks/useEvents';
import { useListings } from './hooks/useListings';
import { useTickets } from './hooks/useTickets';
import { saveAuthIntent, type ProtectedAction } from './lib/authIntent';
import { AccountPage } from './pages/AccountPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { AuthPage } from './pages/AuthPage';
import { BrowsePage } from './pages/BrowsePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { MarketplacePage } from './pages/MarketplacePage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { PurchasePage } from './pages/PurchasePage';
import { QRDisplayPage } from './pages/QRDisplayPage';
import { ScannerPage } from './pages/ScannerPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { CreateEventPage } from './pages/organizer/CreateEventPage';
import { DashboardPage } from './pages/organizer/DashboardPage';
import { OrganizerEventPage } from './pages/organizer/OrganizerEventPage';
import { useAppStore } from './store/useAppStore';

function RequireAuth({
  children,
  action,
  attendeeWallet = false,
}: {
  children: React.ReactNode;
  action: ProtectedAction;
  attendeeWallet?: boolean;
}) {
  const { user, loading, provisionWallet } = useAuth();
  const wallet = useAppStore((state) => state.attendeeWallet);
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      saveAuthIntent(`${location.pathname}${location.search}`, action);
    }
  }, [action, loading, location.pathname, location.search, user]);

  if (loading) return <div className="min-h-screen flex items-center justify-center">Restoring account…</div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!attendeeWallet) return children;
  if (wallet.readiness === 'ready') return children;

  return (
    <main className="min-h-screen pt-28 px-4 flex justify-center">
      <section className="max-w-lg h-fit rounded-xl border border-[#272C33] bg-[#15181C] p-8">
        <h1 className="text-2xl font-bold mb-3">Ticket wallet required</h1>
        {wallet.readiness === 'recovery_required' ? (
          <p className="text-amber-300">
            Your recorded wallet could not be restored. Recovery is required; StellarTickets will
            not create a replacement wallet.
          </p>
        ) : (
          <>
            <p className="text-slate-400 mb-5">Prepare or restore your delegated Stellar Testnet wallet to continue.</p>
            <button onClick={() => void provisionWallet()} className="bg-[#7C5CFF] px-4 py-2 rounded-lg">
              Prepare wallet
            </button>
          </>
        )}
      </section>
    </main>
  );
}

function EventRoute() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  return <EventDetailPage eventId={eventId} onPurchase={() => navigate(`/events/${eventId}/checkout`)} />;
}

function CheckoutRoute({
  events,
  invalidateEvents,
  invalidateTickets,
}: {
  events: ReturnType<typeof useEvents>['events'];
  invalidateEvents: ReturnType<typeof useEvents>['invalidate'];
  invalidateTickets: ReturnType<typeof useTickets>['invalidate'];
}) {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  return (
    <PurchasePage
      eventId={eventId}
      events={events}
      onBack={() => navigate(`/events/${eventId}`)}
      onPurchaseComplete={() => navigate('/tickets')}
      invalidateEvents={invalidateEvents}
      invalidateTickets={invalidateTickets}
    />
  );
}

function TicketQrRoute() {
  const { ticketId = '' } = useParams();
  return <QRDisplayPage ticketId={ticketId} />;
}

function App() {
  const { txState } = useAppStore();
  const navigate = useNavigate();
  const eventsState = useEvents();
  const ticketsState = useTickets();
  const listingsState = useListings();

  return (
    <>
      <TxOverlay txState={txState} />
      <AppHeader />
      <Routes>
        <Route path="/" element={<Navigate to="/events" replace />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/events" element={
          <BrowsePage
            events={eventsState.events}
            loading={eventsState.loading}
            error={eventsState.error}
            onEventClick={(id) => navigate(`/events/${id}`)}
          />
        } />
        <Route path="/events/:eventId" element={<EventRoute />} />
        <Route path="/events/:eventId/checkout" element={
          <RequireAuth action="open_checkout" attendeeWallet>
            <CheckoutRoute
              events={eventsState.events}
              invalidateEvents={eventsState.invalidate}
              invalidateTickets={ticketsState.invalidate}
            />
          </RequireAuth>
        } />
        <Route path="/marketplace" element={
          <MarketplacePage
            listings={listingsState.listings}
            loading={listingsState.loading}
            error={listingsState.error}
            invalidateListings={listingsState.invalidate}
            invalidateTickets={ticketsState.invalidate}
          />
        } />
        <Route path="/tickets" element={
          <RequireAuth action="open_tickets">
            <MyTicketsPage
              tickets={ticketsState.tickets}
              events={eventsState.events}
              loadingTickets={ticketsState.loading}
              errorTickets={ticketsState.error}
              onShowQR={(id) => navigate(`/tickets/${id}/qr`)}
              onBrowseMore={() => navigate('/events')}
              invalidateTickets={ticketsState.invalidate}
              invalidateEvents={eventsState.invalidate}
            />
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
            <DashboardPage
              events={eventsState.events}
              onCreateEvent={() => navigate('/organizer/events/new')}
              onOpenEvent={(id) => navigate(`/organizer/events/${id}`)}
              invalidateEvents={eventsState.invalidate}
            />
          </RequireAuth>
        } />
        <Route path="/organizer/events/new" element={
          <RequireAuth action="open_organizer">
            <CreateEventPage onSubmit={(synced) => {
              if (synced) void eventsState.invalidate();
              navigate('/organizer/events');
            }} />
          </RequireAuth>
        } />
        <Route path="/organizer/events/:eventId" element={
          <RequireAuth action="open_organizer">
            <OrganizerEventPage events={eventsState.events} />
          </RequireAuth>
        } />
        <Route path="/organizer/events/:eventId/check-in" element={
          <RequireAuth action="open_organizer">
            <ScannerPage invalidateTickets={ticketsState.invalidate} />
          </RequireAuth>
        } />
        <Route path="*" element={
          <main className="min-h-screen pt-28 px-6 text-center">
            <h1 className="text-3xl font-bold">Page not found</h1>
          </main>
        } />
      </Routes>
      <BottomNav />
      <div className="fixed bottom-16 md:bottom-0 inset-x-0 z-40 text-center text-[11px] bg-[#0E1113]/95 text-amber-200 py-1">
        Stellar Testnet — balances and payments have no monetary value.
      </div>
    </>
  );
}

export default App;
