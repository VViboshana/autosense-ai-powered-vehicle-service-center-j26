import { useRef, useState, type MouseEvent } from 'react';
import type { Bay, Point } from './occupancy.types';

/**
 * One frame of a camera with the bay outlines drawn on top. Outlines are stored normalised (0..1 of the frame), so
 * the SVG uses the frame's own pixel size as its coordinate system and scales them up; they line up at any display size.
 *
 * With `draft` set (drawing mode), each click adds a corner of the outline being drawn; the page shows the buttons to
 * finish, undo or cancel.
 */
export function BayCanvas({ src, bays, selected, onSelect, draft, onAddPoint }: {
  src: string;
  bays: Bay[];
  selected: number | null;
  onSelect: (bayId: number) => void;
  draft: Point[] | null;
  onAddPoint: (p: Point) => void;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const w = size?.w ?? 1280;
  const h = size?.h ?? 720;
  const fontSize = Math.max(14, Math.round(w / 55));
  const drawing = draft !== null;

  function click(e: MouseEvent<SVGSVGElement>) {
    if (!drawing) return;
    const r = svg.current!.getBoundingClientRect();
    const clamp = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;
    onAddPoint([clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]);
  }

  const toPx = (pts: Point[]) => pts.map(([x, y]) => `${x * w},${y * h}`).join(' ');

  return (
    <div className={`as-bay-canvas${drawing ? ' drawing' : ''}`} style={{ aspectRatio: `${w} / ${h}` }}>
      {failed ? (
        <div className="as-bay-canvas-missing">
          <i className="bi bi-camera-video-off" aria-hidden="true" />
          <span>No picture from this camera. Check its video source and that the occupancy service is running.</span>
        </div>
      ) : (
        <img
          src={src}
          alt="Camera view"
          draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          onError={() => setFailed(true)}
        />
      )}
      <svg
        ref={svg}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="group"
        aria-label={drawing ? 'Click each corner of the bay' : 'Bay outlines'}
        onClick={click}
      >
        {bays.filter((b) => b.polygon).map((b) => {
          const [cx, cy] = centre(b.polygon!);
          return (
            <g key={b.bayId} className={`as-bay-shape state-${b.state ?? 'none'}${selected === b.bayId ? ' on' : ''}${b.isActive ? '' : ' inactive'}`}
               onClick={(e) => { if (!drawing) { e.stopPropagation(); onSelect(b.bayId); } }}>
              <title>{`${b.code} · ${b.name}`}</title>
              <polygon points={toPx(b.polygon!)} />
              <text x={cx * w} y={cy * h} fontSize={fontSize} textAnchor="middle" dominantBaseline="middle">{b.code}</text>
            </g>
          );
        })}
        {draft && draft.length > 0 && (
          <g className="as-bay-draft">
            <polyline points={toPx(draft.length > 2 ? [...draft, draft[0]!] : draft)} />
            {draft.map(([x, y], i) => <circle key={i} cx={x * w} cy={y * h} r={Math.max(4, w / 250)} />)}
          </g>
        )}
      </svg>
    </div>
  );
}

function centre(pts: Point[]): Point {
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}
