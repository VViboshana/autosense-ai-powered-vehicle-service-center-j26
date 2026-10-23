import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import type { InspectionDetail, SoundSituation, VehicleOption, ViewAngle } from './inspections.types';
import { VIEW_ANGLES } from './inspections.ui';
import { checkPhoto, type PhotoCheck } from './photoCheck';
import { SoundCapture, type Sound } from './SoundCapture';
import { VehicleSide } from './VehicleSide';
import './inspections.css';

type Shot = { file: File; preview: string; check: PhotoCheck | 'checking' | 'failed' };
type UploadLimits = { maxImageMb: number; maxImagesPerInspection: number; allowedTypes: string[] };

const DEFAULT_LIMITS: UploadLimits = { maxImageMb: 10, maxImagesPerInspection: 5, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] };
// One slot per side, in the order people walk round a vehicle; close-up for a detail
const SLOTS: ViewAngle[] = ['front', 'left', 'rear', 'right', 'other'];

/**
 * Inspections › New inspection (INSPECTION_CREATE). Choose the vehicle's open job, photograph the sides that show
 * damage (one slot per side, so the view angle is always right), optionally record the vehicle starting, idling or
 * braking, then analyse. Each photo gets a quick quality check in the browser first; the upload shows its real
 * progress, then the damage service analyses the photos and recordings.
 */
export function NewInspectionPage() {
  const { config } = useSession();
  const limits = { ...DEFAULT_LIMITS, ...(config.settings['damage.upload'] as Partial<UploadLimits> | undefined) };
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<ViewAngle>('front');

  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [job, setJob] = useState<VehicleOption | null>(null);
  const [shots, setShots] = useState<Partial<Record<ViewAngle, Shot>>>({});
  const [sounds, setSounds] = useState<Partial<Record<SoundSituation, Sound>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [upload, setUpload] = useState<{ sent: number; bytes: number } | null>(null);

  // Search as the user types, but wait until they pause (one request instead of one per key)
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(draft.trim()), 300);
    return () => window.clearTimeout(t);
  }, [draft]);
  const options = useApi<VehicleOption[]>('/inspections/vehicle-options', { search });

  // Opened from "Start inspection" (Bay monitor or job list): choose that job straight away
  const [params] = useSearchParams();
  const wanted = Number(params.get('job')) || null;
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !wanted || !options.data) return;
    const match = options.data.find((o) => o.jobId === wanted);
    if (match) setJob(match);
    preselected.current = true;
  }, [wanted, options.data]);

  // Previews are object URLs: free them when the page closes (replaced or removed ones are freed straight away)
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => () => Object.values(shotsRef.current).forEach((s) => s && URL.revokeObjectURL(s.preview)), []);
  const soundsRef = useRef(sounds);
  useEffect(() => {
    soundsRef.current = sounds;
  }, [sounds]);
  useEffect(() => () => Object.values(soundsRef.current).forEach((s) => s && URL.revokeObjectURL(s.url)), []);

  const taken = SLOTS.filter((a) => shots[a]);
  const full = taken.length >= limits.maxImagesPerInspection;
  const busy = upload !== null;

  function pick(angle: ViewAngle) {
    target.current = angle;
    fileInput.current?.click();
  }

  function setShot(angle: ViewAngle, shot: Shot | undefined) {
    setShots((all) => {
      const old = all[angle];
      if (old && old.preview !== shot?.preview) URL.revokeObjectURL(old.preview);
      return { ...all, [angle]: shot };
    });
  }

  function setSound(situation: SoundSituation, sound: Sound | undefined) {
    setSounds((all) => {
      const old = all[situation];
      if (old && old.url !== sound?.url) URL.revokeObjectURL(old.url);
      return { ...all, [situation]: sound };
    });
  }
  const recorded = (Object.keys(sounds) as SoundSituation[]).filter((s) => sounds[s]);

  function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = ''; // so the same file can be chosen again
    if (!file) return;
    setProblem(null);
    if (!limits.allowedTypes.includes(file.type)) return setProblem(`${file.name} is not a JPEG, PNG or WebP photo.`);
    if (file.size > limits.maxImageMb * 1024 * 1024) return setProblem(`${file.name} is larger than ${limits.maxImageMb} MB.`);
    const angle = target.current;
    const shot: Shot = { file, preview: URL.createObjectURL(file), check: 'checking' };
    setShot(angle, shot);
    checkPhoto(file)
      .then((check) => setShots((all) => (all[angle]?.file === file ? { ...all, [angle]: { ...shot, check } } : all)))
      .catch(() => setShots((all) => (all[angle]?.file === file ? { ...all, [angle]: { ...shot, check: 'failed' } } : all)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!job || taken.length === 0) return;
    setError(null);
    const form = new FormData();
    form.append('jobId', String(job.jobId));
    for (const angle of taken) {
      form.append('images', shots[angle]!.file);
      form.append('viewAngles', angle);
    }
    for (const situation of recorded) {
      form.append('sounds', sounds[situation]!.file);
      form.append('soundSituations', situation);
    }
    const bytes = taken.reduce((s, a) => s + shots[a]!.file.size, 0) + recorded.reduce((s, k) => s + sounds[k]!.file.size, 0);
    setUpload({ sent: 0, bytes });
    try {
      const created = await apiUpload<InspectionDetail>('/inspections', form, (sent) => setUpload({ sent, bytes }));
      const found = created.images.flatMap((im) => im.detections).length;
      const heard = created.sounds.length;
      navigate(`/inspections/${created.inspectionId}`, {
        state: {
          toast: `Inspection ${created.inspectionNo} created: ${found} ${found === 1 ? 'region' : 'regions'}${heard ? ` and ${heard} sound ${heard === 1 ? 'result' : 'results'}` : ''} to check`,
        },
      });
    } catch (err) {
      setError(err);
      setUpload(null);
    }
  }

  const fields = fieldErrors(error);
  const warned = taken.filter((a) => {
    const c = shots[a]!.check;
    return typeof c === 'object' && c.warnings.length > 0;
  }).length;

  return (
    <>
      <PageHeader title="New inspection" subtitle="Photograph the damaged sides of the vehicle; the damage model marks the damage for a technician to check." />
      <div className="app-content">
        <div className="container-fluid">
          <form onSubmit={submit} noValidate>
            {error instanceof ApiError && <Alert>{error.message}</Alert>}

            <Card className="mb-3" icon="bi-car-front" title="1. Vehicle" subtitle="Choose the vehicle's open job.">
              <div className="as-card-body">
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
              </div>
            </Card>

            <Card
              className="mb-3"
              icon="bi-camera"
              title="2. Photos"
              subtitle={`Photograph each side that shows damage, up to ${limits.maxImagesPerInspection} photos. Stand 2–3 m back so the whole side is in the frame, in good light.`}
              actions={<span className="small text-body-secondary as-num">{taken.length} of {limits.maxImagesPerInspection}</span>}
            >
              <div className="as-card-body">
              {problem && <Alert tone="warning">{problem}</Alert>}
              {fields.images && <Alert>{fields.images}</Alert>}
              <input
                ref={fileInput}
                type="file"
                className="visually-hidden"
                accept={limits.allowedTypes.join(',')}
                capture="environment"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <div className="as-dmg-slots">
                {SLOTS.map((angle) => {
                  const shot = shots[angle];
                  return shot ? (
                    <FilledSlot
                      key={angle}
                      angle={angle}
                      shot={shot}
                      disabled={busy}
                      onReplace={() => pick(angle)}
                      onRemove={() => setShot(angle, undefined)}
                    />
                  ) : (
                    <button
                      key={angle}
                      type="button"
                      className="as-dmg-slot"
                      disabled={busy || full}
                      title={full ? `Up to ${limits.maxImagesPerInspection} photos` : undefined}
                      onClick={() => pick(angle)}
                    >
                      <VehicleSide angle={angle} />
                      <b>{VIEW_ANGLES[angle]}</b>
                      <span>{full ? 'Photo limit reached' : 'Take or choose a photo'}</span>
                    </button>
                  );
                })}
              </div>
              <p className="small text-body-secondary mt-3 mb-0">
                <i className="bi bi-info-circle me-1" aria-hidden="true" />
                {warned > 0
                  ? `${warned === 1 ? 'One photo is' : `${warned} photos are`} unclear and may give less reliable results. Retake if you can; you can still analyse.`
                  : 'Each photo is checked for sharpness and light as you add it. The damage itself is assessed when you analyse.'}
              </p>
              </div>
            </Card>

            <SoundCapture sounds={sounds} onChange={setSound} disabled={busy} />
            {fields.sounds && <Alert>{fields.sounds}</Alert>}

            {upload ? (
              <UploadProgress sent={upload.sent} bytes={upload.bytes} photos={taken.length} sounds={recorded.length} />
            ) : (
              <div className="d-flex align-items-center gap-3 mb-4">
                <button type="submit" className="btn btn-primary" disabled={!job || taken.length === 0}>
                  <i className="bi bi-magic me-1" aria-hidden="true" />
                  Analyse {taken.length > 1 ? `${taken.length} photos` : 'photo'}
                  {recorded.length > 0 && ` + ${recorded.length} ${recorded.length === 1 ? 'recording' : 'recordings'}`}
                </button>
                <span className="small text-body-secondary">
                  {!job ? 'Choose the vehicle first.' : taken.length === 0 ? 'Add at least one photo.' : 'The result opens for review.'}
                </span>
              </div>
            )}
          </form>
        </div>
      </div>
    </>
  );
}

function FilledSlot({ angle, shot, disabled, onReplace, onRemove }: {
  angle: ViewAngle;
  shot: Shot;
  disabled: boolean;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const check = shot.check;
  return (
    <div className="as-dmg-shot">
      <img src={shot.preview} alt={`${VIEW_ANGLES[angle]} photo`} />
      <div className="as-dmg-shot-body">
        <div className="d-flex justify-content-between align-items-center gap-2">
          <b className="small">{VIEW_ANGLES[angle]}</b>
          {check === 'checking' ? (
            <span className="small text-body-secondary"><span className="spinner-border spinner-border-sm me-1" aria-hidden="true" />Checking photo</span>
          ) : check === 'failed' ? (
            <StatusPill tone="muted">Photo not checked</StatusPill>
          ) : check.warnings.length ? (
            <StatusPill tone="warning">Photo: {check.warnings.join(' · ').toLowerCase()}</StatusPill>
          ) : (
            <StatusPill tone="success">Clear photo</StatusPill>
          )}
        </div>
        {typeof check === 'object' && (
          <div className="as-dmg-check" title="Photo quality, checked in the browser at the size the model sees (640 px). Damage is assessed after you analyse.">
            <span><i className="bi bi-camera me-1" aria-hidden="true" />Photo quality</span>
            <span>{check.width} × {check.height}</span>
            <span>Sharpness {check.blurVar}</span>
            <span>Brightness {check.brightness}</span>
          </div>
        )}
        <div className="as-dmg-shot-foot">
          <button type="button" className="btn btn-sm btn-light" disabled={disabled} onClick={onReplace}>
            <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />Retake
          </button>
          <button type="button" className="btn btn-sm btn-light" aria-label={`Remove the ${VIEW_ANGLES[angle]} photo`} disabled={disabled} onClick={onRemove}>
            <i className="bi bi-trash" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Real upload progress (bytes sent), then an honest "analysing" state while the server runs the model. */
function UploadProgress({ sent, bytes, photos, sounds }: { sent: number; bytes: number; photos: number; sounds: number }) {
  const uploading = sent < 1;
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  return (
    <section className="as-card as-dmg-progress mb-4" aria-live="polite">
      <div className="d-flex justify-content-between align-items-baseline flex-wrap gap-2">
        <b>
          {uploading ? (
            `Uploading ${photos === 1 ? 'the photo' : `${photos} photos`}${sounds ? ` and ${sounds === 1 ? 'the recording' : `${sounds} recordings`}` : ''}`
          ) : (
            <><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Analysing on the server</>
          )}
        </b>
        <span className="small text-body-secondary as-num">
          {uploading ? `${mb(sent * bytes)} of ${mb(bytes)} MB · ${Math.round(sent * 100)}%` : `Finding the vehicle and the damage; about a second per photo${sounds ? ' and per recording' : ''}`}
        </span>
      </div>
      <div className={`as-dmg-bar${uploading ? '' : ' working'}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sent * 100)}>
        <i style={{ width: `${Math.round(sent * 100)}%` }} />
      </div>
    </section>
  );
}

function JobLine({ o }: { o: VehicleOption }) {
  const stage = STAGES[o.stage as JobStage];
  return (
    <span className="as-veh">
      <b>{o.registrationNo}</b>
      <small>
        {o.bay && <>{o.bay} · </>}{o.vehicle} · <span className="as-mono">{o.jobNo}</span>
        {o.customer && ` · ${o.customer}`} · in {formatDate(o.checkedInAt)} {formatTime(o.checkedInAt)}
        {o.inspectionCount > 0 && ` · ${o.inspectionCount} inspection${o.inspectionCount === 1 ? '' : 's'} already`}
      </small>
      {stage && <span className="ms-2"><StatusPill tone={stage.tone}>{stage.label}</StatusPill></span>}
    </span>
  );
}
