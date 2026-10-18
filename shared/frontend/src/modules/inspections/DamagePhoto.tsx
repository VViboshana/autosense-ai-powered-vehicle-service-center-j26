import { useState } from 'react';
import type { Detection, InspectionImage } from './inspections.types';
import { DAMAGE_LABELS, SEVERITY, VIEW_ANGLES, finalLabel, finalSeverity, isOpenSuggestion } from './inspections.ui';

/**
 * A photo with the damage outlines drawn on top. The SVG uses the photo's own pixel size as its coordinate system
 * (viewBox), so the polygons from the model line up with the photo at any display size. Outlines are coloured by
 * severity; the selected one is highlighted, rejected ones are dashed, possible damage is dotted and faint, and
 * dismissed possible damage is not drawn.
 */
export function DamagePhoto({ image, numbers, selected, onSelect }: {
  image: InspectionImage;
  /** Region label shown next to each outline (matches the list beside the photo): "3", or "P1" for possible damage. */
  numbers: Map<number, string>;
  selected: number | null;
  onSelect: (detectionId: number) => void;
}) {
  const [missing, setMissing] = useState(false);
  const width = image.width ?? 1280;
  const height = image.height ?? 960;
  const fontSize = Math.max(14, Math.round(width / 45));

  return (
    <div className="as-dmg-photo" style={{ aspectRatio: `${width} / ${height}` }}>
      {missing ? (
        <div className="as-dmg-missing">
          <i className="bi bi-image" aria-hidden="true" />
          <span>Photo not stored on this server</span>
        </div>
      ) : (
        <img src={image.url} alt={`${VIEW_ANGLES[image.viewAngle]} photo`} onError={() => setMissing(true)} />
      )}
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="group" aria-label="Damage found in this photo">
        {image.detections.filter((d) => numbers.has(d.detectionId)).map((d) => {
          const open = isOpenSuggestion(d);
          const severity = open ? d.severity : finalSeverity(d);
          const tone = severity ? SEVERITY[severity].tone : 'muted';
          const [x1 = 0, y1 = 0] = d.bbox;
          return (
            <g
              key={d.detectionId}
              className={`as-dmg-shape as-tone-${tone}${selected === d.detectionId ? ' on' : ''}${d.reviewStatus === 'rejected' ? ' rejected' : ''}${open ? ' possible' : ''}`}
              onClick={() => onSelect(d.detectionId)}
            >
              <title>{`${numbers.get(d.detectionId)}. ${DAMAGE_LABELS[finalLabel(d)]}`}</title>
              <polygon points={outline(d)} />
              <text x={x1} y={Math.max(fontSize, y1 - fontSize * 0.3)} fontSize={fontSize}>
                {numbers.get(d.detectionId)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** The model's polygon, or the box when a region has none. */
function outline(d: Detection): string {
  if (d.polygon && d.polygon.length >= 3) return d.polygon.map(([x, y]) => `${x},${y}`).join(' ');
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = d.bbox;
  return `${x1},${y1} ${x2},${y1} ${x2},${y2} ${x1},${y2}`;
}
