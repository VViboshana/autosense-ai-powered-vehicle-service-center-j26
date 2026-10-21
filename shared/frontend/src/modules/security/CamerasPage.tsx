import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { formatDate, formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { SeverityPill } from './SecurityParts';
import type { SecurityCamera, SecurityService, VideoAnalysis } from './security.types';
import { ZONE_TYPE } from './security.ui';
import { RecentVideos, ServiceStatus, VideoUploadDialog } from './VideoParts';
import './security.css';

function CameraTile({ camera, canSeeAlerts, onAnalyse }: { camera: SecurityCamera; canSeeAlerts: boolean; onAnalyse?: () => void }) {
  const offline = camera.status === 'offline';
  return (
    <div className={`as-sec-cam${offline ? ' offline' : ''}`}>
      <div className="as-sec-cam-view">
        <StatusPill tone={offline ? 'danger' : 'success'}>{offline ? 'Offline' : 'Online'}</StatusPill>
        <span className="as-sec-cam-code">{camera.code}</span>
        <i className={`bi ${offline ? 'bi-camera-video-off' : 'bi-camera-video'}`} aria-hidden="true" />
        <span>
          {offline
            ? camera.lastSeenAt ? `No picture for ${formatDuration(minutesSince(camera.lastSeenAt))}` : 'Never connected'
            : 'Watched by the security service'}
        </span>
      </div>
      <div className="as-sec-cam-body">
        <b>{camera.name}</b>
        {camera.zone && (
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="small">{camera.zone.name}</span>
            <StatusPill tone={ZONE_TYPE[camera.zone.zoneType].tone}>{ZONE_TYPE[camera.zone.zoneType].label}</StatusPill>
          </div>
        )}
        {camera.location && <span className="as-sec-cam-line">{camera.location}</span>}
        <span className="as-sec-cam-line">
          {camera.lastAlertAt ? `Last alert ${formatDate(camera.lastAlertAt)} ${formatTime(camera.lastAlertAt)}` : 'No alerts yet'}
          {' · '}
          {camera.alertsToday} today
        </span>
      </div>
      <div className="as-sec-cam-foot">
        {camera.activeAlerts > 0 && camera.worstActiveSeverity ? (
          <span className="d-flex align-items-center gap-2">
            <SeverityPill severity={camera.worstActiveSeverity} />
            <span>{camera.activeAlerts} active</span>
          </span>
        ) : (
          <span className="text-body-secondary">No active alerts</span>
        )}
        <span className="d-flex align-items-center gap-3">
          {onAnalyse && (
            <button type="button" className="btn btn-link btn-sm p-0 small" onClick={onAnalyse} title={`Analyse a recorded video from ${camera.name}`}>
              <i className="bi bi-film me-1" aria-hidden="true" />Video
            </button>
          )}
          {canSeeAlerts && (
            <Link to={`/safety/alerts?camera=${camera.cameraId}`} className="small">
              Alerts <i className="bi bi-chevron-right" aria-hidden="true" />
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * Safety › Cameras (CAMERAS): the security cameras around the premises, whether each is sending pictures, the zone it
 * watches and its active alerts. The live picture is watched by the security service, not streamed to the browser.
 */
export function CamerasPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<SecurityCamera[]>('/security/cameras', undefined, { refreshMs: 30_000 });
  const offline = data?.filter((c) => c.status === 'offline').length ?? 0;
  const service = useApi<SecurityService>('/security/service', undefined, { refreshMs: 15_000 });
  const videos = useApi<VideoAnalysis[]>('/security/videos', undefined, { refreshMs: 5_000 });
  // undefined = closed; null = open without a camera chosen; a number = open for that camera
  const [uploadFor, setUploadFor] = useState<number | null | undefined>(undefined);
  const canUpload = Boolean(data && data.length > 0);

  return (
    <>
      <PageHeader
        title="Cameras"
        subtitle={
          data ? (
            <>
              <span>{data.length} security {data.length === 1 ? 'camera' : 'cameras'}</span>
              <span aria-hidden="true">·</span>
              {offline > 0 ? <span className="text-danger">{offline} offline</span> : <span className="as-live">All online · updated {formatTime(new Date())}</span>}
            </>
          ) : (
            'Security cameras around the premises'
          )
        }
        actions={
          <>
            <ServiceStatus service={service} />
            {can('SAFETY_ALERTS') && (
              <Link className="btn btn-light" to="/safety/alerts">
                <i className="bi bi-shield-exclamation me-1" aria-hidden="true" />
                Alerts
              </Link>
            )}
            {canUpload && (
              <button type="button" className="btn btn-primary" onClick={() => setUploadFor(null)}>
                <i className="bi bi-upload me-1" aria-hidden="true" />
                Analyse a video
              </button>
            )}
          </>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          <RecentVideos videos={videos} onUpload={() => setUploadFor(null)} canUpload={canUpload} />
          <Card icon="bi-camera-video" title="Premises cameras" subtitle="Bay cameras for occupancy are in Bays & cameras">
            {error && !data ? (
              <ErrorState inline error={error} onRetry={reload} title="Cameras couldn't be loaded" />
            ) : loading || !data ? (
              <div className="as-sec-cams" aria-busy="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <div className="as-sec-cam" key={i}>
                    <div className="as-sec-cam-view" />
                    <div className="as-sec-cam-body">
                      <Skeleton width="50%" />
                      <Skeleton width="80%" />
                    </div>
                  </div>
                ))}
              </div>
            ) : data.length === 0 ? (
              <EmptyState icon="bi-camera-video" title="No security cameras yet">
                Cameras appear here once they are added for the security service.
              </EmptyState>
            ) : (
              <>
                {offline > 0 && (
                  <div className="as-sec-body pb-0">
                    <Alert tone="warning">
                      {offline === 1 ? 'One camera is' : `${offline} cameras are`} offline. Threats in {offline === 1 ? 'its' : 'their'} view are not
                      detected until {offline === 1 ? 'it is' : 'they are'} back online.
                    </Alert>
                  </div>
                )}
                <div className="as-sec-cams">
                  {data.map((c) => <CameraTile key={c.cameraId} camera={c} canSeeAlerts={can('SAFETY_ALERTS')} onAnalyse={() => setUploadFor(c.cameraId)} />)}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
      {uploadFor !== undefined && data && (
        <VideoUploadDialog cameras={data} initialCameraId={uploadFor ?? undefined} serviceOnline={service.data?.online ?? false}
          onClose={() => setUploadFor(undefined)} />
      )}
    </>
  );
}
