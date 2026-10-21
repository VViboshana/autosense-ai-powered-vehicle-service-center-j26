import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { formatDate, formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { SeverityPill, ThreatCell } from './SecurityParts';
import type { VideoAlert, VideoAnalysisDetail } from './security.types';
import { alertStatus, formatSeconds, megabytes, percent, THREAT, VIDEO_STATUS } from './security.ui';
import './security.css';

/** 41.5 -> "0:41" */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * One recorded video analysis (CAMERAS): while it runs, progress; when done, the annotated video from the model and
 * every alert it raised. Clicking an alert jumps the video to that moment. ?t=<seconds> starts the video there.
 */
export function VideoAnalysisPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { can } = useSession();
  const [refreshMs, setRefreshMs] = useState<number | undefined>(3_000);
  const { data, error, loading, reload } = useApi<VideoAnalysisDetail>(`/security/videos/${id}`, undefined, { refreshMs });
  const video = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  // Poll only while the analysis runs
  useEffect(() => {
    if (data) setRefreshMs(data.status === 'running' ? 3_000 : undefined);
  }, [data]);

  // A link with ?t= opens the video at that moment
  const startAt = Number(params.get('t'));
  useEffect(() => {
    const v = video.current;
    if (!v || !startAt) return;
    const seek = () => { v.currentTime = startAt; };
    v.addEventListener('loadedmetadata', seek, { once: true });
    return () => v.removeEventListener('loadedmetadata', seek);
  }, [startAt, data?.hasVideo]);

  if (error && !data) {
    return (
      <div className="app-content pt-4">
        <div className="container-fluid">
          <ErrorState error={error} onRetry={reload} title={error.status === 404 ? 'Video analysis not found' : undefined} />
        </div>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="app-content pt-4">
        <div className="container-fluid">
          <Card><Skeleton width="30%" /><div className="mt-3"><Skeleton width="100%" /></div></Card>
        </div>
      </div>
    );
  }

  const status = VIDEO_STATUS[data.status];
  const s = data.summary ?? {};
  const jump = (a: VideoAlert) => {
    setSelected(a.alertId);
    const v = video.current;
    if (v) {
      v.currentTime = Math.max(0, a.videoTimeS - 1); // a second before, so the moment itself is seen
      void v.play().catch(() => undefined);
    }
  };
  // The alert nearest before the playing position, highlighted while the video plays
  const playing = [...data.alerts].reverse().find((a) => a.videoTimeS <= now + 0.5)?.alertId;

  return (
    <>
      <PageHeader
        title={
          <>
            {data.title ?? data.fileName} <StatusPill tone={status.tone}>{status.label}</StatusPill>
            {data.isSynthetic && <> <StatusPill tone="info">Synthetic test video</StatusPill></>}
          </>
        }
        documentTitle={`Video · ${data.title ?? data.fileName}`}
        subtitle={
          <>
            {data.camera ? (
              <span>{data.camera.name} <span className="as-mono">{data.camera.code}</span>{data.camera.zone && `, ${data.camera.zone}`}</span>
            ) : (
              <span>{data.expectedThreat ? `Made to show: ${THREAT[data.expectedThreat].label}` : 'Model demo'} · {data.fileName}</span>
            )}
            <span aria-hidden="true">·</span>
            <span>Uploaded {formatDate(data.createdAt)} {formatTime(data.createdAt)}{data.createdBy && ` by ${data.createdBy}`}</span>
            <span aria-hidden="true">·</span>
            <span>{megabytes(data.fileSize)}</span>
          </>
        }
        actions={
          <>
            <Link className="btn btn-light" to="/safety/cameras">
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              Cameras
            </Link>
            {data.status === 'done' && data.alertCount > 0 && data.camera && can('SAFETY_ALERTS') && (
              <Link className="btn btn-primary" to={`/safety/alerts?camera=${data.camera.cameraId}`}>
                <i className="bi bi-shield-exclamation me-1" aria-hidden="true" />
                Open in Alerts
              </Link>
            )}
          </>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          {data.status === 'running' && (
            <Card>
              <div className="as-sec-body pt-4 d-flex gap-3 align-items-start">
                <div className="spinner-border text-secondary flex-shrink-0" role="status" aria-label="Analysing" />
                <div>
                  <b>The model is analysing the video</b>
                  <p className="small text-body-secondary mb-0 mt-1">
                    Every frame goes through detection (YOLO11), tracking (ByteTrack) and the rule engine. This usually takes about as
                    long as the clip itself, longer on a computer without a GPU. This page updates by itself; you can leave it and come
                    back from Cameras.
                  </p>
                  {!data.serviceReachable && (
                    <div className="mt-2"><Alert tone="warning">The security service is not answering. The analysis continues once it is running again.</Alert></div>
                  )}
                </div>
              </div>
            </Card>
          )}
          {data.status === 'failed' && <Alert>{data.error ?? 'The analysis failed.'}</Alert>}

          {data.status === 'done' && (
            <>
              <section className="as-card as-kpis" aria-label="Analysis summary">
                <div className="as-kpi">
                  <span className="as-kpi-label"><i className="bi bi-film" aria-hidden="true" />Video</span>
                  <span className="as-kpi-value">{s.video_s != null ? formatSeconds(Math.round(s.video_s)) : '—'}</span>
                  <span className="as-kpi-note">{s.processing_s != null ? `analysed in ${formatSeconds(Math.round(s.processing_s))}` : ''}</span>
                </div>
                <div className={`as-kpi${data.alertCount > 0 ? ' as-sec-hot' : ''}`}>
                  <span className="as-kpi-label"><i className="bi bi-shield-exclamation" aria-hidden="true" />Alerts raised</span>
                  <span className="as-kpi-value">{data.alertCount}</span>
                  <span className="as-kpi-note">{data.alertCount ? `${data.alerts.filter((a) => a.severity === 'critical').length} critical` : 'No threats found'}</span>
                </div>
                <div className="as-kpi">
                  <span className="as-kpi-label"><i className="bi bi-people" aria-hidden="true" />People tracked</span>
                  <span className="as-kpi-value">{s.tracked_people ?? '—'}</span>
                  <span className="as-kpi-note">{s.workers != null ? `${s.workers} recognised as workers` : ''}</span>
                </div>
                <div className="as-kpi">
                  <span className="as-kpi-label"><i className="bi bi-sliders" aria-hidden="true" />Rule times</span>
                  <span className="as-kpi-value" style={{ fontSize: '1rem' }}>{data.shortTimings ? 'Short clip' : 'Standard'}</span>
                  <span className="as-kpi-note">{data.startTime ? `starts at ${data.startTime}` : 'clock time not given'}</span>
                </div>
              </section>

              <div className="row g-3">
                <div className="col-xl-8">
                  <Card icon="bi-camera-video" title="What the model saw" subtitle="Boxes, track IDs and alert banners drawn by the security service">
                    <div className="as-sec-body">
                      {data.hasVideo ? (
                        <video ref={video} className="as-sec-player" controls preload="metadata" src={`/api/security/videos/${data.videoAnalysisId}/video`}
                          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
                      ) : (
                        <EmptyState icon="bi-film" title="No annotated video stored">The alerts below are still complete.</EmptyState>
                      )}
                      {data.hasVideo && s.video_s && data.alerts.length > 0 && (
                        <div className="as-sec-track" aria-label="Alerts along the video">
                          {data.alerts.map((a) => (
                            <button key={a.alertId} type="button" className={`as-sec-mark as-tone-${a.severity === 'low' ? 'info' : a.severity === 'medium' ? 'warning' : 'danger'}`}
                              style={{ left: `${Math.min(100, (a.videoTimeS / s.video_s!) * 100)}%` }}
                              title={`${clock(a.videoTimeS)} ${a.threatName}`} aria-label={`Jump to ${a.threatName} at ${clock(a.videoTimeS)}`} onClick={() => jump(a)} />
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                  <Alert tone="info">
                    {data.isSynthetic
                      ? 'This is a synthetic test video: its alerts are test results shown on the Model demo, not real incidents, and they never reach the Alerts list.'
                      : "Alerts from this video are in the Alerts list like live ones, as open alerts to acknowledge and resolve. Confidence is the model's confidence; check each one before acting."}
                  </Alert>
                </div>

                <div className="col-xl-4">
                  <Card icon="bi-list-ol" title="Alerts in this video" subtitle={data.alerts.length ? 'Click one to jump to that moment' : undefined}>
                    {data.alerts.length === 0 ? (
                      <EmptyState icon="bi-shield-check" title="No threats found">
                        The model and rules found no fire, smoke, weapon, tampering, unauthorised access or loitering in this clip.
                      </EmptyState>
                    ) : (
                      <ol className="as-sec-vlist">
                        {data.alerts.map((a) => {
                          const st = alertStatus(a);
                          return (
                            <li key={a.alertId} className={selected === a.alertId || playing === a.alertId ? 'on' : undefined}>
                              <button type="button" className="as-sec-vjump" onClick={() => jump(a)}>
                                <span className="as-sec-vtime as-num">{clock(a.videoTimeS)}</span>
                                <ThreatCell threat={a.threatType} severity={a.severity} name={a.threatName}
                                  detail={[a.personRole && (a.personRole === 'worker' ? 'Worker' : 'Visitor'), ...a.reasons].filter(Boolean).join(' · ') || undefined} />
                              </button>
                              <div className="as-sec-vmeta">
                                <SeverityPill severity={a.severity} escalated={a.escalated} />
                                <span className="small text-body-secondary as-num">{percent(a.confidence)}</span>
                                <StatusPill tone={st.tone}>{st.label}</StatusPill>
                                {can('SAFETY_ALERTS') && <Link className="small ms-auto" to={`/safety/alerts/${a.alertId}`}>{a.alertNo}</Link>}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
