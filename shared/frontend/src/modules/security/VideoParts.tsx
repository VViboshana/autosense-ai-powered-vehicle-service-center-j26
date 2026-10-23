import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiUpload, fieldErrors } from '@/lib/api';
import type { ApiState } from '@/lib/useApi';
import type { SecurityCamera, SecurityService, ThreatType, VideoAnalysis } from './security.types';
import { formatSeconds, megabytes, THREAT } from './security.ui';

const ACCEPT = 'video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm,.mp4,.mov,.avi,.mkv,.webm';
const MAX_MB = 500;

/** "Security service: running / not running", so staff know before uploading whether the model can analyse. */
export function ServiceStatus({ service }: { service: ApiState<SecurityService> }) {
  if (!service.data) return null;
  const s = service.data;
  if (!s.online) return <StatusPill tone="danger">Security service not running</StatusPill>;
  if (!s.modelFound) return <StatusPill tone="warning">Model file missing</StatusPill>;
  return <StatusPill tone="success">Security service running{s.runningJobs > 0 ? ` · ${s.runningJobs} analysing` : ''}</StatusPill>;
}

/** Reads a clip's length in the browser (no upload), to show it and catch files that are not playable video. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    v.src = url;
  });
}

/**
 * Upload a clip for the security service, which runs the trained model, tracking and the rule engine on it.
 * - premises: a recording from one security camera; its alerts go to the Alerts list like live ones, and it plays
 *   on that camera's Live wall screen. Opens the analysis page.
 * - synthetic: an AI-generated or staged test clip for the Model demo; it belongs to no camera and its alerts stay out
 *   of the Alerts list. Says which threat the clip shows, so the demo can check the model found it.
 */
export function VideoUploadDialog({ mode, cameras, initialCameraId, serviceOnline, onClose, onStarted }: {
  mode: 'premises' | 'synthetic';
  cameras: SecurityCamera[];
  initialCameraId?: number;
  serviceOnline: boolean;
  onClose: () => void;
  /** Synthetic: called when the analysis has started (the demo wall shows its progress) */
  onStarted?: () => void;
}) {
  const navigate = useNavigate();
  const synthetic = mode === 'synthetic';
  const [title, setTitle] = useState('');
  const [expected, setExpected] = useState<ThreatType | ''>('');
  const [cameraId, setCameraId] = useState(String(initialCameraId ?? cameras[0]?.cameraId ?? ''));
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [startTime, setStartTime] = useState('');
  const [shortTimings, setShortTimings] = useState(true);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);

  async function choose(f: File | null) {
    setFile(f);
    setDuration(null);
    setFileProblem(null);
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setFileProblem(`This video is ${megabytes(f.size)}. Use a clip of ${MAX_MB} MB or less.`);
      return;
    }
    setDuration(await readDuration(f));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setFileProblem('Choose a video.');
      return;
    }
    setError(null);
    setSent(0);
    const form = new FormData();
    form.append('synthetic', String(synthetic));
    if (synthetic) {
      form.append('title', title.trim());
      form.append('expectedThreat', expected);
    } else {
      form.append('cameraId', cameraId);
    }
    form.append('startTime', startTime);
    form.append('shortTimings', String(shortTimings));
    form.append('video', file); // last, so the fields above are read before the file arrives
    try {
      const created = await apiUpload<VideoAnalysis>('/security/videos', form, setSent);
      if (synthetic && onStarted) onStarted();
      else navigate(`/safety/videos/${created.videoAnalysisId}`);
    } catch (err) {
      setError(err);
      setSent(null);
    }
  }

  const fields = fieldErrors(error);
  const uploading = sent !== null;
  return (
    <Modal
      title={synthetic ? 'Add a synthetic test video' : 'Analyse a camera recording'}
      onClose={uploading ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={uploading}>Cancel</button>
          <button type="submit" form="video-form" className="btn btn-primary"
            disabled={uploading || !file || !!fileProblem || !serviceOnline || (synthetic && !title.trim())}>
            <i className="bi bi-play-circle me-1" aria-hidden="true" />
            {uploading ? (sent! < 1 ? `Uploading ${Math.round(sent! * 100)}%` : 'Starting…') : 'Analyse video'}
          </button>
        </>
      }
    >
      {!serviceOnline && (
        <Alert tone="warning">
          The security service is not running, so the video can't be analysed. Start it in
          <code className="mx-1">member-4-anomaly-detection/service</code>with
          <code className="ms-1">uvicorn c4security.service:app --port 8004</code>.
        </Alert>
      )}
      {error instanceof ApiError && !fields.video && !fields.cameraId && !fields.title && <Alert>{error.message}</Alert>}
      {synthetic && (
        <p className="small text-body-secondary">
          For AI-generated or staged clips that show how the model works. The clip is analysed like a camera recording, but its
          alerts are test results: they stay on the Model demo and never reach the Alerts list.
        </p>
      )}
      <form id="video-form" onSubmit={submit} noValidate>
        {synthetic ? (
          <>
            <div className="mb-3">
              <label className="form-label" htmlFor="video-title">Name</label>
              <input id="video-title" className={`form-control${fields.title ? ' is-invalid' : ''}`} maxLength={120} value={title}
                onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Staged tampering at a car door" disabled={uploading} />
              {fields.title && <div className="invalid-feedback">{fields.title}</div>}
            </div>
            <div className="mb-3">
              <label className="form-label" htmlFor="video-expected">Which threat does this clip show?</label>
              <select id="video-expected" className="form-select" value={expected} onChange={(e) => setExpected(e.target.value as ThreatType | '')} disabled={uploading}>
                <option value="">Not sure / none (just see what the model finds)</option>
                {(['fire', 'smoke', 'weapon', 'tampering', 'unauthorised_access', 'loitering'] as ThreatType[]).map((t) => (
                  <option key={t} value={t}>{THREAT[t].label}</option>
                ))}
              </select>
              <div className="form-text">The demo then shows whether the model detected it. Unauthorised access needs camera zones, so test it with a camera recording.</div>
            </div>
          </>
        ) : (
        <div className="mb-3">
          <label className="form-label" htmlFor="video-camera">Camera</label>
          <select id="video-camera" className={`form-select${fields.cameraId ? ' is-invalid' : ''}`} value={cameraId}
            onChange={(e) => setCameraId(e.target.value)} disabled={uploading}>
            {cameras.map((c) => (
              <option key={c.cameraId} value={c.cameraId}>{c.name} ({c.code}){c.zone ? ` · ${c.zone.name}` : ''}</option>
            ))}
          </select>
          {fields.cameraId ? <div className="invalid-feedback">{fields.cameraId}</div> : (
            <div className="form-text">The camera the clip was recorded on. Its alerts are filed under this camera and its zone.</div>
          )}
        </div>
        )}

        <div className="mb-3">
          <label className="form-label" htmlFor="video-file">Video</label>
          <input id="video-file" type="file" accept={ACCEPT} className={`form-control${fileProblem || fields.video ? ' is-invalid' : ''}`}
            onChange={(e) => choose(e.target.files?.[0] ?? null)} disabled={uploading} />
          {fileProblem || fields.video ? (
            <div className="invalid-feedback">{fileProblem ?? fields.video}</div>
          ) : file ? (
            <div className="form-text">{file.name} · {megabytes(file.size)}{duration ? ` · ${formatSeconds(Math.round(duration))}` : ''}</div>
          ) : (
            <div className="form-text">MP4, MOV, AVI, MKV or WebM, up to {MAX_MB} MB. Short clips (under 2 minutes) are analysed fastest.</div>
          )}
        </div>

        <div className="mb-3">
          <label className="form-label" htmlFor="video-start">Clock time of the first frame (optional)</label>
          <input id="video-start" type="time" className={`form-control${fields.startTime ? ' is-invalid' : ''}`} style={{ maxWidth: '10rem' }}
            value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={uploading} />
          {fields.startTime ? <div className="invalid-feedback">{fields.startTime}</div> : (
            <div className="form-text">Lets the after-hours rule work (19:00 to 07:00 raises the severity). Leave empty if unknown.</div>
          )}
        </div>

        <div className="form-check">
          <input id="video-short" className="form-check-input" type="checkbox" checked={shortTimings}
            onChange={(e) => setShortTimings(e.target.checked)} disabled={uploading} />
          <label className="form-check-label" htmlFor="video-short">
            Short clip: shorter rule times
            <div className="small text-body-secondary">Loitering after 20 s instead of 2 min, touching a vehicle after 3 s instead of 10 s.</div>
          </label>
        </div>

        {uploading && (
          <div className="progress mt-3" role="progressbar" aria-label="Upload" aria-valuenow={Math.round(sent! * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar" style={{ width: `${Math.round(sent! * 100)}%` }} />
          </div>
        )}
      </form>
    </Modal>
  );
}
