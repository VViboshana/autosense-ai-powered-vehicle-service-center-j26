import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { BayBoardData, BayCard } from '@/modules/dashboard/dashboard.types';

/**
 * Service floor › Bay monitor (screen BAY_MONITOR, component 1: bay occupancy).
 * Live state of every service bay, refreshed every 15 seconds from GET /api/dashboard/bays.
 * Bay states come from the occupancy service: free, occupied, or uncertain (shown as "Confirming").
 */
const STATE = {
  occupied: { label: 'Occupied', tone: 'brand' },
  free: { label: 'Free', tone: 'success' },
  uncertain: { label: 'Confirming', tone: 'info' },
  unknown: { label: 'No reading', tone: 'muted' },
} as const;

function BayTile({ bay }: { bay: BayCard }) {
  const state = STATE[bay.state];
  const inBay = bay.job?.bayEnteredAt ? minutesSince(bay.job.bayEnteredAt) : null;
  const forecast = bay.job?.estimatedMinutes ?? null;

  return (
    <div className={`as-bay${bay.state === 'free' ? ' free' : ''}`}>
      <div className="as-bay-top">
        <span className="as-bay-name">{bay.name}</span>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </div>

      {bay.job ? (
        <div>
          <div className="as-plate">{bay.job.registrationNo}</div>
          <div className="as-bay-line">
            {bay.job.vehicle} · {bay.job.service}
          </div>
        </div>
      ) : (
        <div className="as-bay-line">
          {bay.state === 'free' && 'Ready for the next vehicle'}
          {bay.state === 'occupied' && 'Vehicle in bay, not linked to a job'}
          {bay.state === 'uncertain' && 'Vehicle on the bay line, confirming'}
          {bay.state === 'unknown' && 'No reading from the camera yet'}
        </div>
      )}

      {inBay !== null && forecast !== null && (
        <div className={`as-meter${inBay > forecast ? ' over' : ''}`}>
          <i style={{ width: `${Math.min(100, Math.max(3, (inBay / forecast) * 100))}%` }} />
        </div>
      )}

      <div className="as-bay-foot">
        <span>{bay.since ? `${state.label} for ${formatDuration(minutesSince(bay.since))}` : '—'}</span>
        {bay.overlap !== null && <span>overlap {Math.round(bay.overlap * 100)}%</span>}
      </div>
    </div>
  );
}

export function BayMonitorPage() {
  const { data, error, loading, reload } = useApi<BayBoardData>('/dashboard/bays', undefined, { refreshMs: 15_000 });

  const count = (s: BayCard['state']) => data?.bays.filter((b) => b.state === s).length ?? 0;
  const camera = data?.camera;

  return (
    <>
      <PageHeader
        title="Bay monitor"
        subtitle={
          <>
            <span>{camera ? `${camera.name} · camera ${camera.code}` : 'Service bays'}</span>
            <span aria-hidden="true">·</span>
            {camera?.status === 'offline' ? (
              <span className="text-warning">Camera offline</span>
            ) : (
              <span className="as-live">Live · updated {formatTime(new Date())}</span>
            )}
          </>
        }
        actions={
          <button type="button" className="btn btn-light" onClick={reload}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
            Refresh
          </button>
        }
      />

      <div className="app-content">
        <div className="container-fluid">
          <div className="as-dash">
            {data && (
              <section className="as-card as-kpis" aria-label="Bay summary">
                <div className="as-kpi">
                  <span className="as-kpi-label"><i className="bi bi-p-square" aria-hidden="true" />Occupied</span>
                  <span className="as-kpi-value">{count('occupied')}<small>of {data.bays.length}</small></span>
                </div>
                <div className="as-kpi">
                  <span className="as-kpi-label"><i className="bi bi-check2-circle" aria-hidden="true" />Free</span>
                  <span className="as-kpi-value">{count('free')}</span>
                </div>
                <div className="as-kpi">
                  <span className="as-kpi-label"><i className="bi bi-hourglass-split" aria-hidden="true" />Confirming</span>
                  <span className="as-kpi-value">{count('uncertain')}</span>
                </div>
                <div className="as-kpi">
                  <span className="as-kpi-label"><i className="bi bi-car-front" aria-hidden="true" />Next in queue</span>
                  <span className="as-kpi-value" style={{ fontSize: '1.1rem' }}>
                    {data.nextInQueue ? data.nextInQueue.registrationNo : '—'}
                  </span>
                </div>
              </section>
            )}

            <Card icon="bi-p-square" title="Bays now" labelledBy="bays-now" subtitle="Refreshes every 15 seconds">
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
                  Bays appear here once they are drawn on a camera view.
                </EmptyState>
              ) : (
                <div className="as-bays">
                  {data.bays.map((bay) => (
                    <BayTile key={bay.bayId} bay={bay} />
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
