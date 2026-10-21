import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiUpload, fieldErrors } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import type { ApiState } from '@/lib/useApi';
import type { SecurityCamera, SecurityService, VideoAnalysis } from './security.types';
import { formatSeconds, megabytes, VIDEO_STATUS } from './security.ui';

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
 * Upload a recorded clip for one security camera. The security service runs the trained model, tracking and the
 * rule engine on it; the alerts it finds go to the Alerts list like live ones.
 */
export function VideoUploadDialog({ cameras, initialCameraId, serviceOnline, onClose }: {
  cameras: SecurityCamera[];
  initialCameraId?: number;
  serviceOnline: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
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
    form.append('cameraId', cameraId);
    form.append('startTime', startTime);
    form.append('shortTimings', String(shortTimings));
    form.append('video', file); // last, so the fields above are read before the file arrives
    try {
      const created = await apiUpload<VideoAnalysis>('/security/videos', form, setSent);
      navigate(`/safety/videos/${created.videoAnalysisId}`);
    } catch (err) {
      setError(err);
      setSent(null);
    }
  }

  const fields = fieldErrors(error);
  const uploading = sent !== null;
  return (
    <Modal
      title="Analyse a recorded video"
      onClose={uploading ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={uploading}>Cancel</button>
          <button type="submit" form="video-form" className="btn btn-primary" disabled={uploading || !file || !!fileProblem || !serviceOnline}>
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
      {error instanceof ApiError && !fields.video && !fields.cameraId && <Alert>{error.message}</Alert>}
      <form id="video-form" onSubmit={submit} noValidate>
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

/** The latest recorded video analyses, newest first. */
export function RecentVideos({ videos, onUpload, canUpload }: { videos: ApiState<VideoAnalysis[]>; onUpload: () => void; canUpload: boolean }) {
  const { data, error, loading, reload } = videos;
  return (
    <Card icon="bi-film" title="Recorded video analysis" subtitle="Clips analysed by the trained model, newest first"
      actions={canUpload && <button type="button" className="btn btn-sm btn-primary" onClick={onUpload}><i className="bi bi-upload me-1" aria-hidden="true" />Analyse a video</button>}>
      {error && !data ? (
        <ErrorState inline error={error} onRetry={reload} title="Video analyses couldn't be loaded" />
      ) : loading || !data ? (
        <div className="as-sec-body"><Skeleton width="60%" /><div className="mt-2"><Skeleton width="40%" /></div></div>
      ) : data.length === 0 ? (
        <EmptyState icon="bi-film" title="No videos analysed yet" action={canUpload && <button type="button" className="btn btn-sm btn-primary" onClick={onUpload}>Analyse a video</button>}>
          Upload a recorded clip to see what the model detects and which alerts it raises.
        </EmptyState>
      ) : (
        <div className="table-responsive">
          <table className="table as-table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Camera</th>
                <th className="text-end">Length</th>
                <th>Status</th>
                <th className="text-end">Alerts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.videoAnalysisId}>
                  <td className="as-veh">
                    <Link to={`/safety/videos/${v.videoAnalysisId}`}><b>{v.fileName}</b></Link>
                    <small className="as-num">{formatDate(v.createdAt)} {formatTime(v.createdAt)}{v.createdBy && ` · ${v.createdBy}`}</small>
                  </td>
                  <td className="small">{v.camera.name}<div className="text-body-secondary as-mono">{v.camera.code}</div></td>
                  <td className="text-end as-num small">{v.summary?.video_s != null ? formatSeconds(Math.round(v.summary.video_s)) : '—'}</td>
                  <td><StatusPill tone={VIDEO_STATUS[v.status].tone}>{VIDEO_STATUS[v.status].label}</StatusPill></td>
                  <td className="text-end as-num">{v.status === 'done' ? v.alertCount : '—'}</td>
                  <td className="text-end"><Link to={`/safety/videos/${v.videoAnalysisId}`} aria-label={`Open ${v.fileName}`}><i className="bi bi-chevron-right text-body-secondary" aria-hidden="true" /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
