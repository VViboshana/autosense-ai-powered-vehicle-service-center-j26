import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Dropdown } from '@/components/ui/Dropdown';
import { initials } from '@/lib/format';

/** Menu toggle, global search, notifications and the user menu. */
export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { me, signOut } = useSession();
  const search = useRef<HTMLInputElement>(null);

  // Ctrl+K (Cmd+K on a Mac) jumps to search, as the hint in the box says.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <nav className="app-header navbar navbar-expand">
      <div className="container-fluid gap-2">
        <button type="button" className="as-icon-btn" onClick={onToggleSidebar} aria-label="Show or hide the menu">
          <i className="bi bi-list fs-5" aria-hidden="true" />
        </button>

        <form className="as-search ms-2 d-none d-md-block" role="search" onSubmit={(e) => e.preventDefault()}>
          <i className="bi bi-search" aria-hidden="true" />
          <label className="visually-hidden" htmlFor="global-search">
            Search
          </label>
          <input ref={search} id="global-search" className="form-control" type="search" placeholder="Vehicle no., customer, job or inspection ID" />
          <kbd>Ctrl K</kbd>
        </form>

        <div className="ms-auto d-flex align-items-center gap-1">
          <Dropdown label="Notifications" buttonClassName="as-icon-btn" trigger={<i className="bi bi-bell fs-5" aria-hidden="true" />} menuClassName="p-0">
            <div className="as-empty" style={{ width: '18rem', padding: '1.5rem 1rem' }}>
              <i className="bi bi-bell-slash" aria-hidden="true" />
              <b>No notifications yet</b>
              <span className="small">Alerts, inspections to review and freed bays will appear here.</span>
            </div>
          </Dropdown>

          <Dropdown
            label="Your account"
            buttonClassName="as-user"
            trigger={
              <>
                <span className="as-avatar">{initials(me.displayName)}</span>
                <span className="as-user-meta d-none d-md-inline-block">
                  <span className="d-block small fw-semibold">{me.displayName}</span>
                  <small>{me.designation ?? me.role.name}</small>
                </span>
                <i className="bi bi-chevron-down small ms-1" aria-hidden="true" />
              </>
            }
          >
            {(close) => (
              <>
                <div className="dropdown-header">
                  <div className="small text-body-secondary">Signed in as</div>
                  <div className="fw-semibold text-body">{me.username}</div>
                  <div className="small text-body-secondary">{me.role.name}</div>
                </div>
                <div className="dropdown-divider" />
                <Link className="dropdown-item" to="/account" onClick={close}>
                  <i className="bi bi-person me-2" aria-hidden="true" />
                  My account
                </Link>
                <button type="button" className="dropdown-item" onClick={() => { close(); void signOut(); }}>
                  <i className="bi bi-box-arrow-right me-2" aria-hidden="true" />
                  Sign out
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </div>
    </nav>
  );
}
