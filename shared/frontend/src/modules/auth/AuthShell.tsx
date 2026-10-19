import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/session';
import { Brand } from '@/components/Brand';

/** The two-panel frame of the sign-in and sign-up pages: brand panel on the left, the form on the right. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const { config } = useAuth();
  useEffect(() => {
    document.title = `${title} · AutoSense`;
  }, [title]);
  // During first-run setup there is no website yet: the logo stays on this page
  const home = config.setup.needed ? '/setup' : '/';

  return (
    <div className="as-auth">
      <aside className="as-auth-brand">
        <Brand to={home} height={56} />
        <div>
          <h1>The service floor, inspections and maintenance in one place.</h1>
          <p className="mt-3">
            AutoSense helps the service centre watch its bays, inspect vehicle damage from photos and plan maintenance. Customers
            follow their own vehicle from check-in to pickup.
          </p>
        </div>
        <div className="as-auth-bays" aria-hidden="true">
          <span className="on">Bay 1 · In service</span>
          <span>Bay 2 · Free</span>
          <span className="on">Bay 3 · In service</span>
        </div>
      </aside>
      <main className="as-auth-panel">
        {!config.setup.needed && (
          <Link to="/" className="as-auth-home"><i className="bi bi-arrow-left" aria-hidden="true" />Back to the website</Link>
        )}
        <div className="as-auth-form">{children}</div>
      </main>
    </div>
  );
}
