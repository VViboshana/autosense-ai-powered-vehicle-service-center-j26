import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDuration, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { BayBoardData, BayCard } from './dashboard.types';

const STATE_PILL = {
  occupied: <StatusPill tone="brand">Occupied</StatusPill>,
  free: <StatusPill tone="success">Free</StatusPill>,
  uncertain: <StatusPill tone="info">Confirming</StatusPill>,
  unknown: <StatusPill tone="muted">No reading</StatusPill>,
} as const;

function Bay({ bay, next }: { bay: BayCard; next: BayBoardData['nextInQueue'] }) {
  const head = (
    <div className="as-bay-top">
      <span className="as-bay-name">{bay.name}</span>
      {STATE_PILL[bay.state]}
    </div>
  );

  if (bay.state === 'occupied' && bay.job) {
    const inBay = bay.job.bayEnteredAt ? minutesSince(bay.job.bayEnteredAt) : null;
    const est = bay.job.estimatedMinutes;
    const over = inBay !== null && est !== null && inBay > est;
    return (
      <div className="as-bay">
        {head}
        <div>
          <div className="as-plate">{bay.job.registrationNo}</div>
          <div className="as-bay-line">
            {bay.job.vehicle} · {bay.job.service}
          </div>
        </div>
        {inBay !== null && est !== null && (
          <div className={`as-meter${over ? ' over' : ''}`} title={`${formatDuration(inBay)} of a ${formatDuration(est)} forecast`}>
            <i style={{ width: `${Math.min(100, Math.max(3, (inBay / est) * 100))}%` }} />
          </div>
        )}
        <div className="as-bay-foot">
          <span>
            <b>{inBay === null ? '—' : formatDuration(inBay)}</b> in bay
          </span>
          {est !== null &&
            (over && inBay !== null ? (
              <span style={{ color: 'var(--as-warning)' }}>{formatDuration(inBay - est)} over forecast</span>
            ) : (
              <span>of {formatDuration(est)} forecast</span>
            ))}
        </div>
      </div>
    );
  }

  const lines: [string, string] =
    bay.state === 'occupied'
      ? ['Vehicle in bay', 'Not linked to a job yet']
      : bay.state === 'free'
        ? [
            bay.since ? `Free for ${formatDuration(minutesSince(bay.since))}` : 'Free',
            next ? `Next in queue: ${next.registrationNo} · ${next.vehicle}` : 'No vehicles waiting',
          ]
        : bay.state === 'uncertain'
          ? ['Vehicle detected on the bay line', 'Confirming whether it is parked']
          : ['No reading from the camera yet', 'Check the camera in Bays & cameras'];

  return (
    <div className={`as-bay${bay.state === 'free' ? ' free' : ''}`}>
      {head}
      <div>
        <div className="text-body-secondary small">{lines[0]}</div>
        <div className="as-bay-line">{lines[1]}</div>
      </div>
    </div>
  );
}

/** "Bays now": live state of every bay, refreshed every 30 seconds. */
export function BayBoard() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<BayBoardData>('/dashboard/bays', undefined, { refreshMs: 30_000 });

  const subtitle = data?.camera
    ? `${data.camera.name} · ${data.bays.length} bays · camera ${data.camera.code}${data.camera.status === 'offline' ? ' (offline)' : ''}`
    : data
      ? `${data.bays.length} bays`
      : 'Loading…';

  return (
    <Card
      className="h-100"
      icon="bi-p-square"
      title="Bays now"
      labelledBy="bays-now"
      subtitle={subtitle}
      actions={
        <>
          <span className="as-bay-legend d-none d-md-flex" aria-hidden="true">
            {STATE_PILL.occupied}
            {STATE_PILL.free}
            {STATE_PILL.uncertain}
          </span>
          {can('BAY_MONITOR') && (
            <Link className="as-more" to="/floor/bays">
              Open bay monitor <i className="bi bi-arrow-right" aria-hidden="true" />
            </Link>
          )}
        </>
      }
    >
      {error && !data ? (
        <ErrorState inline error={error} onRetry={reload} title="Bays couldn't be loaded" />
      ) : loading || !data ? (
        <div className="as-bays" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="as-bay" key={i}>
              <Skeleton width="45%" />
              <Skeleton width="60%" />
              <Skeleton width="80%" />
            </div>
          ))}
        </div>
      ) : data.bays.length === 0 ? (
        <EmptyState icon="bi-bounding-box" title="No bays set up yet">
          Draw the bays on a camera view in Administration › Bays &amp; cameras.
        </EmptyState>
      ) : (
        <div className="as-bays">
          {data.bays.map((bay) => (
            <Bay key={bay.bayId} bay={bay} next={data.nextInQueue} />
          ))}
        </div>
      )}
    </Card>
  );
}
