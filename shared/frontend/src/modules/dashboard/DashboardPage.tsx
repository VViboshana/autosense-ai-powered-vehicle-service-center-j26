import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { PageHeader } from '@/layout/PageHeader';
import { formatLongDate, formatTime, localHour } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { ActionList } from './ActionList';
import { BayBoard } from './BayBoard';
import type { DashboardSummary } from './dashboard.types';
import { KeyFigures } from './KeyFigures';
import { TodayVehicles } from './TodayVehicles';

function greeting() {
  const h = localHour();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** The home screen: one layout for every role; widgets and buttons the user may not use are left out. */
export function DashboardPage() {
  const { me, can, config } = useSession();
  const summary = useApi<DashboardSummary>('/dashboard/summary', undefined, { refreshMs: 30_000 });
  const firstName = me.displayName.split(' ')[0] ?? me.displayName;
  const now = new Date();

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        documentTitle="Dashboard"
        subtitle={
          <>
            <span>{formatLongDate(now)}</span>
            <span aria-hidden="true">·</span>
            {summary.error && summary.data ? (
              <span className="text-warning">Couldn't refresh · showing {formatTime(now)} data</span>
            ) : (
              <span className="as-live">Live · updated {formatTime(now)}</span>
            )}
            {config.environment !== 'production' && <span className="as-sample">Sample data</span>}
          </>
        }
        actions={
          <>
            {can('JOB_CHECK_IN') && (
              <Link className="btn btn-light" to="/floor/jobs">
                <i className="bi bi-box-arrow-in-right me-1" aria-hidden="true" />
                Check in vehicle
              </Link>
            )}
            {can('INSPECTION_CREATE') && (
              <Link className="btn btn-primary" to="/inspections/new">
                <i className="bi bi-camera me-1" aria-hidden="true" />
                New inspection
              </Link>
            )}
          </>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          <div className="as-dash">
            <KeyFigures summary={summary} />
            <div className="row g-3">
              <div className="col-xl-8">
                <BayBoard />
              </div>
              <div className="col-xl-4">
                <ActionList />
              </div>
            </div>
            <TodayVehicles />
          </div>
        </div>
      </div>
    </>
  );
}
