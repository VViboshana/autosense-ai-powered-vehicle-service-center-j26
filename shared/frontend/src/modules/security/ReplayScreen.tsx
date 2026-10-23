import { useState, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { SeverityPill } from './SecurityParts';
import type { ReplayAlert } from './security.types';
import { clock, percent, THREAT } from './security.ui';

/** How long an alert's banner stays on its screen after the moment it was found. */
const BANNER_S = 5;

/**
 * One monitor screen: an analysed clip (the model's annotated video) on a loop. At the second the model found a
 * threat, the screen gets an alarm frame and a banner with the threat, severity and model confidence.
 * Used by the Live wall (premises cameras) and the Model demo (synthetic test videos).
 */
export function ReplayScreen({ title, code, detail, videoAnalysisId, alerts, paused, register, empty, footer, tag }: {
  title: string;
  code?: string;
  detail?: string | null;
  videoAnalysisId: number | null;
  alerts: ReplayAlert[];
  paused: boolean;
  register: (el: HTMLVideoElement | null) => void;
  /** Shown instead of the video when there is no clip */
  empty: ReactNode;
  footer: ReactNode;
  /** A label in the head, e.g. "Synthetic" */
  tag?: ReactNode;
}) {
  const { can } = useSession();
  const [t, setT] = useState(0);
  const showing = alerts.filter((a) => t >= a.videoTimeS && t < a.videoTimeS + BANNER_S);
  const alarm = showing.some((a) => a.severity === 'critical' || a.severity === 'high') ? 'danger' : showing.length ? 'warning' : null;

  return (
    <div className={`as-sec-screen${alarm ? ` alarm-${alarm}` : ''}`}>
      <div className="as-sec-screen-head">
        <span className="as-sec-rec" aria-hidden="true" />
        <b>{title}</b>
        {code && <span className="as-mono">{code}</span>}
        {detail && <span className="as-sec-screen-zone">{detail}</span>}
        {tag}
        {videoAnalysisId && <span className="ms-auto as-mono">{clock(t)}</span>}
      </div>

      <div className="as-sec-screen-view">
        {videoAnalysisId ? (
          <video
            ref={register}
            src={`/api/security/videos/${videoAnalysisId}/video`}
            muted
            autoPlay
            loop
            playsInline
            preload="auto"
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            // React sets `muted` after the browser tries autoplay, so some screens would stay still: start each one here
            onCanPlay={(e) => {
              const v = e.currentTarget;
              v.muted = true;
              if (!paused && v.paused) void v.play().catch(() => undefined);
            }}
            aria-label={`${title}: the model's annotated video`}
          />
        ) : (
          <div className="as-sec-screen-empty">{empty}</div>
        )}

        {showing.length > 0 && (
          <div className="as-sec-banners" role="status" aria-live="polite">
            {showing.map((a) => (
              <div key={a.alertId} className="as-sec-banner">
                <i className={`bi ${THREAT[a.threatType].icon}`} aria-hidden="true" />
                <span className="as-sec-banner-text">
                  <b>{a.threatName}</b>
                  <small>{percent(a.confidence)} model confidence</small>
                </span>
                <SeverityPill severity={a.severity} />
                {can('SAFETY_ALERTS') && <Link to={`/safety/alerts/${a.alertId}`} className="as-sec-banner-link">{a.alertNo}</Link>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="as-sec-screen-foot">{footer}</div>
    </div>
  );
}

/** Pause all / Play all, Restart together and Full screen for a wall of screens. */
export function WallControls({ videos, target, paused, setPaused }: {
  videos: Map<number, HTMLVideoElement>;
  /** The wall element shown full screen (read when the button is pressed, so it exists by then) */
  target: RefObject<HTMLElement | null>;
  paused: boolean;
  setPaused: (p: boolean) => void;
}) {
  const playAll = () => {
    videos.forEach((v) => void v.play().catch(() => undefined));
    setPaused(false);
  };
  const pauseAll = () => {
    videos.forEach((v) => v.pause());
    setPaused(true);
  };
  const restartAll = () => {
    videos.forEach((v) => {
      v.currentTime = 0;
    });
    playAll();
  };
  return (
    <div className="btn-group btn-group-sm" role="group" aria-label="Playback">
      {paused ? (
        <button type="button" className="btn btn-light" onClick={playAll}><i className="bi bi-play-fill me-1" aria-hidden="true" />Play all</button>
      ) : (
        <button type="button" className="btn btn-light" onClick={pauseAll}><i className="bi bi-pause-fill me-1" aria-hidden="true" />Pause all</button>
      )}
      <button type="button" className="btn btn-light" onClick={restartAll}><i className="bi bi-skip-start-fill me-1" aria-hidden="true" />Restart together</button>
      <button type="button" className="btn btn-light" onClick={() => void target.current?.requestFullscreen?.().catch(() => undefined)}>
        <i className="bi bi-arrows-fullscreen me-1" aria-hidden="true" />Full screen
      </button>
    </div>
  );
}
