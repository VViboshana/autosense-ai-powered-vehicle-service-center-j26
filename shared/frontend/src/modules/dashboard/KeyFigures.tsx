import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { ErrorState, Skeleton } from '@/components/ui/States';
import type { ApiState } from '@/lib/useApi';
import { formatDuration, minutesSince } from '@/lib/format';
import type { DashboardSummary } from './dashboard.types';

function Kpi({ icon, label, to, className = '', value, note }: {
  icon: string;
  label: string;
  to?: string;
  className?: string;
  value: ReactNode;
  note: ReactNode;
}) {
  const body = (
    <>
      <span className="as-kpi-label">
        <i className={`bi ${icon}`} aria-hidden="true" />
        {label}
      </span>
      <span className="as-kpi-value">{value}</span>
      <span className="as-kpi-note">{note}</span>
    </>
  );
  return to ? (
    <Link className={`as-kpi ${className}`} to={to}>
      {body}
    </Link>
  ) : (
    <div className={`as-kpi ${className}`}>{body}</div>
  );
}

/** The strip of key figures at the top of the dashboard. Each cell links to its screen when the user may open it. */
export function KeyFigures({ summary }: { summary: ApiState<DashboardSummary> }) {
  const { can } = useSession();
  const { data, error, loading, reload } = summary;

  if (error && !data) {
    return (
      <section className="as-card">
        <ErrorState inline error={error} onRetry={reload} title="Key figures couldn't be loaded" />
      </section>
    );
  }

  if (loading || !data) {
    return (
      <section className="as-card as-kpis" aria-label="Key figures" aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div className="as-kpi" key={i}>
            <Skeleton width="55%" />
            <Skeleton width="40%" className="my-2" />
            <Skeleton width="70%" />
          </div>
        ))}
      </section>
    );
  }

  const diff = data.vehiclesToday - data.vehiclesSameTimeLastWeek;
  const link = (code: string, url: string) => (can(code) ? url : undefined);

  return (
    <section className="as-card as-kpis" aria-label="Key figures">
      <Kpi
        icon="bi-car-front"
        label="Vehicles today"
        to={link('JOBS', '/floor/jobs')}
        value={data.vehiclesToday}
        note={
          data.vehiclesSameTimeLastWeek > 0 ? (
            <>
              <span className={diff >= 0 ? 'as-up' : ''}>{diff >= 0 ? `+${diff}` : diff}</span> vs same time last week
            </>
          ) : data.vehiclesToday === 0 ? (
            'None checked in yet'
          ) : (
            'Checked in so far'
          )
        }
      />
      <Kpi
        icon="bi-p-square"
        label="Bays occupied"
        to={link('BAY_MONITOR', '/floor/bays')}
        value={
          <>
            {data.bays.occupied}
            <small>of {data.bays.total}</small>
          </>
        }
        note={
          data.bays.total === 0
            ? 'No bays set up yet'
            : `${data.bays.free} free${data.bays.uncertain ? ` · ${data.bays.uncertain} confirming` : ''}`
        }
      />
      <Kpi
        icon="bi-clipboard-check"
        label="Awaiting review"
        to={link('INSPECTION_REVIEW', '/inspections/review')}
        value={data.awaitingReview.count}
        note={
          data.awaitingReview.oldestAt
            ? `Oldest waiting ${formatDuration(minutesSince(data.awaitingReview.oldestAt))}`
            : 'Nothing to review'
        }
      />
      <Kpi
        icon="bi-hourglass-split"
        label="Avg. time in bay"
        value={data.timeInBay.averageMinutes === null ? '—' : formatDuration(data.timeInBay.averageMinutes)}
        note={
          data.timeInBay.jobsDone === 0
            ? 'No jobs finished yet today'
            : `${data.timeInBay.jobsDone} job${data.timeInBay.jobsDone === 1 ? '' : 's'} finished today`
        }
      />
      {data.safety.connected ? (
        <Kpi
          icon="bi-shield-exclamation"
          label="Open safety alerts"
          to={link('SAFETY_ALERTS', '/safety/alerts')}
          className={data.safety.openAlerts > 0 ? 'alert-cell' : ''}
          value={data.safety.openAlerts}
          note={data.safety.openAlerts > 0 ? 'Needs attention' : 'All clear'}
        />
      ) : (
        <Kpi icon="bi-shield-exclamation" label="Open safety alerts" className="not-connected" value="—" note="Connects when Safety is ready" />
      )}
    </section>
  );
}
