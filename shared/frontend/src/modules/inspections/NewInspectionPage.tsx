import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiUpload, fieldErrors } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import type { JobStage } from '@/modules/dashboard/dashboard.types';
import type { InspectionDetail, VehicleOption, ViewAngle } from './inspections.types';
import { VIEW_ANGLES } from './inspections.ui';
import './inspections.css';

type Shot = { key: string; file: File; preview: string; angle: ViewAngle };
type UploadLimits = { maxImageMb: number; maxImagesPerInspection: number; allowedTypes: string[] };

const DEFAULT_LIMITS: UploadLimits = { maxImageMb: 10, maxImagesPerInspection: 3, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] };
// The usual order to walk round a vehicle; each new photo gets the next angle not used yet
const ANGLE_ORDER: ViewAngle[] = ['front', 'left', 'rear', 'right', 'other'];

/**
 * Inspections › New inspection (INSPECTION_CREATE). Choose the vehicle's open job, add up to three photos with the
 * side of the vehicle each one shows, then analyse. The damage service checks every photo; the result opens for review.
 */
export function NewInspectionPage() {
  const { config } = useSession();
  const limits = { ...DEFAULT_LIMITS, ...(config.settings['damage.upload'] as Partial<UploadLimits> | undefined) };
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [job, setJob] = useState<VehicleOption | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Search as the user types, but wait until they pause (one request instead of one per key)
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(draft.trim()), 300);
    return () => window.clearTimeout(t);
  }, [draft]);
  const options = useApi<VehicleOption[]>('/inspections/vehicle-options', { search });

  // Previews are object URLs: free them when a photo is removed or the page closes
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.preview)), []);

  function addFiles(files: FileList | null) {
    if (!files) return;
    setProblem(null);
    const added: Shot[] = [];
    for (const file of Array.from(files)) {
      if (shots.length + added.length >= limits.maxImagesPerInspection) {
        setProblem(`Add at most ${limits.maxImagesPerInspection} photos.`);
        break;
      }
      if (!limits.allowedTypes.includes(file.type)) {
        setProblem(`${file.name} is not a JPEG, PNG or WebP photo.`);
        continue;
      }
      if (file.size > limits.maxImageMb * 1024 * 1024) {
        setProblem(`${file.name} is larger than ${limits.maxImageMb} MB.`);
        continue;
      }
      const used = [...shots, ...added].map((s) => s.angle);
      added.push({
        key: `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        preview: URL.createObjectURL(file),
        angle: ANGLE_ORDER.find((a) => !used.includes(a)) ?? 'other',
      });
    }
    setShots((s) => [...s, ...added]);
    if (fileInput.current) fileInput.current.value = ''; // so the same file can be chosen again
  }

  function removeShot(key: string) {
    setShots((s) => {
      const gone = s.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return s.filter((x) => x.key !== key);
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!job || shots.length === 0) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('jobId', String(job.jobId));
    for (const s of shots) {
      form.append('images', s.file);
      form.append('viewAngles', s.angle);
    }
    try {
      const created = await apiUpload<InspectionDetail>('/inspections', form);
      navigate(`/inspections/${created.inspectionId}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const fields = fieldErrors(error);

  return (
    <>
      <PageHeader title="New inspection" subtitle="Photograph the vehicle; the damage model marks the damage for a technician to check." />
      <div className="app-content">
        <div className="container-fluid">
          <form onSubmit={submit} noValidate>
            {error instanceof ApiError && <Alert>{error.message}</Alert>}

            <Card icon="bi-car-front" title="1. Vehicle" subtitle="Choose the vehicle's open job.">
              {job ? (
                <div className="as-dmg-job" aria-pressed="true">
                  <i className="bi bi-check-circle-fill text-success" aria-hidden="true" />
                  <JobLine o={job} />
                  <button type="button" className="btn btn-sm btn-light" disabled={busy} onClick={() => setJob(null)}>Change</button>
                </div>
              ) : (
                <>
                  <input
                    className="form-control mb-3"
                    style={{ maxWidth: '22rem' }}
                    type="search"
                    placeholder="Vehicle no. or job no."
                    aria-label="Search open jobs by vehicle number or job number"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {options.error && !options.data ? (
                    <ErrorState inline error={options.error} onRetry={options.reload} title="Open jobs couldn't be loaded" />
                  ) : options.loading || !options.data ? (
                    <div className="as-dmg-jobs">{[1, 2, 3].map((i) => <Skeleton key={i} width="100%" />)}</div>
                  ) : options.data.length === 0 ? (
                    <EmptyState icon="bi-car-front" title={search ? 'No open job matches this search' : 'No open jobs'}>
                      Check the vehicle in first; its job then appears here.
                    </EmptyState>
                  ) : (
                    <div className="as-dmg-jobs">
                      {options.data.map((o) => (
                        <button key={o.jobId} type="button" className="as-dmg-job" aria-pressed="false" onClick={() => setJob(o)}>
                          <JobLine o={o} />
                          <i className="bi bi-chevron-right text-body-secondary" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {fields.vehicleId && <div className="text-danger small mt-2">{fields.vehicleId}</div>}
            </Card>

            <Card
              icon="bi-camera"
              title="2. Photos"
              subtitle={`Up to ${limits.maxImagesPerInspection} photos, ${limits.maxImageMb} MB each. Stand 2–3 m away so the whole side of the vehicle is in the photo, in good light.`}
            >
              {problem && <Alert tone="warning">{problem}</Alert>}
              {fields.images && <Alert>{fields.images}</Alert>}
              <div className="as-dmg-shots">
                {shots.map((s, n) => (
                  <div key={s.key} className="as-dmg-shot">
                    <img src={s.preview} alt={`Photo ${n + 1}`} />
                    <div className="as-dmg-shot-foot">
                      <select
                        className="form-select form-select-sm"
                        aria-label={`Side shown in photo ${n + 1}`}
                        value={s.angle}
                        disabled={busy}
                        onChange={(e) => setShots((all) => all.map((x) => (x.key === s.key ? { ...x, angle: e.target.value as ViewAngle } : x)))}
                      >
                        {(Object.keys(VIEW_ANGLES) as ViewAngle[]).map((a) => <option key={a} value={a}>{VIEW_ANGLES[a]}</option>)}
                      </select>
                      <button type="button" className="btn btn-sm btn-light" aria-label={`Remove photo ${n + 1}`} disabled={busy} onClick={() => removeShot(s.key)}>
                        <i className="bi bi-trash" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
                {shots.length < limits.maxImagesPerInspection && (
                  <label className="as-dmg-add">
                    <i className="bi bi-camera" aria-hidden="true" />
                    <span>{shots.length === 0 ? 'Take or choose photos' : 'Add another photo'}</span>
                    <input
                      ref={fileInput}
                      type="file"
                      className="visually-hidden"
                      accept={limits.allowedTypes.join(',')}
                      capture="environment"
                      multiple
                      disabled={busy}
                      onChange={(e) => addFiles(e.target.files)}
                    />
                  </label>
                )}
              </div>
            </Card>

            <div className="d-flex align-items-center gap-3 mb-4">
              <button type="submit" className="btn btn-primary" disabled={busy || !job || shots.length === 0}>
                {busy ? (
                  <>
                    <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
                    Analysing {shots.length} {shots.length === 1 ? 'photo' : 'photos'}…
                  </>
                ) : (
                  <>
                    <i className="bi bi-magic me-1" aria-hidden="true" />
                    Analyse photos
                  </>
                )}
              </button>
              <span className="small text-body-secondary">
                {busy ? 'This takes a few seconds per photo.' : !job ? 'Choose the vehicle first.' : shots.length === 0 ? 'Add at least one photo.' : 'The result opens for review.'}
              </span>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function JobLine({ o }: { o: VehicleOption }) {
  const stage = STAGES[o.stage as JobStage];
  return (
    <span className="as-veh">
      <b>{o.registrationNo}</b>
      <small>
        {o.vehicle} · <span className="as-mono">{o.jobNo}</span>
        {o.customer && ` · ${o.customer}`} · in {formatDate(o.checkedInAt)} {formatTime(o.checkedInAt)}
        {o.inspectionCount > 0 && ` · ${o.inspectionCount} inspection${o.inspectionCount === 1 ? '' : 's'} already`}
      </small>
      {stage && <span className="ms-2"><StatusPill tone={stage.tone}>{stage.label}</StatusPill></span>}
    </span>
  );
}
