import { useCallback, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

const DESKTOP = 992; // AdminLTE's lg breakpoint (body has sidebar-expand-lg)

/**
 * The frame around every screen. The sidebar is shown and hidden with AdminLTE's body classes, set by React
 * instead of AdminLTE's script: sidebar-collapse on desktop, sidebar-open on phones and tablets.
 */
export function AppLayout() {
  const { config } = useSession();
  const { pathname } = useLocation();

  const toggleSidebar = useCallback(() => {
    const body = document.body.classList;
    if (window.innerWidth >= DESKTOP) body.toggle('sidebar-collapse');
    else body.toggle('sidebar-open');
  }, []);

  // On a small screen the sidebar slides over the page; close it after choosing a screen.
  useEffect(() => {
    document.body.classList.remove('sidebar-open');
  }, [pathname]);

  return (
    <div className="app-wrapper">
      <TopBar onToggleSidebar={toggleSidebar} />
      <Sidebar />
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer small text-body-secondary">
        <span>AutoSense · v{config.version}</span>
      </footer>
      <div className="sidebar-overlay" onClick={() => document.body.classList.remove('sidebar-open')} aria-hidden="true" />
    </div>
  );
}
