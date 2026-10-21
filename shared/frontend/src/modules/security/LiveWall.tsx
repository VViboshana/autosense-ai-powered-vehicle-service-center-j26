import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useApi } from '@/lib/useApi';
import { ReplayScreen, WallControls } from './ReplayScreen';
import type { WallTile } from './security.types';

/**
 * Safety › Cameras › Live wall: the premises cameras side by side, like a guard's monitor wall. With no CCTV
 * connected, each screen replays that camera's latest analysed recording (the model's annotated video) on a loop,
 * and the alerts the model raised appear on the screen at the second they were found. Replays never raise new alerts.
 */
export function LiveWall({ onAnalyse, canUpload }: { onAnalyse: (cameraId: number) => void; canUpload: boolean }) {
  const { data, error, loading, reload } = useApi<WallTile[]>('/security/wall', undefined, { refreshMs: 30_000 });
  const videos = useRef(new Map<number, HTMLVideoElement>());
  const wall = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  // Leaving the page stops decoding the videos
  useEffect(() => {
    const all = videos.current;
    return () => all.forEach((v) => v.pause());
  }, []);

  const withClip = data?.filter((t) => t.clip).length ?? 0;
  return (
    <Card
      icon="bi-grid-3x2-gap"
      title="Live wall"
      subtitle={
        data
          ? `${withClip} of ${data.length} cameras showing the model's analysis · replay of recorded footage, no CCTV connected`
          : 'Premises cameras'
      }
      actions={
        withClip > 0 && <WallControls videos={videos.current} target={wall} paused={paused} setPaused={setPaused} />
      }
    >
      {error && !data ? (
        <ErrorState inline error={error} onRetry={reload} title="The live wall couldn't be loaded" />
      ) : loading || !data ? (
        <div className="as-sec-wall">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="as-sec-screen">
              <div className="as-sec-screen-view">
                <Skeleton width="40%" />
              </div>
            </div>
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon="bi-camera-video" title="No security cameras yet" />
      ) : (
        <div className="as-sec-wall" ref={wall}>
          {data.map(({ camera, clip, alerts }) => {
            // A disconnected camera shows no picture, even when it has a recording
            const offline = camera.status === 'offline';
            return (
              <ReplayScreen
                key={camera.cameraId}
                title={camera.name}
                code={camera.code}
                detail={camera.zone}
                tag={camera.status === 'offline' && <span className="as-sec-screen-off">Offline</span>}
                videoAnalysisId={offline ? null : (clip?.videoAnalysisId ?? null)}
                alerts={alerts}
                paused={paused}
                register={(el) =>
                  el ? videos.current.set(camera.cameraId, el) : videos.current.delete(camera.cameraId)
                }
                empty={
                  offline ? (
                    <>
                      <i className="bi bi-plug" aria-hidden="true" />
                      <span>Camera disconnected</span>
                      <small>Connect it in Camera health below to show its recording again</small>
                    </>
                  ) : (
                    <>
                      <i className="bi bi-camera-video-off" aria-hidden="true" />
                      <span>No recording analysed for this camera yet</span>
                      {canUpload && (
                        <button
                          type="button"
                          className="btn btn-sm btn-light"
                          onClick={() => onAnalyse(camera.cameraId)}
                        >
                          <i className="bi bi-upload me-1" aria-hidden="true" />
                          Analyse a recording
                        </button>
                      )}
                    </>
                  )
                }
                footer={
                  clip && !offline ? (
                    <>
                      <span>
                        {alerts.length === 0
                          ? 'No threats in this recording'
                          : `${alerts.length} ${alerts.length === 1 ? 'alert' : 'alerts'} in this recording`}
                      </span>
                      <span className="ms-auto d-flex gap-3">
                        {canUpload && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 as-sec-screen-btn"
                            onClick={() => onAnalyse(camera.cameraId)}
                          >
                            New recording
                          </button>
                        )}
                        <Link to={`/safety/videos/${clip.videoAnalysisId}`}>
                          Details <i className="bi bi-chevron-right" aria-hidden="true" />
                        </Link>
                      </span>
                    </>
                  ) : (
                    <span>{offline ? 'Camera disconnected' : 'Waiting for a recording'}</span>
                  )
                }
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}
