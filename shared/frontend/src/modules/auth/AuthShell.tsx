import { useEffect, type ReactNode } from 'react';
import { Brand } from '@/components/Brand';

/** The two-panel frame of the sign-in and sign-up pages: brand panel on the left, the form on the right. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · AutoSense`;
  }, [title]);

  return (
    <div className="as-auth">
      <aside className="as-auth-brand">
        <Brand to="/login" height={56} />
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
        <div className="as-auth-form">{children}</div>
      </main>
    </div>
  );
}
