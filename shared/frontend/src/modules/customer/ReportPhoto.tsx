import { useState, type CSSProperties } from 'react';
import type { InspectionReport } from './customer.types';
import { DAMAGE_NAMES, severityName, severityTone } from './customer.ui';
import { useTraceLengths } from '@/lib/useTraceLengths';

type Photo = InspectionReport['photos'][number];

/**
 * A photo from a confirmed inspection with each damaged area outlined and numbered. The outlines trace themselves
 * when the photo appears; the highlighted area (selected, or under the pointer anywhere in the report) stays bright,
 * the others fade, and a label names it. The SVG uses the photo's pixel size, so outlines line up at any screen size.
 */
export function ReportPhoto({ photo, alt, highlight = null, onSelect, onHover }: {
  photo: Photo;
  alt: string;
  highlight?: number | null;
  onSelect?: (no: number) => void;
  onHover?: (no: number | null) => void;
}) {
  const [missing, setMissing] = useState(false);
  const svg = useTraceLengths<SVGSVGElement>('.ol', 0, 0, photo.imageId);
  const { width: w, height: h } = photo;
  const font = Math.max(16, Math.round(w / 52));
  const stroke = Math.max(3, Math.round(w / 300));
  const lit = photo.areas.find((a) => a.no === highlight);
  let i = 0;

  return (
    <div className={`cp-photo${lit ? ' focus' : ''}`} style={{ aspectRatio: `${w} / ${h}` }}>
      {missing ? (
        <div className="missing"><span><i className="bi bi-image me-2" aria-hidden="true" />Photo not available</span></div>
      ) : (
        <img src={photo.url} alt={alt} onError={() => setMissing(true)} />
      )}
      <svg ref={svg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {photo.areas.map((a) => {
          const bx = a.bbox[0];
          const by = Math.max(font * 1.3, a.bbox[1] - font * 0.3);
          return (
            <g
              key={a.no}
              className={`grp cp-tone-${severityTone(a.severity)}${a.no === highlight ? ' on' : ''}`}
              onClick={onSelect && (() => onSelect(a.no))}
              onPointerEnter={onHover && (() => onHover(a.no))}
              onPointerLeave={onHover && (() => onHover(null))}
            >
              {a.outlines.map((pts, k) => (
                <polygon
                  key={k}
                  className="ol"
                  points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                  strokeWidth={a.no === highlight ? stroke * 1.5 : stroke}
                  style={{ '--i': i++ } as CSSProperties}
                />
              ))}
              <g className="badge" style={{ '--i': i - 1 } as CSSProperties}>
                <circle cx={bx} cy={by} r={font * 0.95} strokeWidth={stroke} />
                <text x={bx} y={by + font * 0.36} fontSize={font} textAnchor="middle">{a.no}</text>
              </g>
            </g>
          );
        })}
      </svg>
      {lit && (
        <div
          key={lit.no}
          className={`cp-callout cp-tone-${severityTone(lit.severity)}`}
          style={{ left: `${Math.min(62, (lit.bbox[0] / w) * 100)}%`, top: `${Math.max(14, (lit.bbox[1] / h) * 100)}%` }}
        >
          {lit.no} · {DAMAGE_NAMES[lit.label] ?? lit.label} · {severityName(lit.severity)}
        </div>
      )}
    </div>
  );
}
