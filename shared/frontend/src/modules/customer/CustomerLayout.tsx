import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Brand } from '@/components/Brand';
import { Dropdown } from '@/components/ui/Dropdown';
import { apiSend } from '@/lib/api';
import { initials } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { BUSINESS, telUrl } from '@/site/business';
import type { MyNotifications, Notice } from './customer.types';
import { timeAgo, type PortalContext } from './portal';
import './customer.css';
import './portal.css';

const NAV = [
  { to: '/my', label: 'Home', icon: 'bi-house', end: true },
  { to: '/my/vehicles', label: 'Vehicles', icon: 'bi-car-front' },
  { to: '/my/bookings', label: 'Bookings', icon: 'bi-calendar-check' },
  { to: '/my/history', label: 'History', icon: 'bi-journal-text' },
];

/**
 * The customer portal (/my): a fixed dark header with the main links, "Book a service", notifications and the account
 * menu; on phones the links move to a tab bar at the bottom with "Book" in the middle.
 */
export function CustomerLayout() {
  const { me, signOut, config } = useSession();
  const { pathname } = useLocation();
  const notifications = useApi<MyNotifications>('/my/notifications', undefined, { refreshMs: 60_000 });
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // A new page starts at the top (braces: an effect may only return a cleanup function)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const reload = notifications.reload;
  const markSeen = useCallback(() => {
    void apiSend('POST', '/my/notifications/seen').then(reload, () => undefined);
  }, [reload]);
  const context: PortalContext = { notifications, markSeen };
  const [first] = me.displayName.split(' ');

  return (
    <div className="as-cust pt">
      <header className={`pt-header${scrolled ? ' scrolled' : ''}`}>
        <div className="pt-wrap pt-header-row">
          <Brand to="/my" height={32} />
          <nav className="pt-nav" aria-label="Portal">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                <i className={`bi ${n.icon}`} aria-hidden="true" />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="pt-tools">
            <Link to="/my/bookings/new" className="btn btn-primary btn-sm pt-book">
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />Book a service
            </Link>
            <NotificationBell feed={notifications.data} onOpen={markSeen} />
            <Dropdown
              label="Account menu"
              buttonClassName="pt-avatar-btn"
              menuClassName="pt-menu"
              trigger={<span className="pt-avatar" aria-hidden="true">{initials(me.displayName)}</span>}
            >
              {(close) => (
                <>
                  <div className="pt-menu-head">
                    <b>{me.displayName}</b>
                    <span className="as-mono">{me.username}</span>
                  </div>
                  <Link className="dropdown-item" to="/my/account" onClick={close}><i className="bi bi-person me-2" aria-hidden="true" />My account</Link>
                  <Link className="dropdown-item" to="/my/notifications" onClick={close}><i className="bi bi-bell me-2" aria-hidden="true" />Notifications</Link>
                  <Link className="dropdown-item" to="/contact" onClick={close}><i className="bi bi-life-preserver me-2" aria-hidden="true" />Help & contact</Link>
                  <Link className="dropdown-item" to="/" onClick={close}><i className="bi bi-globe2 me-2" aria-hidden="true" />AutoSense website</Link>
                  <hr className="dropdown-divider" />
                  <button type="button" className="dropdown-item" onClick={() => { close(); void signOut(); }}>
                    <i className="bi bi-box-arrow-right me-2" aria-hidden="true" />Sign out
                  </button>
                </>
              )}
            </Dropdown>
          </div>
        </div>
      </header>

      <main className="pt-main">
        <div className="pt-wrap">
          <Outlet context={context} />
        </div>
      </main>

      <footer className="pt-footer">
        <div className="pt-wrap">
          <span>© {new Date().getFullYear()} {BUSINESS.name} · v{config.version}{config.environment !== 'production' && ' · test data'}</span>
          <nav aria-label="Help">
            <a href={telUrl}><i className="bi bi-telephone me-1" aria-hidden="true" />{BUSINESS.phone}</a>
            <Link to="/contact">Help</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>

      <nav className="pt-tabbar" aria-label={`${first}'s portal`}>
        {NAV.slice(0, 2).map((n) => <TabLink key={n.to} {...n} />)}
        <Link to="/my/bookings/new" className="pt-tab-book" aria-label="Book a service">
          <i className="bi bi-plus-lg" aria-hidden="true" />
        </Link>
        {NAV.slice(2).map((n) => <TabLink key={n.to} {...n} />)}
      </nav>
    </div>
  );
}

function TabLink({ to, label, icon, end }: { to: string; label: string; icon: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end}>
      <i className={`bi ${icon}`} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

/**
 * The bell: a red count of new notifications; opening it shows the latest and marks them as seen (they keep their
 * "new" dot until the panel closes).
 */
function NotificationBell({ feed, onOpen }: { feed: MyNotifications | undefined; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Notice[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const unread = feed?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      setShown(feed?.items.slice(0, 6) ?? []);
      if (unread > 0) onOpen();
    }
    setOpen((o) => !o);
  }

  function go(link: string | null) {
    setOpen(false);
    if (link) navigate(link);
  }

  return (
    <div className="pt-bell-wrap" ref={ref}>
      <button type="button" className="pt-bell" aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} aria-expanded={open} onClick={toggle}>
        <i className={`bi ${unread ? 'bi-bell-fill' : 'bi-bell'}`} aria-hidden="true" />
        {unread > 0 && <span className="pt-badge" key={unread}>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="pt-panel" role="dialog" aria-label="Notifications">
          <div className="pt-panel-head">
            <b>Notifications</b>
            <Link to="/my/notifications" onClick={() => setOpen(false)}>See all</Link>
          </div>
          {shown.length === 0 ? (
            <div className="pt-panel-empty">
              <i className="bi bi-bell-slash" aria-hidden="true" />
              Nothing new. We'll let you know when your vehicle moves on or a report is ready.
            </div>
          ) : (
            <ul className="pt-notes">
              {shown.map((n, i) => (
                <li key={n.id} style={{ '--i': i } as CSSProperties}>
                  <NoticeRow n={n} onClick={() => go(n.link)} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** One notification: coloured icon, what happened, when, and a dot while it's new. */
export function NoticeRow({ n, onClick }: { n: Notice; onClick?: () => void }) {
  return (
    <button type="button" className={`pt-note cp-tone-${n.tone}${n.unread ? ' unread' : ''}`} onClick={onClick} disabled={!n.link}>
      <span className="pt-note-ic"><i className={`bi ${n.icon}`} aria-hidden="true" /></span>
      <span className="pt-note-txt">
        <b>{n.title}</b>
        {n.body && <span>{n.body}</span>}
        <small>{timeAgo(n.at)}</small>
      </span>
      {n.unread && <span className="pt-note-dot" aria-label="New" />}
    </button>
  );
}
