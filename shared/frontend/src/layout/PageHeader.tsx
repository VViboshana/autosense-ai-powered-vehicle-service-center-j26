import { useEffect, type ReactNode } from 'react';

/** Title row of every screen: title, a subtitle line, and the screen's main actions on the right. Also sets the tab title. */
export function PageHeader({ title, subtitle, actions, documentTitle }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Browser tab title when `title` is not plain text. */
  documentTitle?: string;
}) {
  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    document.title = tabTitle ? `${tabTitle} · AutoSense` : 'AutoSense';
  }, [tabTitle]);

  return (
    <div className="app-content-header">
      <div className="container-fluid">
        <div className="as-page-header">
          <div>
            <h1 className="as-page-title">{title}</h1>
            {subtitle && <div className="as-page-sub">{subtitle}</div>}
          </div>
          {actions && <div className="as-page-actions">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
