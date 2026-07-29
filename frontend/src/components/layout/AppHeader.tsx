import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `h-full flex items-center px-2 border-b-2 text-sm transition-colors ${
    isActive ? 'text-[#7C5CFF] border-[#7C5CFF]' : 'text-slate-400 border-transparent hover:text-white'
  }`;

export function AppHeader() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isDetail = /^\/(events\/[^/]+|tickets\/[^/]+|organizer\/(?:events|drafts)\/[^/]+)/.test(location.pathname);

  return (
    <header className="fixed top-0 w-full z-50 border-b border-[#272C33] bg-[#15181C]/95 backdrop-blur-md">
      <div className="flex justify-between items-center h-16 px-4 md:px-8 max-w-7xl mx-auto">
        <div className="flex items-center gap-6 h-full">
          {isDetail && (
            <button onClick={() => navigate(-1)} aria-label="Go back" className="p-2 text-white">
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
          )}
          <NavLink to="/events" className="text-xl font-bold text-white">PulseGate</NavLink>
          <nav className="hidden md:flex items-center gap-4 h-full">
            <NavLink to="/events" className={navClass}>Discover</NavLink>
            <NavLink to="/how-it-works" className={navClass}>How it works</NavLink>
            <NavLink to="/marketplace" className={navClass}>Marketplace</NavLink>
            <NavLink to="/tickets" className={navClass}>My Tickets</NavLink>
            <NavLink to="/account" className={navClass}>Account</NavLink>
          </nav>
        </div>
        <button
          onClick={() => navigate(user ? '/account' : '/auth')}
          className="bg-[#7C5CFF] text-white px-4 py-2 rounded-lg text-sm"
        >
          {user ? 'Account' : 'Sign in'}
        </button>
      </div>
    </header>
  );
}
