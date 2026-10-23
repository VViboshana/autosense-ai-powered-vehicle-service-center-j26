import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiSend } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { ReplayScreen, WallControls } from './ReplayScreen';
import type { DemoClip } from './security.types';
import { THREAT } from './security.ui';

/** Did the model find what the clip was made to show? */
function verdict(c: DemoClip) {
  if (c.status !== 'done' || !c.expectedThreat) return null;
  return c.alerts.some((a) => a.threatType === c.expectedThreat);
}

/**
 * Safety › Cameras › Model demo: synthetic test videos (AI-generated or staged clips) that show how the trained
 * model, the tracker and the rule engine work. Each clip is analysed exactly like a premises recording and replayed
 * with its alerts, next to the threat it was made to show. These are not real incidents: they belong to no camera and
 * their alerts are kept out of the Alerts list and the alert figures.
 */
export function ModelDemo({ onAdd, canUpload }: { onAdd: () => void; canUpload: boolean }) {
  const [refreshMs, setRefreshMs] = useState(30_000);
  const { data, error, loading, reload } = useApi<DemoClip[]>('/security/demo', undefined, { refreshMs });
  const videos = useRef(new Map<number, HTMLVideoElement>());
  const wall = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [removing, setRemoving] = useState<DemoClip | null>(null);

  // Follow running analyses closely; otherwise refresh now and then
  useEffect(() => {
    setRefreshMs(data?.some((c) => c.status === 'running') ? 3_000 : 30_000);
  }, [data]);
  useEffect(() => {
    const all = videos.current;
    return () => all.forEach((v) => v.pause());
  }, []);

  const judged = data?.filter((c) => verdict(c) !== null) ?? [];
  const found = judged.filter((c) => verdict(c)).length;
  const playable = data?.some((c) => c.hasVideo) ?? false;

  return (
    <Card
      icon="bi-cpu"
      title="Model demo: synthetic test videos"
      subtitle="AI-generated or staged clips that show how the model detects each threat. Not real incidents: kept out of Alerts and the alert figures."
      actions={
        <>
          {judged.length > 0 && (
            <StatusPill tone={found === judged.length ? 'success' : 'warning'}>
              Expected threat found in {found} of {judged.length}
            </StatusPill>
          )}
          {playable && <WallControls videos={videos.current} target={wall} paused={paused} setPaused={setPaused} />}
          {canUpload && (
            <button type="button" className="btn btn-sm btn-primary" onClick={onAdd}>
              <i className="bi bi-plus-lg me-1" aria-hidden="true" />Add synthetic video
            </button>
          )}
        </>
      }
    >
      {error && !data ? (
        <ErrorState inline error={error} onRetry={reload} title="The model demo couldn't be loaded" />
      ) : loading || !data ? (
        <div className="as-sec-wall">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="as-sec-screen"><div className="as-sec-screen-view"><Skeleton width="40%" /></div></div>
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon="bi-film"
          title="No synthetic test videos yet"
          action={canUpload && <button type="button" className="btn btn-sm btn-primary" onClick={onAdd}>Add synthetic video</button>}
        >
          Add an AI-generated or staged clip (for example a person forcing a car door, or smoke in a workshop) and say which
          threat it shows. The model analyses it and this wall shows whether it found that threat.
        </EmptyState>
      ) : (
        <div className="as-sec-wall" ref={wall}>
          {data.map((c) => {
            const v = verdict(c);
            return (
              <ReplayScreen
                key={c.videoAnalysisId}
                title={c.title ?? c.fileName}
                detail={c.expectedThreat ? `Shows: ${THREAT[c.expectedThreat].label}` : null}
                tag={<span className="as-sec-screen-synthetic">Synthetic</span>}
                videoAnalysisId={c.status === 'done' && c.hasVideo ? c.videoAnalysisId : null}
                alerts={c.alerts}
                paused={paused}
                register={(el) => (el ? videos.current.set(c.videoAnalysisId, el) : videos.current.delete(c.videoAnalysisId))}
                empty={
                  c.status === 'running' ? (
                    <>
                      <div className="spinner-border spinner-border-sm" role="status" aria-label="Analysing" />
                      <span>The model is analysing this clip…</span>
                    </>
                  ) : c.status === 'failed' ? (
                    <>
                      <i className="bi bi-exclamation-triangle" aria-hidden="true" />
                      <span>{c.error ?? 'The analysis failed.'}</span>
                    </>
                  ) : (
                    <>
                      <i className="bi bi-film" aria-hidden="true" />
                      <span>No annotated video was stored</span>
                    </>
                  )
                }
                footer={
                  <>
                    {v === true && <span className="as-sec-verdict ok"><i className="bi bi-check-circle-fill" aria-hidden="true" />Detected</span>}
                    {v === false && <span className="as-sec-verdict miss"><i className="bi bi-x-circle-fill" aria-hidden="true" />Not detected</span>}
                    <span>
                      {c.status === 'done'
                        ? c.alerts.length === 0 ? 'No alerts' : `${c.alerts.length} ${c.alerts.length === 1 ? 'alert' : 'alerts'}`
                        : c.status === 'running' ? 'Analysing' : 'Failed'}
                    </span>
                    <span className="ms-auto d-flex gap-3">
                      {canUpload && c.status !== 'running' && (
                        <button type="button" className="btn btn-link btn-sm p-0 as-sec-screen-btn" onClick={() => setRemoving(c)}>Remove</button>
                      )}
                      {c.status === 'done' && (
                        <Link to={`/safety/videos/${c.videoAnalysisId}`}>Details <i className="bi bi-chevron-right" aria-hidden="true" /></Link>
                      )}
                    </span>
                  </>
                }
              />
            );
          })}
        </div>
      )}

      {removing && (
        <RemoveDialog
          clip={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function RemoveDialog({ clip, onClose, onDone }: { clip: DemoClip; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    try {
      await apiSend('DELETE', `/security/videos/${clip.videoAnalysisId}`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The test video could not be removed.');
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Remove this test video?"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove'}</button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="small mb-0">
        <b>{clip.title ?? clip.fileName}</b> and its {clip.alerts.length} test {clip.alerts.length === 1 ? 'alert' : 'alerts'} will be removed.
        Premises recordings and real alerts are not affected.
      </p>
    </Modal>
  );
}
