import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert, Field, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import { BayCanvas } from './BayCanvas';
import type { Bay, Camera, Point, VideoJob } from './occupancy.types';
import './occupancy.css';

/**
 * Setup › Bays & cameras (screen BAYS_CAMERAS, component 1: bay occupancy).
 * Add cameras, draw each bay's outline on a frame of the camera's video, and run the occupancy service over the
 * camera's recorded video. The outlines tell the service which part of the picture is which bay.
 */
const STATE: Record<string, { label: string; tone: Tone }> = {
  occupied: { label: 'Occupied', tone: 'brand' },
  free: { label: 'Free', tone: 'success' },
  uncertain: { label: 'Confirming', tone: 'info' },
};
const JOB: Record<VideoJob['status'], { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Running', tone: 'brand' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export function BaysCamerasPage() {
  const { can } = useSession();
  const cameras = useApi<Camera[]>('/occupancy/cameras');
  const [cameraId, setCameraId] = useState<number | null>(null);
  const [editingCamera, setEditingCamera] = useState<Camera | 'new' | null>(null);

  // Pick the first camera once the list arrives
  useEffect(() => {
    if (cameraId === null && cameras.data?.length) setCameraId(cameras.data[0]!.cameraId);
  }, [cameras.data, cameraId]);
  const camera = cameras.data?.find((c) => c.cameraId === cameraId) ?? null;

  return (
    <>
      <PageHeader
        title="Bays & cameras"
        subtitle="Draw each service bay on its camera, then process the camera's video"
        actions={can('BAYS_CAMERAS') && (
          <button type="button" className="btn btn-primary" onClick={() => setEditingCamera('new')}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />Add camera
          </button>
        )}
      />
      <div className="app-content"><div className="container-fluid">
        <div className="row g-3">
          <div className="col-xl-3 col-lg-4">
            <Card icon="bi-camera-video" title="Cameras">
              {cameras.error && !cameras.data ? <ErrorState inline error={cameras.error} onRetry={cameras.reload} />
                : cameras.loading ? <><Skeleton width="80%" /><Skeleton width="60%" /></>
                : cameras.data!.length === 0 ? <EmptyState icon="bi-camera-video" title="No cameras yet">Add the camera that watches your bays.</EmptyState>
                : (
                  <ul className="as-cam-list">
                    {cameras.data!.map((c) => (
                      <li key={c.cameraId}>
                        <button type="button" className={`as-cam${c.cameraId === cameraId ? ' on' : ''}`} onClick={() => setCameraId(c.cameraId)}>
                          <span className="as-cam-name">{c.name}{!c.isActive && <span className="text-body-secondary"> (off)</span>}</span>
                          <span className="as-cam-sub">{c.code} · {c.bayCount} {c.bayCount === 1 ? 'bay' : 'bays'}</span>
                          <StatusPill tone={c.status === 'online' ? 'success' : 'muted'}>{c.status === 'online' ? 'Online' : 'Offline'}</StatusPill>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
            </Card>
          </div>
          <div className="col-xl-9 col-lg-8">
            {camera ? (
              <CameraPanel key={camera.cameraId} camera={camera} onEdit={() => setEditingCamera(camera)} onChanged={cameras.reload} />
            ) : !cameras.loading && !cameras.error && (
              <Card><EmptyState icon="bi-bounding-box" title="Choose a camera">Its bays and video appear here.</EmptyState></Card>
            )}
          </div>
        </div>
      </div></div>

      {editingCamera && (
        <CameraForm
          camera={editingCamera === 'new' ? null : editingCamera}
          onClose={() => setEditingCamera(null)}
          onSaved={(c) => { setEditingCamera(null); setCameraId(c.cameraId); cameras.reload(); }}
        />
      )}
    </>
  );
}

function CameraPanel({ camera, onEdit, onChanged }: { camera: Camera; onEdit: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const manage = can('BAYS_CAMERAS');
  const bays = useApi<Bay[]>('/occupancy/bays', { cameraId: camera.cameraId }, { refreshMs: 5000 });
  const [frameAt, setFrameAt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [drawingFor, setDrawingFor] = useState<Bay | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [editingBay, setEditingBay] = useState<Bay | 'new' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const snapshot = `/api/occupancy/cameras/${camera.cameraId}/snapshot?at=${frameAt}`;

  function startDrawing(bay: Bay) {
    setDrawingFor(bay);
    setDraft([]);
    setSelected(bay.bayId);
    setMessage(null);
  }

  async function saveOutline() {
    if (!drawingFor || draft.length < 3) return;
    setSaving(true);
    try {
      await apiSend('PATCH', `/occupancy/bays/${drawingFor.bayId}`, { polygon: draft });
      setMessage({ tone: 'success', text: `Outline of ${drawingFor.name} saved.` });
      setDrawingFor(null);
      bays.reload();
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : 'The outline could not be saved.' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card
        icon="bi-bounding-box"
        title={camera.name}
        subtitle={<>{camera.code}{camera.location && ` · ${camera.location}`} · source {camera.sourceUrl ? <code>{camera.sourceUrl}</code> : 'not set'}</>}
        actions={manage && <button type="button" className="btn btn-light btn-sm" onClick={onEdit}>Edit camera</button>}
      >
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {!camera.sourceUrl ? (
          <EmptyState icon="bi-camera-video-off" title="No video source">
            Give this camera an rtsp:// address or the name of a video file in the occupancy service's video folder.
          </EmptyState>
        ) : (
          <>
            <div className="as-toolbar mb-2">
              <label className="d-flex align-items-center gap-2 small mb-0">
                Frame at
                <input type="number" min={0} step={1} className="form-control form-control-sm" style={{ width: '6rem' }}
                       value={frameAt} onChange={(e) => setFrameAt(Math.max(0, Number(e.target.value) || 0))} aria-label="Seconds into the video" />
                s
              </label>
              {drawingFor ? (
                <div className="d-flex align-items-center gap-2 ms-auto flex-wrap">
                  <span className="small">Drawing <b>{drawingFor.name}</b>: click each corner ({draft.length} so far)</span>
                  <button type="button" className="btn btn-light btn-sm" disabled={draft.length === 0} onClick={() => setDraft((d) => d.slice(0, -1))}>Undo point</button>
                  <button type="button" className="btn btn-light btn-sm" onClick={() => setDrawingFor(null)}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" disabled={draft.length < 3 || saving} onClick={() => void saveOutline()}>
                    {saving ? 'Saving…' : 'Save outline'}
                  </button>
                </div>
              ) : (
                <span className="small text-body-secondary ms-auto">Choose a frame where the bay lines are visible, then draw each bay.</span>
              )}
            </div>
            <BayCanvas
              key={snapshot}
              src={snapshot}
              bays={(bays.data ?? []).filter((b) => !drawingFor || b.bayId !== drawingFor.bayId)}
              selected={selected}
              onSelect={setSelected}
              draft={drawingFor ? draft : null}
              onAddPoint={(p) => setDraft((d) => (d.length < 50 ? [...d, p] : d))}
            />
          </>
        )}
      </Card>

      <Card
        icon="bi-p-square"
        title="Bays on this camera"
        className="mt-3"
        actions={manage && <button type="button" className="btn btn-light btn-sm" onClick={() => setEditingBay('new')}><i className="bi bi-plus-lg me-1" aria-hidden="true" />Add bay</button>}
      >
        {bays.error && !bays.data ? <ErrorState inline error={bays.error} onRetry={bays.reload} />
          : bays.loading ? <Skeleton width="70%" />
          : bays.data!.length === 0 ? <EmptyState icon="bi-p-square" title="No bays on this camera">Add a bay, then draw its outline on the picture.</EmptyState>
          : (
            <div className="table-responsive">
              <table className="table as-table mb-0">
                <thead><tr><th>Bay</th><th>Outline</th><th>State</th><th>Since</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {bays.data!.map((b) => (
                    <tr key={b.bayId} className={selected === b.bayId ? 'table-active' : ''} onClick={() => setSelected(b.bayId)}>
                      <td><b>{b.code}</b> {b.name}{!b.isActive && <span className="text-body-secondary"> (off)</span>}</td>
                      <td>{b.polygon ? `${b.polygon.length} points` : <StatusPill tone="warning">Not drawn</StatusPill>}</td>
                      <td>{b.state ? <StatusPill tone={STATE[b.state]!.tone}>{STATE[b.state]!.label}</StatusPill> : <StatusPill tone="muted">No reading</StatusPill>}</td>
                      <td className="small">{b.since ? `${formatDate(b.since)} ${formatTime(b.since)}` : '—'}</td>
                      <td className="text-end text-nowrap">
                        {manage && camera.sourceUrl && (
                          <button type="button" className="btn btn-light btn-sm me-1" disabled={!!drawingFor} onClick={(e) => { e.stopPropagation(); startDrawing(b); }}>
                            {b.polygon ? 'Redraw' : 'Draw'}
                          </button>
                        )}
                        {manage && <button type="button" className="btn btn-light btn-sm" onClick={(e) => { e.stopPropagation(); setEditingBay(b); }}>Edit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <VideoJobs camera={camera} canManage={manage} canStart={manage && !!camera.sourceUrl && !!bays.data?.some((b) => b.polygon && b.isActive)} onFinished={() => { bays.reload(); onChanged(); }} />

      {editingBay && (
        <BayForm
          bay={editingBay === 'new' ? null : editingBay}
          cameraId={camera.cameraId}
          nextOrder={(bays.data?.length ?? 0) + 1}
          onClose={() => setEditingBay(null)}
          onSaved={() => { setEditingBay(null); bays.reload(); onChanged(); }}
        />
      )}
    </>
  );
}

function VideoJobs({ camera, canManage, canStart, onFinished }: { camera: Camera; canManage: boolean; canStart: boolean; onFinished: () => void }) {
  const jobs = useApi<Page<VideoJob>>('/occupancy/video-jobs', { pageSize: 10 });
  const mine = jobs.data?.records.filter((j) => j.cameraId === camera.cameraId) ?? [];
  const active = mine.some((j) => j.status === 'queued' || j.status === 'running');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // While a job runs, refresh every 2 s
  const { reload } = jobs;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(reload, 2000);
    return () => window.clearInterval(id);
  }, [active, reload]);

  // When a job has just finished, refresh the bays too (once, on the running -> finished change)
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  });
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) finished.current();
    wasActive.current = active;
  }, [active]);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', path, body);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      icon="bi-film"
      title="Video processing"
      subtitle="The occupancy service finds vehicles in the camera's video and confirms each bay change"
      className="mt-3"
      actions={canStart && (
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || active} onClick={() => void run('/occupancy/video-jobs', { cameraId: camera.cameraId })}>
          <i className="bi bi-play-fill me-1" aria-hidden="true" />Process video
        </button>
      )}
    >
      {error && <Alert>{error}</Alert>}
      {jobs.error && !jobs.data ? <ErrorState inline error={jobs.error} onRetry={jobs.reload} />
        : jobs.loading ? <Skeleton width="60%" />
        : mine.length === 0 ? <EmptyState icon="bi-film" title="No video processed yet">{canStart ? 'Process the video to fill in the bay states.' : 'Draw at least one bay outline first.'}</EmptyState>
        : (
          <div className="table-responsive">
            <table className="table as-table mb-0">
              <thead><tr><th>Started</th><th>Status</th><th>Progress</th><th>Bay changes</th><th>Model</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {mine.map((j) => (
                  <tr key={j.videoJobId}>
                    <td className="small">{formatDate(j.createdAt)} {formatTime(j.createdAt)}<div className="text-body-secondary">{j.createdBy ?? ''}</div></td>
                    <td><StatusPill tone={JOB[j.status].tone}>{JOB[j.status].label}</StatusPill>{j.error && <div className="small text-danger mt-1">{j.error}</div>}</td>
                    <td style={{ minWidth: '9rem' }}>
                      {j.totalFrames ? (
                        <>
                          <div className="as-meter"><i style={{ width: `${Math.min(100, (j.framesProcessed / j.totalFrames) * 100)}%` }} /></div>
                          <span className="small text-body-secondary">{j.framesProcessed} / {j.totalFrames} frames</span>
                        </>
                      ) : <span className="small">{j.framesProcessed} frames</span>}
                    </td>
                    <td>{j.transitions}</td>
                    <td className="small">
                      {j.modelVersion ?? '—'}
                      {j.roiMask !== null && <div className="text-body-secondary">{j.roiMask ? 'Bays only (outside masked)' : 'Full frame'}</div>}
                      {j.modelVersion?.includes('placeholder') && <div><StatusPill tone="warning">Not fine-tuned</StatusPill></div>}
                    </td>
                    <td className="text-end">
                      {canManage && (j.status === 'queued' || j.status === 'running') && (
                        <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={() => void run(`/occupancy/video-jobs/${j.videoJobId}/cancel`)}>Stop</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Card>
  );
}

function CameraForm({ camera, onClose, onSaved }: { camera: Camera | null; onClose: () => void; onSaved: (c: Camera) => void }) {
  const [form, setForm] = useState({
    code: camera?.code ?? '', name: camera?.name ?? '', location: camera?.location ?? '', sourceUrl: camera?.sourceUrl ?? '', isActive: camera?.isActive ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fields = fieldErrors(error);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved(camera
        ? await apiSend<Camera>('PATCH', `/occupancy/cameras/${camera.cameraId}`, form)
        : await apiSend<Camera>('POST', '/occupancy/cameras', form));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title={camera ? `Edit ${camera.name}` : 'Add camera'} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
        <button type="submit" form="camera-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : camera ? 'Save' : 'Add camera'}</button>
      </>}>
      {error instanceof ApiError && !Object.keys(fields).length && <Alert>{error.message}</Alert>}
      <form id="camera-form" onSubmit={(e) => void submit(e)}>
        <div className="row">
          <Field className="col-4" label="Code" required maxLength={20} value={form.code} onChange={set('code')} error={fields.code} placeholder="CAM-B" />
          <Field className="col-8" label="Name" required maxLength={80} value={form.name} onChange={set('name')} error={fields.name} placeholder="Workshop B" />
        </div>
        <Field label="Location" maxLength={120} value={form.location} onChange={set('location')} error={fields.location} />
        <Field label="Video source" maxLength={500} value={form.sourceUrl} onChange={set('sourceUrl')} error={fields.sourceUrl}
               hint="An rtsp:// address, or a video file name in the occupancy service's videos folder (e.g. workshop-b.mp4)." />
        <div className="form-check">
          <input id="cam-active" className="form-check-input" type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          <label className="form-check-label" htmlFor="cam-active">In use</label>
        </div>
      </form>
    </Modal>
  );
}

function BayForm({ bay, cameraId, nextOrder, onClose, onSaved }: {
  bay: Bay | null; cameraId: number; nextOrder: number; onClose: () => void; onSaved: () => void;
}) {
  const cameras = useApi<Camera[]>('/occupancy/cameras');
  const [form, setForm] = useState({
    code: bay?.code ?? '', name: bay?.name ?? '', cameraId: bay?.cameraId ?? cameraId, displayOrder: bay?.displayOrder ?? nextOrder, isActive: bay?.isActive ?? true,
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fields = fieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // An outline belongs to one camera's picture: moving the bay to another camera clears it
      const moved = bay && bay.cameraId !== form.cameraId;
      if (bay) await apiSend('PATCH', `/occupancy/bays/${bay.bayId}`, moved ? { ...form, polygon: null } : form);
      else await apiSend('POST', '/occupancy/bays', form);
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal title={bay ? `Edit ${bay.name}` : 'Add bay'} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
        <button type="submit" form="bay-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : bay ? 'Save' : 'Add bay'}</button>
      </>}>
      {error instanceof ApiError && !Object.keys(fields).length && <Alert>{error.message}</Alert>}
      <form id="bay-form" onSubmit={(e) => void submit(e)}>
        <div className="row">
          <Field className="col-4" label="Code" required maxLength={10} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} error={fields.code} placeholder="B7" />
          <Field className="col-8" label="Name" required maxLength={40} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} error={fields.name} placeholder="Bay 7" />
        </div>
        <div className="row">
          <SelectField className="col-8" label="Camera" value={form.cameraId} error={fields.cameraId} onChange={(e) => setForm((f) => ({ ...f, cameraId: Number(e.target.value) }))}>
            {(cameras.data ?? []).map((c) => <option key={c.cameraId} value={c.cameraId}>{c.name} ({c.code})</option>)}
          </SelectField>
          <Field className="col-4" label="Order" type="number" min={0} max={999} value={form.displayOrder} error={fields.displayOrder}
                 onChange={(e) => setForm((f) => ({ ...f, displayOrder: Number(e.target.value) || 0 }))} />
        </div>
        {bay && bay.cameraId !== form.cameraId && bay.polygon && <Alert tone="warning">The outline was drawn on the old camera, so it will be removed. Draw it again on the new camera.</Alert>}
        <div className="form-check">
          <input id="bay-active" className="form-check-input" type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
          <label className="form-check-label" htmlFor="bay-active">In use</label>
        </div>
      </form>
    </Modal>
  );
}
