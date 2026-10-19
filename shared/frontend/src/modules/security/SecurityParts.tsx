import type { Tone } from '@/components/ui/StatusPill';
import type { Detection, Severity, ThreatType } from './security.types';
import { classLabel, percent, SEVERITY, THREAT } from './security.ui';

/** Severity pill; Critical is filled so it stands out from High. */
export function SeverityPill({ severity, escalated }: { severity: Severity; escalated?: boolean }) {
  const s = SEVERITY[severity];
  return (
    <span className="text-nowrap">
      <span className={`as-pill as-pill-${s.tone}${severity === 'critical' ? ' as-sec-critical' : ''}`}>
        {severity === 'critical' && <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />}
        {s.label}
      </span>
      {escalated && (
        <span className="as-sec-escalated" title="Raised above the threat's base severity">
          <i className="bi bi-arrow-up" aria-hidden="true" />
          raised
        </span>
      )}
    </span>
  );
}

/** Threat icon in a circle coloured by severity, the threat's name, and an optional line under it. */
export function ThreatCell({ threat, severity, name, detail }: { threat: ThreatType; severity: Severity; name?: string; detail?: string }) {
  return (
    <div className="as-sec-threat">
      <span className={`as-sec-threat-ic as-tone-${SEVERITY[severity].tone}`}>
        <i className={`bi ${THREAT[threat].icon}`} aria-hidden="true" />
      </span>
      <div>
        <b>{name ?? THREAT[threat].label}</b>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}

/** Threat classes are drawn solid in a state colour; context classes (who and what is there) dashed. */
const CLASS_TONE: Record<string, { tone: Tone; context: boolean }> = {
  fire: { tone: 'danger', context: false },
  smoke: { tone: 'danger', context: false },
  weapon: { tone: 'danger', context: false },
  tampering: { tone: 'danger', context: false },
  loitering: { tone: 'warning', context: false },
  face_covered: { tone: 'warning', context: false },
  person: { tone: 'info', context: true },
  worker: { tone: 'success', context: true },
  vehicle: { tone: 'muted', context: true },
};

/**
 * Where the model saw each object in the camera view. Boxes are in normalised coordinates (0..1), so they are drawn
 * on a 16:9 frame; the stored frame itself is not shown here.
 */
export function AlertFrame({ detections, cameraName }: { detections: Detection[]; cameraName: string | null }) {
  // Context boxes first, so a threat box drawn on the same spot stays on top and readable
  const ordered = [...detections].sort((a, b) => Number(!(CLASS_TONE[a.label]?.context ?? true)) - Number(!(CLASS_TONE[b.label]?.context ?? true)));
  return (
    <>
      <div className="as-sec-frame" role="img" aria-label={`Detections in the view of ${cameraName ?? 'the camera'}`}>
        {ordered.map((d, i) => {
          const style = CLASS_TONE[d.label] ?? { tone: 'muted', context: true };
          const [x1, y1, x2, y2] = d.bbox;
          return (
            <div
              key={i}
              className={`as-sec-box as-tone-${style.tone}${style.context ? ' as-sec-box-context' : ''}`}
              style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}
            >
              {!style.context && (
                <span>
                  {classLabel(d.label)} {percent(d.confidence)}
                </span>
              )}
            </div>
          );
        })}
        <span className="as-sec-frame-note">
          <i className="bi bi-camera-video" aria-hidden="true" />
          {cameraName ?? 'Camera'} · positions of the detections in the camera view
        </span>
      </div>
      <div className="as-sec-legend">
        <span className="as-tone-danger"><i aria-hidden="true" />Threat</span>
        <span className="as-tone-warning"><i aria-hidden="true" />Behaviour</span>
        <span className="as-tone-info"><i className="dashed" aria-hidden="true" />Person</span>
        <span className="as-tone-success"><i className="dashed" aria-hidden="true" />Worker</span>
        <span className="as-tone-muted"><i className="dashed" aria-hidden="true" />Vehicle</span>
      </div>
    </>
  );
}
