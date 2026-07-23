import { NavLink, useLocation } from 'react-router-dom';

const items = [
  ['/events', 'explore', 'Discover'],
  ['/marketplace', 'storefront', 'Market'],
  ['/tickets', 'confirmation_number', 'Tickets'],
  ['/account', 'person', 'Account'],
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  if (/^\/(auth|events\/[^/]+|tickets\/[^/]+|organizer)/.test(pathname)) return null;
  return (
    <nav className="md:hidden fixed bottom-0 w-full z-50 border-t border-[#272C33] bg-[#15181C]">
      <div className="flex justify-around items-center h-16">
        {items.map(([to, icon, label]) => (
          <NavLink key={to} to={to} className={({ isActive }) =>
            `flex flex-col items-center justify-center w-20 text-xs ${isActive ? 'text-[#7C5CFF]' : 'text-slate-400'}`
          }>
            <span className="material-symbols-outlined">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
