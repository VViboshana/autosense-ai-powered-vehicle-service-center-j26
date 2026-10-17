import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/layout/PageHeader';

function StatePage({ title, icon, tone, heading, children }: {
  title: string;
  icon: string;
  tone: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} />
      <div className="app-content">
        <div className="container-fluid">
          <div className="as-state-card">
            <div className={`as-state-icon as-tone-${tone}`}>
              <i className={`bi ${icon}`} aria-hidden="true" />
            </div>
            <h2 className="h6 fw-semibold">{heading}</h2>
            <p className="text-body-secondary small mb-3">{children}</p>
            <Link className="btn btn-light btn-sm" to="/">
              Back to the dashboard
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

/** A screen that is on the menu (app.screens) but has no page in the app yet. */
export function ComingSoonPage({ name, icon }: { name: string; icon: string }) {
  return (
    <StatePage title={name} icon={icon} tone="brand" heading="This screen is being built">
      {name} is on the menu for your role, but its page isn't in the app yet. It will appear here as soon as it's added.
    </StatePage>
  );
}

export function NotFoundPage() {
  return (
    <StatePage title="Page not found" icon="bi-signpost-split" tone="muted" heading="There's nothing at this address">
      The link may be old or mistyped. Use the menu to find the screen you need.
    </StatePage>
  );
}

export function AccessDeniedPage({ name }: { name: string }) {
  return (
    <StatePage title={name} icon="bi-lock" tone="warning" heading="You don't have access to this screen">
      Your role doesn't include {name}. Ask an administrator to add it in Administration › Role permissions.
    </StatePage>
  );
}
