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
import { ConnectionButton, RecordingsDialog } from './CameraActions';
import { LiveWall } from './LiveWall';
import { ModelDemo } from './ModelDemo';
import { SeverityPill } from './SecurityParts';
import type { SecurityCamera, SecurityService } from './security.types';
import { ZONE_TYPE } from './security.ui';
import { ServiceStatus, VideoUploadDialog } from './VideoParts';
import './security.css';

/** Every premises camera in one table: is it sending pictures, what it watches, and its real (not test) alerts. */
function CameraHealth({
  cameras,
  canSeeAlerts,
  canUpload,
  onAnalyse,
  onRecordings,
  onChanged,
}: {
  cameras: SecurityCamera[];
  canSeeAlerts: boolean;
  canUpload: boolean;
  onAnalyse: (cameraId: number) => void;
  onRecordings: (camera: SecurityCamera) => void;
  onChanged: () => void;
}) {
  return (
    <div className="table-responsive">
      <table className="table as-table">
        <thead>
          <tr>
            <th>Camera</th>
            <th>Zone</th>
            <th>Status</th>
            <th>Active alerts</th>
            <th className="text-end">Today</th>
            <th>Last alert</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cameras.map((c) => {
            const offline = c.status === 'offline';
            return (
              <tr key={c.cameraId}>
                <td className="as-veh">
                  <b>{c.name}</b>
                  <small className="as-mono">
                    {c.code}
                    {c.location && <span className="as-sec-loc"> · {c.location}</span>}
                  </small>
                </td>
                <td className="small">
                  {c.zone ? (
                    <span className="d-flex align-items-center gap-2 flex-wrap">
                      {c.zone.name}
                      <StatusPill tone={ZONE_TYPE[c.zone.zoneType].tone}>{ZONE_TYPE[c.zone.zoneType].label}</StatusPill>
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="small text-nowrap">
                  <StatusPill tone={offline ? 'danger' : 'success'}>{offline ? 'Offline' : 'Online'}</StatusPill>
                  {offline && c.lastSeenAt && (
                    <div className="text-body-secondary mt-1">
                      No picture for {formatDuration(minutesSince(c.lastSeenAt))}
                    </div>
                  )}
                </td>
                <td className="text-nowrap">
                  {c.activeAlerts > 0 && c.worstActiveSeverity ? (
                    <span className="d-flex align-items-center gap-2">
                      <SeverityPill severity={c.worstActiveSeverity} />
                      <span className="small">{c.activeAlerts}</span>
                    </span>
                  ) : (
                    <span className="small text-body-secondary">None</span>
                  )}
                </td>
                <td className="text-end as-num">{c.alertsToday}</td>
                <td className="small as-num text-nowrap">
                  {c.lastAlertAt ? `${formatDate(c.lastAlertAt)} ${formatTime(c.lastAlertAt)}` : '—'}
                </td>
                <td className="text-end text-nowrap">
                  <span className="d-inline-flex gap-3 small">
                    <ConnectionButton camera={c} onChanged={onChanged} />
                    <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onRecordings(c)}>
                      <i className="bi bi-film me-1" aria-hidden="true" />
                      Recordings
                    </button>
                    {canUpload && (
                      <button type="button" className="btn btn-link btn-sm p-0" onClick={() => onAnalyse(c.cameraId)}>
                        <i className="bi bi-upload me-1" aria-hidden="true" />
                        Recording
                      </button>
                    )}
                    {canSeeAlerts && (
                      <Link to={`/safety/alerts?camera=${c.cameraId}`}>
                        Alerts <i className="bi bi-chevron-right" aria-hidden="true" />
                      </Link>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Upload = { mode: 'premises'; cameraId?: number } | { mode: 'synthetic' };

/**
 * Safety › Cameras (CAMERAS): the security console for the premises cameras.
 * - Live wall: each camera's latest analysed recording replayed with the alerts the model raised, at their moment.
 * - Camera health: online / offline, zone and active alerts of every camera.
 * - Model demo: synthetic test videos that show how the model works, kept apart from real security data.
 */
export function CamerasPage() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<SecurityCamera[]>('/security/cameras', undefined, {
    refreshMs: 30_000,
  });
  const service = useApi<SecurityService>('/security/service', undefined, { refreshMs: 10_000 });
  const [upload, setUpload] = useState<Upload | null>(null);
  const [demoKey, setDemoKey] = useState(0); // remounts the demo wall after a new test video, so it shows at once
  const [wallKey, setWallKey] = useState(0); // remounts the live wall after a camera or recording change
  const [recordingsOf, setRecordingsOf] = useState<SecurityCamera | null>(null);
  const changed = () => {
    reload();
    setWallKey((k) => k + 1);
  };

  const offline = data?.filter((c) => c.status === 'offline').length ?? 0;
  const canUpload = Boolean(data && data.length > 0);
  const analyse = (cameraId?: number) => setUpload({ mode: 'premises', cameraId });

  return (
    <>
      <PageHeader
        title="Cameras"
        subtitle={
          data ? (
            <>
              <span>
                {data.length} premises {data.length === 1 ? 'camera' : 'cameras'}
              </span>
              <span aria-hidden="true">·</span>
              {offline > 0 ? (
                <span className="text-danger">{offline} offline</span>
              ) : (
                <span className="as-live">All online · updated {formatTime(new Date())}</span>
              )}
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
              <button type="button" className="btn btn-primary" onClick={() => analyse()}>
                <i className="bi bi-upload me-1" aria-hidden="true" />
                Analyse a recording
              </button>
            )}
          </>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          {offline > 0 && (
            <Alert tone="warning">
              {offline === 1 ? 'One camera is' : `${offline} cameras are`} offline. Threats in{' '}
              {offline === 1 ? 'its' : 'their'} view are not detected until {offline === 1 ? 'it is' : 'they are'} back
              online.
            </Alert>
          )}

          <LiveWall key={`wall-${wallKey}`} onAnalyse={analyse} canUpload={canUpload} />

          <Card
            icon="bi-activity"
            title="Camera health"
            subtitle="Status and real alerts of each premises camera (test videos excluded)"
          >
            {error && !data ? (
              <ErrorState inline error={error} onRetry={reload} title="Cameras couldn't be loaded" />
            ) : loading || !data ? (
              <div className="as-sec-body">
                <Skeleton width="70%" />
                <div className="mt-2">
                  <Skeleton width="50%" />
                </div>
              </div>
            ) : data.length === 0 ? (
              <EmptyState icon="bi-camera-video" title="No security cameras yet">
                Cameras appear here once they are added for the security service.
              </EmptyState>
            ) : (
              <CameraHealth
                cameras={data}
                canSeeAlerts={can('SAFETY_ALERTS')}
                canUpload={canUpload}
                onAnalyse={analyse}
                onRecordings={setRecordingsOf}
                onChanged={changed}
              />
            )}
          </Card>

          <ModelDemo key={`demo-${demoKey}`} onAdd={() => setUpload({ mode: 'synthetic' })} canUpload={can('CAMERAS')} />
        </div>
      </div>

      {recordingsOf && (
        <RecordingsDialog camera={recordingsOf} onClose={() => setRecordingsOf(null)} onChanged={changed} />
      )}
      {upload && data && (
        <VideoUploadDialog
          mode={upload.mode}
          cameras={data}
          initialCameraId={upload.mode === 'premises' ? upload.cameraId : undefined}
          serviceOnline={service.data?.online ?? false}
          onClose={() => setUpload(null)}
          onStarted={() => {
            setUpload(null);
            setDemoKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
