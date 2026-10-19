import type { CSSProperties, ReactNode } from 'react';
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

/**
 * The bay drawn as a parking slot seen from above: a car parks into an occupied bay; on a bay being confirmed it
 * stops halfway, inside a moving dashed outline; a free bay shows a faint P.
 */
function BaySlot({ state, overlap }: { state: BayCard['state']; overlap: number | null }) {
  const car = state === 'occupied' || state === 'uncertain';
  return (
    <svg className={`as-slot ${state}`} viewBox="0 0 52 84" aria-hidden="true">
      <path className="lines" d="M4 0V84M48 0V84M4 1.5H48" />
      {state === 'uncertain' && <rect className="zone" x="9" y="5" width="34" height="75" rx="5" />}
      {state === 'free' && <text className="p" x="26" y="50" textAnchor="middle">P</text>}
      {state === 'unknown' && <text className="p" x="26" y="50" textAnchor="middle">?</text>}
      {car && (
        <g className="car">
          <rect className="body" x="12" y="9" width="28" height="60" rx="8" />
          <path className="glass" d="M15 25 Q26 20 37 25 L35 32 Q26 29 17 32 Z M17 54 Q26 57 35 54 L37 61 Q26 65 15 61 Z" />
          <rect className="wheel" x="9.5" y="16" width="3.5" height="10" rx="1.5" />
          <rect className="wheel" x="39" y="16" width="3.5" height="10" rx="1.5" />
          <rect className="wheel" x="9.5" y="51" width="3.5" height="10" rx="1.5" />
          <rect className="wheel" x="39" y="51" width="3.5" height="10" rx="1.5" />
          <rect className="lamp" x="15" y="9" width="6" height="2.5" rx="1" />
          <rect className="lamp" x="31" y="9" width="6" height="2.5" rx="1" />
        </g>
      )}
      {overlap !== null && <title>{`${Math.round(overlap * 100)}% of the vehicle is inside the bay`}</title>}
    </svg>
  );
}

function Bay({ bay, next, index }: { bay: BayCard; next: BayBoardData['nextInQueue']; index: number }) {
  const head = (
    <div className="as-bay-top">
      <span className="as-bay-name">{bay.name}</span>
      {STATE_PILL[bay.state]}
    </div>
  );
  const frame = (body: ReactNode) => (
    <div className={`as-bay as-bay-slotted${bay.state === 'free' ? ' free' : ''}`} style={{ '--i': index } as CSSProperties}>
      <BaySlot state={bay.state} overlap={bay.overlap} />
      <div className="as-bay-body">{body}</div>
    </div>
  );

  if (bay.state === 'occupied' && bay.job) {
    const inBay = bay.job.bayEnteredAt ? minutesSince(bay.job.bayEnteredAt) : null;
    const est = bay.job.estimatedMinutes;
    const over = inBay !== null && est !== null && inBay > est;
    return frame(
      <>
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
      </>,
    );
  }

  const lines: [string, string] =
    bay.state === 'occupied'
      ? [bay.since ? `Occupied for ${formatDuration(minutesSince(bay.since))}` : 'Vehicle in bay', 'Not linked to a job yet']
      : bay.state === 'free'
        ? [
            bay.since ? `Free for ${formatDuration(minutesSince(bay.since))}` : 'Free',
            next ? `Next in queue: ${next.registrationNo} · ${next.vehicle}` : 'No vehicles waiting',
          ]
        : bay.state === 'uncertain'
          ? ['Vehicle detected on the bay line', 'Confirming whether it is parked']
          : ['No reading from the camera yet', 'Check the camera in Bays & cameras'];

  return frame(
    <>
      {head}
      <div>
        <div className="text-body-secondary small">{lines[0]}</div>
        <div className="as-bay-line">{lines[1]}</div>
      </div>
      {bay.overlap !== null && (
        <div className="as-overlap" title="How much of the vehicle is inside the bay, from the camera">
          <span className="as-meter"><i style={{ width: `${Math.round(bay.overlap * 100)}%` }} /></span>
          <span>{Math.round(bay.overlap * 100)}% inside</span>
        </div>
      )}
    </>,
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
          {data.bays.map((bay, i) => (
            <Bay key={bay.bayId} bay={bay} next={data.nextInQueue} index={i} />
          ))}
        </div>
      )}
    </Card>
  );
}
