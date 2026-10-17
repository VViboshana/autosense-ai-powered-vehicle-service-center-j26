import type { ReactNode } from 'react';

/** The standard white card with an optional head: icon + title, a subtitle, and actions on the right. */
export function Card({ icon, title, subtitle, actions, className = '', children, labelledBy }: {
  icon?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section className={`as-card ${className}`} aria-labelledby={labelledBy}>
      {(title || actions) && (
        <div className="as-card-head">
          <div>
            {title && (
              <h2 className="as-card-title" id={labelledBy}>
                {icon && <i className={`bi ${icon}`} aria-hidden="true" />}
                {title}
              </h2>
            )}
            {subtitle && <p className="as-card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="d-flex align-items-center gap-3 flex-wrap">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
