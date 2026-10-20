import { useState } from 'react';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend } from '@/lib/api';
import { formatDuration, formatTime, minutesSince } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import type { BayBoardData, BayCard, JobListItem } from '@/modules/dashboard/dashboard.types';
import { STAGES } from '@/modules/dashboard/stages';
import { JobActions } from '@/modules/floor/JobActions';
import { BayHistory } from './BayHistory';
import { BaySuggestions } from './BaySuggestions';
import { LiveBayPicture } from './LiveBayPicture';
import type { Camera, LiveCamera } from './occupancy.types';

/**
 * Service floor › Bay monitor (screen BAY_MONITOR, component 1: bay occupancy).
 * First the live feed: every camera's bays with their live picture (while the camera is live), state, and the job in
 * the bay. Then the selected bay's job and its history of confirmed changes, and the queue for a bay. Everything shown
 * comes from the database and the occupancy service; nothing is made up. Camera suggestions (which waiting vehicle is
 * in a bay, whether a vehicle left) appear as small pop-ups in the corner (BaySuggestions); staff confirm them.
 */
const STATE = {
  occupied: { label: 'Occupied', tone: 'brand' },
  free: { label: 'Free', tone: 'success' },
  uncertain: { label: 'Confirming', tone: 'info' },
  unknown: { label: 'No reading', tone: 'muted' },
} as const;

/** Where a camera's live picture comes from, shown on every picture (none of today's sources is a real camera). */
function footageTag(code: string) {
  if (code === 'TEST-SIM') return 'Live · simulated footage';
  if (code.startsWith('TEST-PKL')) return 'Live · PKLot sample footage';
  return 'Live';
}

type CameraGroup = { cameraId: number | null; code: string; name: string; bays: BayCard[] };

/** Bays grouped by camera: cameras running live first, then by name; bays without a camera last. */
function byCamera(bays: BayCard[], live: LiveCamera[]): CameraGroup[] {
  const groups = new Map<number | null, CameraGroup>();
  for (const b of bays) {
    const key = b.camera?.cameraId ?? null;
    if (!groups.has(key)) groups.set(key, { cameraId: key, code: b.camera?.code ?? '', name: b.camera?.name ?? 'Bays without a camera', bays: [] });
    groups.get(key)!.bays.push(b);
  }
  const isLive = (g: CameraGroup) => live.some((l) => l.cameraId === g.cameraId);
  return [...groups.values()].sort((a, b) =>
    Number(isLive(b)) - Number(isLive(a)) || Number(b.cameraId !== null) - Number(a.cameraId !== null) || a.name.localeCompare(b.name));
}

export function BayMonitorPage() {
  const live = useApi<LiveCamera[]>('/occupancy/live', undefined, { refreshMs: 10_000 });
  const liveBays = new Set(live.data?.flatMap((c) => c.bayIds) ?? []);
  const board = useApi<BayBoardData>('/dashboard/bays', undefined, { refreshMs: liveBays.size > 0 ? 3_000 : 15_000 });
  const cameras = useApi<Camera[]>('/occupancy/cameras');
  const [picked, setPicked] = useState<number | null>(null);

  const bays = board.data?.bays ?? [];
  const groups = byCamera(bays, live.data ?? []);
  const selected = bays.find((b) => b.bayId === picked) ?? groups[0]?.bays[0] ?? null;
  const reloadAll = () => { board.reload(); live.reload(); };

  return (
    <>
      <PageHeader
        title="Bay monitor"
        subtitle={live.data && live.data.length > 0
          ? <span className="as-live">Live · {live.data.map((c) => c.cameraName).join(', ')} · updated {formatTime(new Date())}</span>
          : <span>No camera is running live</span>}
        actions={
          <button type="button" className="btn btn-light" onClick={reloadAll}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />Refresh
          </button>
        }
      />

      <div className="app-content">
        <div className="container-fluid">
          <div className="as-dash">
            {board.error && !board.data ? (
              <Card icon="bi-camera-video" title="Live feed"><ErrorState inline error={board.error} onRetry={board.reload} title="Bays couldn't be loaded" /></Card>
            ) : board.loading || !board.data ? (
              <Card icon="bi-camera-video" title="Live feed">
                <div className="as-feed" aria-busy="true">
                  {Array.from({ length: 6 }, (_, i) => <div className="as-feed-tile" key={i}><Skeleton width="100%" /><Skeleton width="60%" /></div>)}
                </div>
              </Card>
            ) : bays.length === 0 ? (
              <Card icon="bi-camera-video" title="Live feed">
                <EmptyState icon="bi-bounding-box" title="No bays set up yet">Add a camera and draw its bays in Setup › Bays &amp; cameras.</EmptyState>
              </Card>
            ) : (
              groups.map((g) => (
                <CameraFeed
                  key={g.cameraId ?? 'none'}
                  group={g}
                  live={live.data?.find((l) => l.cameraId === g.cameraId) ?? null}
                  anotherLive={(live.data ?? []).some((l) => l.cameraId !== g.cameraId)}
                  camera={cameras.data?.find((c) => c.cameraId === g.cameraId) ?? null}
                  selectedId={selected?.bayId ?? null}
                  onSelect={setPicked}
                  onChanged={reloadAll}
                />
              ))
            )}

            {selected?.job && <BayJob bay={selected} onChanged={board.reload} />}
            {selected && <BayHistory key={selected.bayId} bayId={selected.bayId} bayName={selected.name} />}
            <Queue tick={bays.filter((b) => b.job).length} />
          </div>
        </div>
      </div>

      <BaySuggestions onConfirmed={board.reload} />
    </>
  );
}

/** One camera: its live status (with Start / Stop for staff who manage cameras) and its bays' tiles. */
function CameraFeed({ group, live, anotherLive, camera, selectedId, onSelect, onChanged }: {
  group: CameraGroup;
  live: LiveCamera | null;
  anotherLive: boolean;
  camera: Camera | null;
  selectedId: number | null;
  onSelect: (bayId: number) => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = (s: BayCard['state']) => group.bays.filter((b) => b.state === s).length;
  const canManage = can('BAYS_CAMERAS') && group.cameraId !== null;

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', path, body);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const actions = canManage && (live ? (
    <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={() => void run(`/occupancy/video-jobs/${live.videoJobId}/cancel`)}>
      <i className="bi bi-stop-fill me-1" aria-hidden="true" />Stop
    </button>
  ) : camera?.sourceUrl && !camera.sourceUrl.startsWith('rtsp') ? (
    <button type="button" className="btn btn-primary btn-sm" disabled={busy || anotherLive}
      title={anotherLive ? 'Another camera is running live. Stop it first.' : undefined}
      onClick={() => void run('/occupancy/video-jobs', { cameraId: group.cameraId, live: true })}>
      <i className="bi bi-broadcast me-1" aria-hidden="true" />Start live camera
    </button>
  ) : null);

  return (
    <Card
      icon="bi-camera-video"
      title={group.name}
      subtitle={
        <>
          {live ? <span className="as-live">Live since {formatTime(live.startedAt)}</span> : <span>Not running</span>}
          {' · '}{count('occupied')} occupied · {count('free')} free{count('uncertain') ? ` · ${count('uncertain')} confirming` : ''} · {group.bays.length} bays
        </>
      }
      actions={actions}
    >
      {error && <Alert>{error}</Alert>}
      {!live && (
        <p className="small text-body-secondary">
          {anotherLive ? 'Another camera is running live; only one runs at a time.'
            : canManage ? 'Start the live camera to see the bays and follow vehicles as they arrive.'
            : 'The live picture appears when the camera is started (Setup › Bays & cameras).'}
        </p>
      )}
      <div className="as-feed">
        {group.bays.map((bay) => (
          <FeedTile key={bay.bayId} bay={bay} live={!!live && live.bayIds.includes(bay.bayId)} tag={footageTag(group.code)}
            selected={bay.bayId === selectedId} onSelect={() => onSelect(bay.bayId)} />
        ))}
      </div>
    </Card>
  );
}

function FeedTile({ bay, live, tag, selected, onSelect }: { bay: BayCard; live: boolean; tag: string; selected: boolean; onSelect: () => void }) {
  const state = STATE[bay.state];
  return (
    <button type="button" className={`as-feed-tile${selected ? ' on' : ''}`} aria-pressed={selected} onClick={onSelect}>
      {live ? <LiveBayPicture bayId={bay.bayId} label={bay.name} tag={tag} /> : (
        <div className="as-bay-live as-feed-off"><span>No live picture</span></div>
      )}
      <span className="as-feed-head">
        <b>{bay.name}</b>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </span>
      {bay.job ? (
        <span className="as-feed-job">
          <span className="as-mono">{bay.job.registrationNo}</span> · {bay.job.vehicle}
          <span className="d-block"><StatusPill tone={STAGES[bay.job.stage].tone}>{STAGES[bay.job.stage].label}</StatusPill></span>
        </span>
      ) : (
        <span className="as-feed-job text-body-secondary">
          {bay.state === 'free' && 'Ready for the next vehicle'}
          {bay.state === 'occupied' && 'Vehicle in the bay, no job linked yet'}
          {bay.state === 'uncertain' && 'Vehicle on the bay line, confirming'}
          {bay.state === 'unknown' && 'No reading from the camera yet'}
        </span>
      )}
      <span className="as-feed-foot">{bay.since ? `${state.label} for ${formatDuration(minutesSince(bay.since))}` : ' '}</span>
    </button>
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
      actions={<JobActions job={job} onDone={onChanged} size="md" showCancel={false} />}
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
        <p className="small text-body-secondary mb-0">Nobody is waiting. Check vehicles in on Vehicles &amp; jobs.</p>
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
