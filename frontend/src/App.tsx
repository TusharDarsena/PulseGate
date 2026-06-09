import { useState, useEffect } from 'react';
import { AppView } from './types';
import { LandingPage } from './pages/LandingPage';
import { AppHeader } from './components/layout/AppHeader';
import { BottomNav } from './components/layout/BottomNav';
import { BrowsePage } from './pages/BrowsePage';
import { EventDetailPage } from './pages/EventDetailPage';
import { PurchasePage } from './pages/PurchasePage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { QRDisplayPage } from './pages/QRDisplayPage';
import { ScannerPage } from './pages/ScannerPage';
import { DashboardPage } from './pages/organizer/DashboardPage';
import { CreateEventPage } from './pages/organizer/CreateEventPage';
import { TxOverlay } from './components/ui/TxOverlay';
import { useAppStore } from './store/useAppStore';
import { useWallet } from './hooks/useWallet';

import { useEvents } from './hooks/useEvents';
import { useTickets } from './hooks/useTickets';

import { useListings } from './hooks/useListings';
import { MarketplacePage } from './pages/MarketplacePage';

function App() {
  const [currentView, setCurrentView] = useState<AppView>('landing');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const { txState, wallet, _hasHydrated } = useAppStore();
  const { connectOrganizer, connectAttendee, disconnectWallet } = useWallet();

  const { events, loading: loadingEvents, error: errorEvents, invalidate: invalidateEvents } = useEvents();
  const { tickets, loading: loadingTickets, error: errorTickets, invalidate: invalidateTickets } = useTickets();
  const { listings, loading: loadingListings, error: errorListings, invalidate: invalidateListings } = useListings();

  // Auto-route connected users after a refresh
  useEffect(() => {
    if (_hasHydrated && currentView === 'landing' && wallet.isConnected) {
      setTimeout(() => {
        if (wallet.walletType === 'freighter') {
          setCurrentView('organizer-dashboard');
        } else {
          setCurrentView('browse');
        }
      }, 0);
    }
  }, [_hasHydrated, wallet.isConnected, wallet.walletType, currentView]);

  // Prevent rendering until Zustand restores the session
  if (!_hasHydrated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  const handleSelectRole = (view: AppView) => {
    setCurrentView(view);
  };

  const handleConnectWallet = async () => {
    if (currentView.startsWith('organizer') || currentView === 'scanner') {
      await connectOrganizer();
    } else {
      await connectAttendee();
    }
  };

  const handleDisconnect = () => {
    disconnectWallet();
    setCurrentView('landing');
  };

  const handleEventClick = (eventId: string) => {
    setSelectedEventId(eventId);
    setCurrentView('event-detail');
  };

  const handlePurchaseInit = (eventId: string) => {
    setSelectedEventId(eventId);
    setCurrentView('purchase');
  };

  const handlePurchaseComplete = (ticketId: string) => {
    console.log(`Purchased ticket ${ticketId}`);
    setCurrentView('my-tickets');
  };

  const handleShowQR = (ticketId: string) => {
    setSelectedTicketId(ticketId);
    setCurrentView('qr-display');
  };

  const renderView = () => {
    switch (currentView) {
      case 'landing':
        return <LandingPage onSelectRole={handleSelectRole} />;
      case 'browse':
        return <BrowsePage events={events} loading={loadingEvents} error={errorEvents} onEventClick={handleEventClick} />;
      case 'event-detail':
        return selectedEventId ? (
          <EventDetailPage
            eventId={selectedEventId}
            onPurchase={handlePurchaseInit}
          />
        ) : (
          <BrowsePage events={events} loading={loadingEvents} error={errorEvents} onEventClick={handleEventClick} />
        );
      case 'purchase':
        return selectedEventId ? (
          <PurchasePage
            eventId={selectedEventId}
            events={events}
            onBack={() => setCurrentView('event-detail')}
            onPurchaseComplete={handlePurchaseComplete}
            invalidateEvents={invalidateEvents}
            invalidateTickets={invalidateTickets}
          />
        ) : (
          <BrowsePage events={events} loading={loadingEvents} error={errorEvents} onEventClick={handleEventClick} />
        );
      case 'my-tickets':
        return (
          <MyTicketsPage
            tickets={tickets}
            events={events}
            loadingTickets={loadingTickets}
            errorTickets={errorTickets}
            onShowQR={handleShowQR}
            onBrowseMore={() => setCurrentView('browse')}
            invalidateTickets={invalidateTickets}
            invalidateEvents={invalidateEvents}
          />
        );
      case 'qr-display':
        return selectedTicketId ? (
          <QRDisplayPage
            ticketId={selectedTicketId}
          />
        ) : (
          <MyTicketsPage
            tickets={tickets}
            events={events}
            loadingTickets={loadingTickets}
            errorTickets={errorTickets}
            onShowQR={handleShowQR}
            onBrowseMore={() => setCurrentView('browse')}
            invalidateTickets={invalidateTickets}
            invalidateEvents={invalidateEvents}
          />
        );
      case 'scanner':
        return <ScannerPage invalidateTickets={invalidateTickets} />;
      case 'organizer-dashboard':
        return (
          <DashboardPage
            events={events}
            onCreateEvent={() => setCurrentView('organizer-create')}
            onScanTickets={() => setCurrentView('scanner')}
            invalidateEvents={invalidateEvents}
          />
        );
      case 'marketplace':
        return (
          <MarketplacePage
            listings={listings}
            loading={loadingListings}
            error={errorListings}
            invalidateListings={invalidateListings}
            invalidateTickets={invalidateTickets}
          />
        );
      case 'organizer-create':
        return (
          <CreateEventPage
            onSubmit={(readModelSynced) => {
              if (readModelSynced) invalidateEvents();
              setCurrentView('organizer-dashboard');
            }}
          />
        );
      default:
        return <div className="text-white p-6 pt-24 pb-20 max-w-7xl mx-auto">404 - Not Found</div>;
    }
  };

  return (
    <>
      <TxOverlay txState={txState} />

      <AppHeader
        currentView={currentView}
        wallet={wallet}
        onNavigate={setCurrentView}
        onConnectWallet={handleConnectWallet}
        onDisconnect={handleDisconnect}
      />

      {renderView()}

      <BottomNav
        currentView={currentView}
        onNavigate={setCurrentView}
      />
    </>
  );
}

export default App;
