import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession, type MenuNode } from '@/app/session';
import { Brand } from '@/components/Brand';

function containsPath(node: MenuNode, path: string): boolean {
  return node.url === path || node.children.some((c) => containsPath(c, path));
}

/** True when the link's url is the address itself or a parent of it ("/inspections" covers "/inspections/14"). */
const covers = (url: string, path: string) => path === url || (url !== '/' && path.startsWith(`${url}/`));

/**
 * The one menu link to highlight: the closest match for the address. Without this, "/inspections/new" would light up
 * both "New inspection" and "Inspection history" (/inspections).
 */
function activeUrl(menu: MenuNode[], path: string): string | null {
  let best: string | null = null;
  const visit = (nodes: MenuNode[]) =>
    nodes.forEach((n) => {
      if (n.kind === 'link' && n.url && covers(n.url, path) && n.url.length > (best?.length ?? -1)) best = n.url;
      visit(n.children);
    });
  visit(menu);
  return best;
}

function MenuLink({ node }: { node: MenuNode }) {
  const { menu } = useSession();
  const { pathname } = useLocation();
  const active = node.url !== null && activeUrl(menu, pathname) === node.url;
  return (
    <li className="nav-item">
      <Link to={node.url ?? '/'} className={`nav-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
        <i className={`nav-icon bi ${node.icon}`} aria-hidden="true" />
        <p>{node.name}</p>
      </Link>
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
        <Brand />
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
