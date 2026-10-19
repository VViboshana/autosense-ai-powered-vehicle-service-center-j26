import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/app/session';
import { Brand } from '@/components/Brand';
import { BUSINESS, mailUrl, mapsUrl, SERVICES, telUrl } from '@/site/business';
import './site.css';

const SITE_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/services', label: 'Services' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

/**
 * The public website: a fixed header (clear over the page's dark hero, dark glass once the page scrolls), a menu
 * drawer on phones, and the footer. Every public page starts with a dark hero band so the header always reads.
 * Elements marked data-reveal fade up as they scroll into view.
 */
export function SiteLayout() {
  const { session } = useAuth();
  const { pathname, hash } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const customer = session?.me.userType === 'customer';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // A new page: back to the top, menu closed, and its reveal animations armed
  useEffect(() => {
    setMenuOpen(false);
    const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      items.forEach((el) => el.classList.add('in'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            observer.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname, hash]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.classList.add('st-locked');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('st-locked');
    };
  }, [menuOpen]);

  const actions = customer ? (
    <Link to="/my" className="btn btn-primary st-cta">
      <i className="bi bi-grid-1x2 me-2" aria-hidden="true" />
      My portal
    </Link>
  ) : (
    <>
      <Link to="/login" className="btn st-ghost">Sign in</Link>
      <Link to="/register" className="btn btn-primary st-cta">Create account</Link>
    </>
  );

  return (
    <div className="st">
      <a href="#main" className="st-skip">Skip to content</a>
      <header className={`st-header${scrolled || menuOpen ? ' scrolled' : ''}`}>
        <div className="st-wrap st-header-row">
          <Brand to="/" height={36} />
          <nav className="st-nav" aria-label="Main">
            {SITE_LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>
            ))}
          </nav>
          <div className="st-actions">{actions}</div>
          <button
            type="button"
            className="st-burger"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="st-drawer"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span /><span /><span />
          </button>
        </div>
      </header>

      <div id="st-drawer" className={`st-drawer${menuOpen ? ' open' : ''}`} aria-hidden={!menuOpen}>
        <nav aria-label="Main">
          {SITE_LINKS.map((l, i) => (
            <NavLink key={l.to} to={l.to} end={l.end} style={{ '--i': i } as CSSProperties} tabIndex={menuOpen ? 0 : -1}>
              {l.label}
              <i className="bi bi-arrow-right" aria-hidden="true" />
            </NavLink>
          ))}
        </nav>
        <div className="st-drawer-actions">{actions}</div>
        <a href={telUrl} className="st-drawer-call" tabIndex={menuOpen ? 0 : -1}>
          <i className="bi bi-telephone" aria-hidden="true" /> {BUSINESS.phone}
        </a>
      </div>

      <main id="main" className="st-main">
        <Outlet />
      </main>

      <footer className="st-footer">
        <div className="st-wrap st-footer-grid">
          <div className="st-footer-brand">
            <Brand to="/" height={40} />
            <p>{BUSINESS.name}. Book a service, follow your vehicle live and get a photo inspection report checked by a technician.</p>
            {!customer && <Link to="/register" className="btn btn-primary btn-sm">Create a free account</Link>}
          </div>
          <div>
            <h2>Explore</h2>
            <ul>
              {SITE_LINKS.slice(1).map((l) => <li key={l.to}><Link to={l.to}>{l.label}</Link></li>)}
              <li><Link to={customer ? '/my' : '/login'}>{customer ? 'My portal' : 'Sign in'}</Link></li>
            </ul>
          </div>
          <div>
            <h2>Services</h2>
            <ul>
              {SERVICES.slice(0, 6).map((s) => <li key={s.code}><Link to={`/services#${s.code.toLowerCase()}`}>{s.name}</Link></li>)}
            </ul>
          </div>
          <div>
            <h2>Visit us</h2>
            <ul className="st-footer-contact">
              <li><i className="bi bi-geo-alt" aria-hidden="true" /><a href={mapsUrl} target="_blank" rel="noreferrer">{BUSINESS.address.line1}, {BUSINESS.address.line2}</a></li>
              <li><i className="bi bi-telephone" aria-hidden="true" /><a href={telUrl}>{BUSINESS.phone}</a></li>
              <li><i className="bi bi-envelope" aria-hidden="true" /><a href={mailUrl()}>{BUSINESS.email}</a></li>
            </ul>
            <dl className="st-hours">
              {BUSINESS.hours.map((h) => (
                <div key={h.days}><dt>{h.days}</dt><dd>{h.time}</dd></div>
              ))}
            </dl>
          </div>
        </div>
        <div className="st-wrap st-footer-bottom">
          <span>© {new Date().getFullYear()} {BUSINESS.name}</span>
          <nav aria-label="Legal">
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            {!session && <Link to="/login">Staff sign in</Link>}
          </nav>
        </div>
      </footer>
    </div>
  );
}

/** The dark band each inner page starts with: a small label, the title and one or two lines under it. */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: string; lead?: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · AutoSense`;
  }, [title]);
  return (
    <section className="st-page-hero">
      <div className="st-glow" aria-hidden="true" />
      <div className="st-wrap">
        <div className="st-eyebrow st-in">{eyebrow}</div>
        <h1 className="st-in" style={{ '--d': 1 } as CSSProperties}>{title}</h1>
        {lead && <p className="st-lead st-in" style={{ '--d': 2 } as CSSProperties}>{lead}</p>}
        {children}
      </div>
    </section>
  );
}
