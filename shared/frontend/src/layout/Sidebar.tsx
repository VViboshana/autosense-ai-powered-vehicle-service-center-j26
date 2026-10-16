import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useSession, type MenuNode } from '@/app/session';

function containsPath(node: MenuNode, path: string): boolean {
  return node.url === path || node.children.some((c) => containsPath(c, path));
}

function MenuLink({ node }: { node: MenuNode }) {
  return (
    <li className="nav-item">
      <NavLink to={node.url ?? '/'} end={node.url === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
        <i className={`nav-icon bi ${node.icon}`} aria-hidden="true" />
        <p>{node.name}</p>
      </NavLink>
    </li>
  );
}

function MenuGroup({ node }: { node: MenuNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(() => containsPath(node, pathname));
  return (
    <li className={`nav-item${open ? ' menu-open' : ''}`}>
      <a
        href="#"
        className="nav-link"
        role="button"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <i className={`nav-icon bi ${node.icon}`} aria-hidden="true" />
        <p>
          {node.name}
          <i className="nav-arrow bi bi-chevron-right" aria-hidden="true" />
        </p>
      </a>
      <ul className="nav nav-treeview">
        {node.children.map((child) => (
          <MenuItem key={child.code} node={child} />
        ))}
      </ul>
    </li>
  );
}

function MenuItem({ node }: { node: MenuNode }) {
  if (node.kind === 'group') return <MenuGroup node={node} />;
  if (node.kind === 'header') {
    return (
      <>
        <li className="nav-header">{node.name}</li>
        {node.children.map((child) => (
          <MenuItem key={child.code} node={child} />
        ))}
      </>
    );
  }
  return <MenuLink node={node} />;
}

/** The dark sidebar. Its items come from GET /api/navigation/menu, already filtered by the user's role. */
export function Sidebar() {
  const { menu, config } = useSession();
  return (
    <aside className="app-sidebar" data-bs-theme="dark">
      <div className="sidebar-brand">
        <Link to="/" className="as-brand" aria-label="AutoSense home">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="#F26A1B" />
            <path d="M9 24V10h14v14" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16" cy="17" r="3.2" fill="#fff" />
          </svg>
          <span className="as-brand-text">
            Auto<b>Sense</b>
          </span>
        </Link>
      </div>
      <div className="sidebar-wrapper">
        <nav className="mt-2" aria-label="Main menu">
          <ul className="nav sidebar-menu flex-column" role="navigation">
            {menu.map((node) => (
              <MenuItem key={node.code} node={node} />
            ))}
          </ul>
        </nav>
      </div>
      <div className="as-powered">AutoSense AI · v{config.version}</div>
    </aside>
  );
}
