import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Brand } from '@/components/Brand';

/** The customer side (/my): a simple top bar, no staff sidebar; works on a phone. */
export function CustomerLayout() {
  const { me, signOut, config } = useSession();
  return (
    <div className="as-cust">
      <header className="as-cust-bar">
        <div className="container">
          <Brand to="/my" height={34} />
          <nav className="as-cust-nav" aria-label="Main">
            <NavLink to="/my" end>My vehicles</NavLink>
            <NavLink to="/my/account">My account</NavLink>
          </nav>
          <span className="small d-none d-sm-inline" style={{ color: 'var(--as-sidebar-text)' }}>{me.displayName}</span>
          <button type="button" className="btn btn-sm btn-outline-light d-none d-sm-inline-block" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <footer className="text-center small text-body-secondary pb-4">
        AutoSense · v{config.version}
        {config.environment !== 'production' && ' · sample data'}
      </footer>
    </div>
  );
}
