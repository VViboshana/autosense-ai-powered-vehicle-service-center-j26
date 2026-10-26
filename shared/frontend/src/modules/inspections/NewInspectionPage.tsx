import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiGet, apiUpload, fieldErrors } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import type { JobStage } from '@/modules/dashboard/dashboard.types';
import { AnalysingScreen, type LiveProgress } from './AnalysingScreen';
import type { InspectionDetail, SoundSituation, VehicleOption, ViewAngle } from './inspections.types';
import { VIEW_ANGLES } from './inspections.ui';
import { checkPhoto, type PhotoCheck } from './photoCheck';
import { SoundCapture, type Sound } from './SoundCapture';
import { VehicleSide } from './VehicleSide';
import { LiveWalkAround, VideoWalkAround } from './WalkAround';
import type { WalkResult } from './walkFrames';
import './inspections.css';

type Shot = { file: File; preview: string; check: PhotoCheck | 'checking' | 'failed' };
type CaptureMode = 'walk' | 'video' | 'slots';
type UploadLimits = { maxImageMb: number; maxImagesPerInspection: number; allowedTypes: string[] };

const DEFAULT_LIMITS: UploadLimits = { maxImageMb: 10, maxImagesPerInspection: 8, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] };
// One slot per side, in the order people walk round a vehicle; close-up for a detail
const SLOTS: ViewAngle[] = ['front', 'left', 'rear', 'right', 'other'];

/**
 * Inspections › New inspection (INSPECTION_CREATE), in three steps: 1 choose the vehicle's open job, 2 photograph the
 * sides that show damage (one slot per side, so the view angle is always right), 3 optionally record the vehicle
 * starting, idling or braking; then analyse. Each photo gets a quick quality check in the browser first. While the
 * damage service works, the analysing screen follows its real progress (upload, each photo, each recording).
 */
export function NewInspectionPage() {
  const { config } = useSession();
  const limits = { ...DEFAULT_LIMITS, ...(config.settings['damage.upload'] as Partial<UploadLimits> | undefined) };
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<ViewAngle>('front');

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [job, setJob] = useState<VehicleOption | null>(null);
  const [shots, setShots] = useState<Partial<Record<ViewAngle, Shot>>>({});
  // More close-ups than the one close-up slot (from a walk-around)
  const [extras, setExtras] = useState<Shot[]>([]);
  const [mode, setMode] = useState<CaptureMode>('walk');
  const [walking, setWalking] = useState(false);
  const [walkNote, setWalkNote] = useState<string | null>(null);
  const [sounds, setSounds] = useState<Partial<Record<SoundSituation, Sound>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  // The analysis under way: what was sent, how much of it is uploaded, what the server reported, its answer
  const [run, setRun] = useState<Run | null>(null);
  const [sent, setSent] = useState(0);
  const [live, setLive] = useState<LiveProgress | null>(null);
  const [result, setResult] = useState<InspectionDetail | null>(null);

  // Search as the user types, but wait until they pause (one request instead of one per key)
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(draft.trim()), 300);
    return () => window.clearTimeout(t);
  }, [draft]);
  const options = useApi<VehicleOption[]>('/inspections/vehicle-options', { search });

  // Opened from "Start inspection" (Bay monitor or job list): choose that job straight away and go on to the photos
  const [params] = useSearchParams();
  const wanted = Number(params.get('job')) || null;
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || !wanted || !options.data) return;
    const match = options.data.find((o) => o.jobId === wanted);
    preselected.current = true;
    if (!match) return;
    const raf = requestAnimationFrame(() => {
      setJob(match);
      setStep(2);
    });
    return () => cancelAnimationFrame(raf);
  }, [wanted, options.data]);

  // Previews are object URLs: free them when the page closes (replaced or removed ones are freed straight away)
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => () => Object.values(shotsRef.current).forEach((s) => s && URL.revokeObjectURL(s.preview)), []);
  const extrasRef = useRef(extras);
  useEffect(() => {
    extrasRef.current = extras;
  }, [extras]);
  useEffect(() => () => extrasRef.current.forEach((s) => URL.revokeObjectURL(s.preview)), []);
  const soundsRef = useRef(sounds);
  useEffect(() => {
    soundsRef.current = sounds;
  }, [sounds]);
  useEffect(() => () => Object.values(soundsRef.current).forEach((s) => s && URL.revokeObjectURL(s.url)), []);

  // Once uploaded, follow the analysis on the server until its answer arrives
  const analysing = run !== null && sent >= 1 && result === null;
  const progressId = run?.progressId;
  useEffect(() => {
    if (!analysing || !progressId) return;
    const controller = new AbortController();
    const t = window.setInterval(() => {
      apiGet<LiveProgress>(`/inspections/progress/${progressId}`, undefined, controller.signal).then(setLive).catch(() => {});
    }, 300);
    return () => {
      window.clearInterval(t);
      controller.abort();
    };
  }, [analysing, progressId]);

  const taken = SLOTS.filter((a) => shots[a]);
  // Every photo to send: one per side slot, then the extra close-ups (view angle 'other')
  const photos = [
    ...taken.map((angle) => ({ angle, shot: shots[angle]! })),
    ...extras.map((shot) => ({ angle: 'other' as ViewAngle, shot })),
  ];
  const full = photos.length >= limits.maxImagesPerInspection;
  const busy = run !== null;

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

  /** A new shot with its quality check (run in the background, kept only if the shot is still there). */
  function newShot(file: File, update: (fn: (s: Shot) => Shot) => void): Shot {
    const shot: Shot = { file, preview: URL.createObjectURL(file), check: 'checking' };
    checkPhoto(file)
      .then((check) => update((s) => (s.file === file ? { ...s, check } : s)))
      .catch(() => update((s) => (s.file === file ? { ...s, check: 'failed' } : s)));
    return shot;
  }
  const updateSlot = (angle: ViewAngle) => (fn: (s: Shot) => Shot) =>
    setShots((all) => (all[angle] ? { ...all, [angle]: fn(all[angle]!) } : all));
  const updateExtras = (fn: (s: Shot) => Shot) => setExtras((all) => all.map(fn));

  /** The walk-around's photos go into the slots (replacing those sides); close-ups fill the close-up slot, then extras. */
  function addWalk(r: WalkResult) {
    setWalking(false);
    const sides = Object.entries(r.sides) as [ViewAngle, File][];
    let room = limits.maxImagesPerInspection - photos.filter((p) => !(p.angle in r.sides)).length;
    const used: string[] = [];
    for (const [angle, file] of sides) {
      if (room <= 0 && !shots[angle]) break;
      setShot(angle, newShot(file, updateSlot(angle)));
      used.push(VIEW_ANGLES[angle].toLowerCase());
      if (!shots[angle]) room -= 1;
    }
    let closeups = 0;
    for (const file of r.closeups) {
      if (room <= 0) break;
      if (!shots.other && closeups === 0) setShot('other', newShot(file, updateSlot('other')));
      else setExtras((all) => [...all, newShot(file, updateExtras)]);
      closeups += 1;
      room -= 1;
    }
    setMode('slots');
    setWalkNote(
      `Walk-around added ${used.length} ${used.length === 1 ? 'side' : 'sides'}${used.length ? ` (${used.join(', ')})` : ''}` +
      `${closeups ? ` and ${closeups} close-up${closeups === 1 ? '' : 's'}` : ''}. Check them, retake any that look wrong, then go on.`,
    );
  }

  function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = ''; // so the same file can be chosen again
    if (!file) return;
    setProblem(null);
    if (!limits.allowedTypes.includes(file.type)) return setProblem(`${file.name} is not a JPEG, PNG or WebP photo.`);
    if (file.size > limits.maxImageMb * 1024 * 1024) return setProblem(`${file.name} is larger than ${limits.maxImageMb} MB.`);
    const angle = target.current;
    setShot(angle, newShot(file, updateSlot(angle)));
  }

  /** Uploads the photos (and, from step 3, the recordings), then shows the analysis as the server reports it. */
  async function analyse(withSound: boolean) {
    if (!job || photos.length === 0) return;
    setError(null);
    const situations = withSound ? recorded : [];
    const id = newProgressId();
    const form = new FormData();
    form.append('jobId', String(job.jobId));
    form.append('progressId', id);
    for (const p of photos) {
      form.append('images', p.shot.file);
      form.append('viewAngles', p.angle);
    }
    for (const situation of situations) {
      form.append('sounds', sounds[situation]!.file);
      form.append('soundSituations', situation);
    }
    setRun({
      progressId: id,
      bytes: photos.reduce((s, p) => s + p.shot.file.size, 0) + situations.reduce((s, k) => s + sounds[k]!.file.size, 0),
      photos: photos.map((p) => ({ angle: p.angle, preview: p.shot.preview })),
      sounds: situations.map((situation) => ({ situation, file: sounds[situation]!.file })),
    });
    setSent(0);
    setLive(null);
    setResult(null);
    try {
      setResult(await apiUpload<InspectionDetail>('/inspections', form, setSent));
    } catch (err) {
      setError(err);
      setRun(null);
      // Back to the step the problem is in
      const f = fieldErrors(err);
      if (f.vehicleId || f.jobId) setStep(1);
      else if (f.images || f.viewAngles) setStep(2);
      else if (f.sounds) setStep(3);
    }
  }

  function openResult() {
    if (!result) return;
    const found = result.images.flatMap((im) => im.detections).length;
    const heard = result.sounds.length;
    navigate(`/inspections/${result.inspectionId}`, {
      state: {
        toast: `Inspection ${result.inspectionNo} created: ${found} ${found === 1 ? 'region' : 'regions'}${heard ? ` and ${heard} sound ${heard === 1 ? 'result' : 'results'}` : ''} to check`,
      },
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault(); // Enter in the search box must not analyse; only the Analyse button does
  }

  const fields = fieldErrors(error);
  const warned = photos.filter((p) => typeof p.shot.check === 'object' && p.shot.check.warnings.length > 0).length;
  const reachable = (s: 1 | 2 | 3) => s === 1 || (s === 2 && !!job) || (s === 3 && !!job && photos.length > 0);
  const analyseLabel = (withSound: boolean) =>
    `Analyse ${photos.length > 1 ? `${photos.length} photos` : 'photo'}${withSound && recorded.length > 0 ? ` + ${recorded.length} ${recorded.length === 1 ? 'recording' : 'recordings'}` : ''}`;

  return (
    <>
      <PageHeader title="New inspection" subtitle="Photograph the damaged sides and, if you can, record the engine; the AI marks the damage and names the sounds for a technician to check." />
      <div className="app-content">
        <div className="container-fluid">
          {error instanceof ApiError && <Alert>{error.message}</Alert>}

          {run ? (
            <AnalysingScreen
              photos={run.photos}
              sounds={run.sounds}
              upload={{ sent, bytes: run.bytes }}
              live={live}
              result={result}
              onFinished={openResult}
            />
          ) : (
          <form onSubmit={submit} noValidate>
            <ol className="as-wiz" aria-label="Steps">
              {([
                [1, 'Vehicle', job ? job.registrationNo : 'Choose the open job'],
                [2, 'Photos', photos.length ? `${photos.length} of ${limits.maxImagesPerInspection} taken` : 'Walk round or photograph'],
                [3, 'Sound', recorded.length ? `${recorded.length} ${recorded.length === 1 ? 'recording' : 'recordings'}` : 'Optional'],
              ] as const).map(([n, title, note]) => {
                const done = n < step || (n === 1 && !!job && step > 1);
                return (
                  <li key={n}>
                    <button
                      type="button"
                      className={`${step === n ? 'on' : ''}${done ? ' done' : ''}`}
                      aria-current={step === n ? 'step' : undefined}
                      disabled={!reachable(n)}
                      onClick={() => setStep(n)}
                    >
                      <span className="as-wiz-n">{done ? <i className="bi bi-check-lg" aria-hidden="true" /> : n}</span>
                      <span className="as-wiz-text"><b>{title}</b><small>{note}</small></span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {step === 1 && (
            <Card className="mb-3" icon="bi-car-front" title="1. Vehicle" subtitle="Choose the vehicle's open job.">
              <div className="as-card-body">
              {job ? (
                <div className="as-dmg-job" aria-pressed="true">
                  <i className="bi bi-check-circle-fill text-success" aria-hidden="true" />
                  <JobLine o={job} />
                  <button type="button" className="btn btn-sm btn-light" onClick={() => setJob(null)}>Change</button>
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
                        <button
                          key={o.jobId}
                          type="button"
                          className="as-dmg-job"
                          aria-pressed="false"
                          onClick={() => {
                            setJob(o);
                            setStep(2);
                          }}
                        >
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
            )}

            {step === 2 && (
            <Card
              className="mb-3"
              icon="bi-camera"
              title="2. Photos"
              subtitle={`Walk round the vehicle with the camera, upload a walk-around video, or photograph each side (up to ${limits.maxImagesPerInspection} photos). Stand 2–3 m back, in good light.`}
              actions={<span className="small text-body-secondary as-num">{photos.length} of {limits.maxImagesPerInspection}</span>}
            >
              <div className="as-card-body">
              <div className="as-capture-modes" role="tablist" aria-label="How to capture the photos">
                {([
                  ['walk', 'bi-person-walking', 'Walk-around', 'Live camera, AI picks the shots'],
                  ['video', 'bi-film', 'Upload video', 'A walk-around filmed earlier'],
                  ['slots', 'bi-images', 'Photo slots', `One photo per side${photos.length ? ` · ${photos.length} added` : ''}`],
                ] as const).map(([key, icon, title, note]) => (
                  <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? 'on' : ''} onClick={() => setMode(key)}>
                    <i className={`bi ${icon}`} aria-hidden="true" />
                    <span><b>{title}</b><small>{note}</small></span>
                  </button>
                ))}
              </div>

              {mode === 'walk' && (
                <div className="as-walk-intro">
                  <WalkIllustration />
                  <div>
                    <b>Live walk-around</b>
                    <ol>
                      <li>Stand 2–3 m in front of the vehicle and press <b>Start</b>.</li>
                      <li>Walk round it: front, left side, rear, right side. Each side is captured by itself when it is sharp and fills the screen.</li>
                      <li>The AI marks damage live; clear damage is kept as close-ups. Press <b>Finish</b>.</li>
                    </ol>
                    {!window.isSecureContext && (
                      <p className="small text-warning">
                        <i className="bi bi-shield-lock me-1" aria-hidden="true" />The camera needs https: on the laptop run <code>npm run dev:phone</code> and open the https address on the phone.
                      </p>
                    )}
                    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setWalking(true)}>
                      <i className="bi bi-camera-video me-1" aria-hidden="true" />Start walk-around
                    </button>
                  </div>
                </div>
              )}
              {mode === 'video' && <VideoWalkAround onDone={addWalk} />}

              {mode === 'slots' && <>
              {walkNote && <Alert tone="success">{walkNote}</Alert>}
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
                {extras.map((shot, i) => (
                  <FilledSlot
                    key={shot.preview}
                    angle="other"
                    title={`Close-up ${i + 2}`}
                    shot={shot}
                    disabled={busy}
                    onRemove={() => {
                      URL.revokeObjectURL(shot.preview);
                      setExtras((all) => all.filter((s) => s !== shot));
                    }}
                  />
                ))}
              </div>
              <p className="small text-body-secondary mt-3 mb-0">
                <i className="bi bi-info-circle me-1" aria-hidden="true" />
                {warned > 0
                  ? `${warned === 1 ? 'One photo is' : `${warned} photos are`} unclear and may give less reliable results. Retake if you can; you can still analyse.`
                  : 'Each photo is checked for sharpness and light as you add it. The damage itself is assessed when you analyse.'}
              </p>
              </>}
              </div>
            </Card>
            )}

            {step === 3 && (
              <>
                <SoundCapture sounds={sounds} onChange={setSound} disabled={busy} />
                {fields.sounds && <Alert>{fields.sounds}</Alert>}
              </>
            )}

            <div className="as-wiz-foot">
              {step > 1 && (
                <button type="button" className="btn btn-light" onClick={() => setStep((step - 1) as 1 | 2)}>
                  <i className="bi bi-arrow-left me-1" aria-hidden="true" />Back
                </button>
              )}
              <span className="small text-body-secondary me-auto">
                {step === 1
                  ? job ? 'Vehicle chosen.' : 'Choose the vehicle first.'
                  : step === 2
                    ? photos.length === 0 ? 'Add at least one photo.' : 'Next: record the engine, or analyse the photos only.'
                    : recorded.length === 0 ? 'No recordings: only the photos will be analysed.' : 'The results open for review.'}
              </span>
              {step === 1 && (
                <button type="button" className="btn btn-primary" disabled={!job} onClick={() => setStep(2)}>
                  Next: photos<i className="bi bi-arrow-right ms-1" aria-hidden="true" />
                </button>
              )}
              {step === 2 && (
                <>
                  <button type="button" className="btn btn-light" disabled={photos.length === 0} onClick={() => void analyse(false)}>
                    <i className="bi bi-magic me-1" aria-hidden="true" />{analyseLabel(false)} only
                  </button>
                  <button type="button" className="btn btn-primary" disabled={photos.length === 0} onClick={() => setStep(3)}>
                    Next: sound<i className="bi bi-arrow-right ms-1" aria-hidden="true" />
                  </button>
                </>
              )}
              {step === 3 && (
                <button type="button" className="btn btn-primary as-wiz-go" disabled={!job || photos.length === 0} onClick={() => void analyse(true)}>
                  <i className="bi bi-magic me-1" aria-hidden="true" />{analyseLabel(true)}
                </button>
              )}
            </div>
          </form>
          )}
        </div>
      </div>
      {walking && <LiveWalkAround onDone={addWalk} onClose={() => setWalking(false)} />}
    </>
  );
}

/** Top view of a vehicle and the walk round it (front, left, rear, right). */
function WalkIllustration() {
  return (
    <svg className="as-walk-illus" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="46" className="path" />
      <rect x="44" y="30" width="32" height="60" rx="11" className="car" />
      <rect x="49" y="40" width="22" height="11" rx="3" className="glass" />
      <rect x="49" y="70" width="22" height="8" rx="3" className="glass" />
      <circle r="5" className="walker">
        <animateMotion dur="6s" repeatCount="indefinite" path="M60 14 A46 46 0 1 0 60.01 14" />
      </circle>
    </svg>
  );
}

type Run = {
  progressId: string;
  bytes: number;
  photos: { angle: ViewAngle; preview: string }[];
  sounds: { situation: SoundSituation; file: File }[];
};

/** An id for following this analysis (letters, digits and dashes, as the server expects). */
function newProgressId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function FilledSlot({ angle, title, shot, disabled, onReplace, onRemove }: {
  angle: ViewAngle;
  title?: string;
  shot: Shot;
  disabled: boolean;
  onReplace?: () => void;
  onRemove: () => void;
}) {
  const name = title ?? VIEW_ANGLES[angle];
  const check = shot.check;
  return (
    <div className="as-dmg-shot">
      <img src={shot.preview} alt={`${name} photo`} />
      <div className="as-dmg-shot-body">
        <div className="d-flex justify-content-between align-items-center gap-2">
          <b className="small">{name}</b>
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
          {onReplace && (
            <button type="button" className="btn btn-sm btn-light" disabled={disabled} onClick={onReplace}>
              <i className="bi bi-arrow-repeat me-1" aria-hidden="true" />Retake
            </button>
          )}
          <button type="button" className="btn btn-sm btn-light" aria-label={`Remove the ${name} photo`} disabled={disabled} onClick={onRemove}>
            <i className="bi bi-trash" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
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
