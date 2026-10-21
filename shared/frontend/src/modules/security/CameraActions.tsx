import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiSend } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { SecurityCamera, VideoAnalysis } from './security.types';
import { formatSeconds, megabytes, VIDEO_STATUS } from './security.ui';

/** Disconnect (offline) or Connect (online) a premises camera. Its recordings and alerts are kept. */
export function ConnectionButton({ camera, onChanged }: { camera: SecurityCamera; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const online = camera.status === 'online';
  async function toggle() {
    setBusy(true);
    try {
      await apiSend('POST', `/security/cameras/${camera.cameraId}/connection`, { connected: !online });
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      className="btn btn-link btn-sm p-0"
      onClick={toggle}
      disabled={busy}
      title={online ? `Stop using ${camera.name}: shown offline, its screen stops` : `Use ${camera.name} again`}
    >
      <i className={`bi ${online ? 'bi-plug' : 'bi-plug-fill'} me-1`} aria-hidden="true" />
      {busy ? '…' : online ? 'Disconnect' : 'Connect'}
    </button>
  );
}

/** One camera's uploaded recordings, with Delete (the recording, its snapshots and the alerts found in it). */
export function RecordingsDialog({
  camera,
  onClose,
  onChanged,
}: {
  camera: SecurityCamera;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data, error, loading, reload } = useApi<VideoAnalysis[]>(`/security/cameras/${camera.cameraId}/recordings`);
  const [confirming, setConfirming] = useState<VideoAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function remove(v: VideoAnalysis) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await apiSend<{ alertsRemoved: number }>('DELETE', `/security/videos/${v.videoAnalysisId}`);
      setDone(
        `${v.fileName} was deleted${r.alertsRemoved ? `, with its ${r.alertsRemoved} ${r.alertsRemoved === 1 ? 'alert' : 'alerts'}` : ''}.`,
      );
      setConfirming(null);
      reload();
      onChanged();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'The recording could not be deleted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={confirming ? 'Delete this recording?' : `Recordings · ${camera.name} (${camera.code})`}
      size="lg"
      onClose={busy ? () => undefined : onClose}
      footer={
        confirming ? (
          <>
            <button type="button" className="btn btn-light" onClick={() => setConfirming(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={() => remove(confirming)} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete recording'}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-light" onClick={onClose}>
            Close
          </button>
        )
      }
    >
      {problem && <Alert>{problem}</Alert>}
      {done && !confirming && <Alert tone="success">{done}</Alert>}
      {confirming ? (
        <p className="small mb-0">
          <b>{confirming.fileName}</b> will be deleted with its annotated video, snapshots and the{' '}
          {confirming.alertCount === 1 ? 'alert' : `${confirming.alertCount} alerts`} the model found in it. This can't
          be undone. The camera then shows its previous recording, if it has one.
        </p>
      ) : error && !data ? (
        <ErrorState inline error={error} onRetry={reload} title="Recordings couldn't be loaded" />
      ) : loading || !data ? (
        <>
          <Skeleton width="70%" />
          <div className="mt-2">
            <Skeleton width="50%" />
          </div>
        </>
      ) : data.length === 0 ? (
        <EmptyState icon="bi-film" title="No recordings for this camera">
          Analyse a recording to see it on this camera's screen.
        </EmptyState>
      ) : (
        <div className="table-responsive">
          <table className="table as-table mb-0">
            <thead>
              <tr>
                <th>Recording</th>
                <th className="text-end">Length</th>
                <th>Status</th>
                <th className="text-end">Alerts</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((v, i) => (
                <tr key={v.videoAnalysisId}>
                  <td className="as-veh">
                    <Link to={`/safety/videos/${v.videoAnalysisId}`}>
                      <b>{v.fileName}</b>
                    </Link>
                    <small className="as-num">
                      {formatDate(v.createdAt)} {formatTime(v.createdAt)} · {megabytes(v.fileSize)}
                      {i === 0 && v.status === 'done' && ' · on the wall now'}
                    </small>
                  </td>
                  <td className="text-end as-num small">
                    {v.summary?.video_s != null ? formatSeconds(Math.round(v.summary.video_s)) : '—'}
                  </td>
                  <td>
                    <StatusPill tone={VIDEO_STATUS[v.status].tone}>{VIDEO_STATUS[v.status].label}</StatusPill>
                  </td>
                  <td className="text-end as-num">{v.status === 'done' ? v.alertCount : '—'}</td>
                  <td className="text-end">
                    <button
                      type="button"
                      className="btn btn-sm btn-light"
                      disabled={v.status === 'running'}
                      title={v.status === 'running' ? 'Wait until the analysis has finished' : undefined}
                      onClick={() => {
                        setDone(null);
                        setConfirming(v);
                      }}
                    >
                      <i className="bi bi-trash me-1" aria-hidden="true" />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
