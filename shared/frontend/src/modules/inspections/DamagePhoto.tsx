import { useRef, useState, type PointerEvent } from 'react';
import type { Detection, InspectionImage } from './inspections.types';
import { DAMAGE_LABELS, SEVERITY, VIEW_ANGLES, finalLabel, finalSeverity, isOpenSuggestion } from './inspections.ui';

const MIN_BOX_PX = 8; // in photo pixels; a smaller box is a stray click, not a region

/**
 * A photo with the damage outlines drawn on top. The SVG uses the photo's own pixel size as its coordinate system
 * (viewBox), so the polygons from the model line up with the photo at any display size. Outlines are coloured by
 * severity; the selected one is highlighted, rejected ones are dashed, possible damage is dotted and faint, and
 * dismissed possible damage is not drawn.
 *
 * With `drawing` on, dragging on the photo (mouse, pen or finger) draws a box, returned in photo pixels by `onDrawn`:
 * the technician marks damage the model missed.
 */
export function DamagePhoto({ image, numbers, selected, onSelect, drawing = false, onDrawn }: {
  image: InspectionImage;
  /** Region label shown next to each outline (matches the list beside the photo): "3", or "P1" for possible damage. */
  numbers: Map<number, string>;
  selected: number | null;
  onSelect: (detectionId: number) => void;
  drawing?: boolean;
  onDrawn?: (bbox: [number, number, number, number]) => void;
}) {
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const width = image.width ?? 1280;
  const height = image.height ?? 960;
  const fontSize = Math.max(14, Math.round(width / 45));

  // Screen position -> photo pixels: the SVG is the photo stretched to the box on screen
  function toPhoto(e: PointerEvent) {
    const r = svg.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    return { x: clamp(((e.clientX - r.left) / r.width) * width, width), y: clamp(((e.clientY - r.top) / r.height) * height, height) };
  }

  function start(e: PointerEvent<SVGSVGElement>) {
    if (!drawing) return;
    e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves even if the pointer leaves the photo
    const p = toPhoto(e);
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!draft) return;
    const p = toPhoto(e);
    setDraft({ ...draft, x1: p.x, y1: p.y });
  }
  function end() {
    if (!draft) return;
    setDraft(null);
    const box = [Math.min(draft.x0, draft.x1), Math.min(draft.y0, draft.y1), Math.max(draft.x0, draft.x1), Math.max(draft.y0, draft.y1)].map(Math.round) as [number, number, number, number];
    if (box[2] - box[0] >= MIN_BOX_PX && box[3] - box[1] >= MIN_BOX_PX) onDrawn?.(box);
  }

  return (
    <div className={`as-dmg-photo${drawing ? ' drawing' : ''}`} style={{ aspectRatio: `${width} / ${height}` }}>
      {missing ? (
        <div className="as-dmg-missing">
          <i className="bi bi-image" aria-hidden="true" />
          <span>Photo not stored on this server</span>
        </div>
      ) : (
        <img src={image.url} alt={`${VIEW_ANGLES[image.viewAngle]} photo`} onError={() => setMissing(true)} draggable={false} />
      )}
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="group"
        aria-label={drawing ? 'Drag a box around the damage' : 'Damage found in this photo'}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => setDraft(null)}
      >
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
        {draft && (
          <rect
            className="as-dmg-draft"
            x={Math.min(draft.x0, draft.x1)}
            y={Math.min(draft.y0, draft.y1)}
            width={Math.abs(draft.x1 - draft.x0)}
            height={Math.abs(draft.y1 - draft.y0)}
          />
        )}
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
