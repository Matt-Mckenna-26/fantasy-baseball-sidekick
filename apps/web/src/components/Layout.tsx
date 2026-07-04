import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/chat', label: 'Chat' },
  { to: '/rosters', label: 'Rosters' },
  { to: '/stats', label: 'Stats' },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Fantasy Baseball Co-Manager</span>
        <nav className="app-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        {/* Required attribution per Yahoo Fantasy Sports API terms; must link back to Yahoo Fantasy. */}
        <a
          className="app-footer__attribution"
          href="https://baseball.fantasysports.yahoo.com/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Fantasy data provided by Yahoo Fantasy
        </a>
      </footer>
    </div>
  );
}
