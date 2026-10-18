import { useState } from 'react';
import type { ReportFinding } from './customer.types';
import { SEVERITY_TONE } from './severity';
import '@/modules/inspections/inspections.css';

/**
 * A photo from a confirmed inspection with the technician-checked damage outlined and numbered. Read-only: the same
 * drawing as the staff detail page (the SVG uses the photo's pixel size, so outlines line up at any screen size).
 */
export function ReportPhoto({ url, width, height, findings, alt }: {
  url: string;
  width: number | null;
  height: number | null;
  findings: ReportFinding[];
  alt: string;
}) {
  const [missing, setMissing] = useState(false);
  const w = width ?? 1280;
  const h = height ?? 960;
  const fontSize = Math.max(14, Math.round(w / 45));

  return (
    <div className="as-dmg-photo" style={{ aspectRatio: `${w} / ${h}` }}>
      {missing ? (
        <div className="as-dmg-missing">
          <i className="bi bi-image" aria-hidden="true" />
          <span>Photo not available</span>
        </div>
      ) : (
        <img src={url} alt={alt} onError={() => setMissing(true)} />
      )}
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        {findings.map((f) => {
          const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = f.bbox;
          const points =
            f.polygon && f.polygon.length >= 3
              ? f.polygon.map(([x, y]) => `${x},${y}`).join(' ')
              : `${x1},${y1} ${x2},${y1} ${x2},${y2} ${x1},${y2}`;
          return (
            <g key={f.no} className={`as-dmg-shape as-tone-${SEVERITY_TONE[f.severity ?? ''] ?? 'muted'}`} style={{ cursor: 'default' }}>
              <polygon points={points} />
              <text x={x1} y={Math.max(fontSize, y1 - fontSize * 0.3)} fontSize={fontSize}>{f.no}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
