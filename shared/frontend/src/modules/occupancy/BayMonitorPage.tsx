import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { BayBoardData, BayCard } from '@/modules/dashboard/dashboard.types';
import { STAGES } from '@/modules/dashboard/stages';
import { JobActions } from '@/modules/floor/JobActions';
import { BayHistory } from './BayHistory';
import { BaySuggestions } from './BaySuggestions';
import { LiveBayPicture } from './LiveBayPicture';
import type { LiveCamera } from './occupancy.types';
import type { Page } from '@/lib/page';
import type { JobListItem } from '@/modules/dashboard/dashboard.types';

/**
 * Service floor › Bay monitor (screen BAY_MONITOR, component 1: bay occupancy).
 * Live state of every service bay, refreshed every 15 seconds from GET /api/dashboard/bays.
 * Bay states come from the occupancy service: free, occupied, or uncertain (shown as "Confirming").
 * Pick a bay to see its history of confirmed changes below (BayHistory). When the camera sees a bay occupied with no
 * job in it, BaySuggestions proposes the waiting vehicle for staff to confirm. Bays whose camera is live show their
 * live picture, and the board then refreshes every 3 seconds instead of 15.
 */
const STATE = {
  occupied: { label: 'Occupied', tone: 'brand' },
  free: { label: 'Free', tone: 'success' },
  uncertain: { label: 'Confirming', tone: 'info' },
  unknown: { label: 'No reading', tone: 'muted' },
} as const;

function BayTile({ bay, live, selected, onSelect }: { bay: BayCard; live: boolean; selected: boolean; onSelect: () => void }) {
  const state = STATE[bay.state];
  const inBay = bay.job?.bayEnteredAt ? minutesSince(bay.job.bayEnteredAt) : null;
  const forecast = bay.job?.estimatedMinutes ?? null;

  return (
    <button
      type="button"
      className={`as-bay as-bay-pick${bay.state === 'free' ? ' free' : ''}${selected ? ' on' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className="as-bay-top">
        <span className="as-bay-name">{bay.name}</span>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </div>

      {live && <LiveBayPicture bayId={bay.bayId} label={bay.name} />}

      {bay.job ? (
        <div>
          <div className="as-plate">{bay.job.registrationNo}</div>
          <div className="as-bay-line">
            {bay.job.vehicle} · {bay.job.service}
          </div>
          <div className="mt-1"><StatusPill tone={STAGES[bay.job.stage].tone}>{STAGES[bay.job.stage].label}</StatusPill></div>
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
    </button>
  );
}

export function BayMonitorPage() {
  const live = useApi<LiveCamera[]>('/occupancy/live', undefined, { refreshMs: 10_000 });
  const liveBays = new Set(live.data?.flatMap((c) => c.bayIds) ?? []);
  const { data, error, loading, reload } = useApi<BayBoardData>('/dashboard/bays', undefined, { refreshMs: liveBays.size > 0 ? 3_000 : 15_000 });

  const count = (s: BayCard['state']) => data?.bays.filter((b) => b.state === s).length ?? 0;
  const camera = data?.camera;
  const [picked, setPicked] = useState<number | null>(null);
  const selected = data?.bays.find((b) => b.bayId === picked) ?? data?.bays[0] ?? null;

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

            <BaySuggestions onConfirmed={reload} />
            <Queue tick={data?.bays.filter((b) => b.job).length ?? 0} />

            <Card
              icon="bi-p-square"
              title="Bays now"
              labelledBy="bays-now"
              subtitle={`${liveBays.size > 0 ? `Live: ${live.data!.map((c) => c.cameraName).join(', ')} · refreshes every 3 seconds` : 'Refreshes every 15 seconds'} · pick a bay to see its history`}
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
                  Bays appear here once they are drawn on a camera view.
                </EmptyState>
              ) : (
                <div className="as-bays">
                  {data.bays.map((bay) => (
                    <BayTile key={bay.bayId} bay={bay} live={liveBays.has(bay.bayId)} selected={bay.bayId === selected?.bayId} onSelect={() => setPicked(bay.bayId)} />
                  ))}
                </div>
              )}
            </Card>

            {selected?.job && <BayJob bay={selected} onChanged={reload} />}
            {selected && <BayHistory key={selected.bayId} bayId={selected.bayId} bayName={selected.name} />}
          </div>
        </div>
      </div>
    </>
  );
}

const INSPECTION: Record<string, string> = {
  awaiting_review: 'Inspection waiting for review',
  confirmed: 'Inspection confirmed',
  processing: 'Inspection being analysed',
  draft: 'Inspection started',
  failed: 'Inspection failed',
};

/** The job in the selected bay, with the next step of the service flow (send to damage inspection, work done). */
function BayJob({ bay, onChanged }: { bay: BayCard; onChanged: () => void }) {
  const job = bay.job!;
  return (
    <Card
      icon="bi-car-front"
      title={`In ${bay.name}: ${job.registrationNo}`}
      subtitle={`${job.vehicle} · ${job.service} · ${job.jobNo}`}
      actions={<JobActions job={{ ...job, stage: job.stage }} onDone={onChanged} size="md" showCancel={false} />}
    >
      <div className="d-flex flex-wrap gap-2 align-items-center small">
        <StatusPill tone={STAGES[job.stage].tone}>{STAGES[job.stage].label}</StatusPill>
        <span className="text-body-secondary">
          {job.inspectionStatus ? INSPECTION[job.inspectionStatus] : 'No damage inspection yet'}
          {job.bayEnteredAt && ` · in the bay since ${formatTime(job.bayEnteredAt)}`}
        </span>
      </div>
    </Card>
  );
}

/** The queue for a bay: checked-in vehicles waiting, first come first served (check-in order). */
function Queue({ tick }: { tick: number }) {
  const { data, error, loading, reload } = useApi<Page<JobListItem>>('/jobs', { scope: 'open', stage: 'waiting_for_bay', pageSize: 10, tick }, { refreshMs: 10_000 });
  if (error && !data) return <Card icon="bi-hourglass-split" title="Queue for a bay"><ErrorState inline error={error} onRetry={reload} title="The queue couldn't be loaded" /></Card>;
  if (loading || !data) return null;
  return (
    <Card icon="bi-hourglass-split" title="Queue for a bay" subtitle={data.totalCount === 0 ? undefined : 'When the camera sees a car drive into a free bay, it suggests the first vehicle here'}>
      {data.totalCount === 0 ? (
        <p className="small text-body-secondary mb-0">Nobody is waiting. Check vehicles in on Vehicles & jobs.</p>
      ) : (
        <ol className="as-queue">
          {data.records.map((j, i) => (
            <li key={j.jobId}>
              <span className="as-queue-no">{i + 1}</span>
              <span><b className="as-mono">{j.registrationNo}</b> · {j.vehicle}<span className="d-block small text-body-secondary">{j.service} · {j.jobNo} · waiting since {formatTime(j.checkedInAt)}</span></span>
            </li>
          ))}
          {data.totalCount > data.records.length && <li className="small text-body-secondary">and {data.totalCount - data.records.length} more</li>}
        </ol>
      )}
    </Card>
  );
}
