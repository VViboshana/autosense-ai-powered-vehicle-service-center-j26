import { Link } from 'react-router-dom';
import styles from './Navbar.module.css';

const links = [
  { href: '#components', label: 'Components' },
  { href: '#event-bus', label: 'Event bus' },
  { href: '#overview', label: 'Overview' },
  { href: '#how-it-works', label: 'How it works' },
];

export default function Navbar() {
  return (
    <header className={styles.bar}>
      <nav className={styles.inner} aria-label="Main">
        <Link to="/" className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">▲</span>
          AutoSense
        </Link>
        <ul className={styles.links}>
          {links.map((l) => (
            <li key={l.href}>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>
        {/* Placeholder: becomes a real login once auth exists. */}
        <button type="button" className={styles.signIn} disabled title="Coming soon">
          Staff sign in
        </button>
      </nav>
    </header>
  );
}
