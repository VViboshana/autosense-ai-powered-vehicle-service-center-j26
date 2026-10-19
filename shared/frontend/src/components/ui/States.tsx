import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api';

/** A grey loading bar. Give it the rough width of the text it stands in for. */
export function Skeleton({ width = '100%', className = '' }: { width?: string; className?: string }) {
  return <span className={`as-skel ${className}`} style={{ width }} aria-hidden="true" />;
}

/**
 * Nothing to show yet: say what will appear here and, when there is one, how to add the first item. `art` replaces
 * the icon with a small drawing (e.g. <DrivingCar />).
 */
export function EmptyState({ icon = 'bi-inbox', art, title, children, action }: {
  icon?: string;
  art?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="as-empty">
      {art ?? <i className={`bi ${icon}`} aria-hidden="true" />}
      <b>{title}</b>
      {children}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** A request failed: what went wrong, a retry button and the reference to quote when reporting it. */
export function ErrorState({ error, onRetry, title, inline = false }: {
  error: ApiError;
  onRetry?: () => void;
  title?: string;
  inline?: boolean;
}) {
  const forbidden = error.code === 'FORBIDDEN';
  return (
    <div className={`as-state-card ${inline ? 'inline' : ''}`} role="alert">
      <div className={`as-state-icon ${forbidden ? 'as-tone-warning' : 'as-tone-danger'}`}>
        <i className={`bi ${forbidden ? 'bi-lock' : 'bi-exclamation-triangle'}`} aria-hidden="true" />
      </div>
      <h2 className="h6 fw-semibold">{title ?? (forbidden ? "You don't have access to this" : "This couldn't be loaded")}</h2>
      <p className="text-body-secondary mb-0 small">{error.message}</p>
      {error.requestId && <span className="as-ref">Reference {error.requestId.slice(0, 8)}</span>}
      {onRetry && !forbidden && (
        <div className="mt-3">
          <button type="button" className="btn btn-light btn-sm" onClick={onRetry}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
