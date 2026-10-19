import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { DamagePhoto } from './DamagePhoto';
import type { InspectionImage } from './inspections.types';
import { VIEW_ANGLES } from './inspections.ui';

const MIN = 1;
const MAX = 8;

/**
 * Full-screen photo viewer for checking fine damage: zoom (wheel, buttons or + / -) towards the pointer, drag to pan,
 * outlines and possible damage on or off, outline fill strength, and the previous / next photo (arrow keys).
 * Esc closes. The outlines are the same drawing as the page (photo pixels as coordinates), so they stay exactly on the
 * damage at any zoom.
 */
export function PhotoViewer({ images, index, numbers, selected, onSelect, onIndex, onClose }: {
  images: InspectionImage[];
  index: number;
  numbers: Map<number, string>;
  selected: number | null;
  onSelect: (detectionId: number) => void;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index]!;
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [outlines, setOutlines] = useState(true);
  const [possible, setPossible] = useState(true);
  const [fill, setFill] = useState(16);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  // A new photo starts unzoomed
  const [shown, setShown] = useState(index);
  if (shown !== index) {
    setShown(index);
    setView({ scale: 1, x: 0, y: 0 });
  }

  /** Zoom by `factor`, keeping the point under (cx, cy) (stage pixels) where it is. */
  function zoom(factor: number, cx?: number, cy?: number) {
    setView((v) => {
      const scale = Math.min(MAX, Math.max(MIN, v.scale * factor));
      if (scale === MIN) return { scale, x: 0, y: 0 };
      const r = stage.current!.getBoundingClientRect();
      const px = cx ?? r.width / 2;
      const py = cy ?? r.height / 2;
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoom(1.4);
      else if (e.key === '-') zoom(1 / 1.4);
      else if (e.key === '0') setView({ scale: 1, x: 0, y: 0 });
      else if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key.toLowerCase() === 'o') setOutlines((o) => !o);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation(); // the review shortcuts underneath must not react
    };
    document.addEventListener('keydown', onKey, true);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('modal-open');
    };
  });

  function onWheel(e: WheelEvent<HTMLDivElement>) {
    const r = stage.current!.getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top);
  }
  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (view.scale === MIN) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function onMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) {
      d.moved = true;
      // Capture only once it is a real drag, so a plain click still selects the outline under it
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (d.moved) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  }

  // What is drawn: no outlines at all, or every outline except (if hidden) possible damage
  const drawn = new Map([...numbers].filter(([, no]) => outlines && (possible || !no.startsWith('P'))));
  const w = image.width ?? 1280;
  const h = image.height ?? 960;

  return (
    <div className="as-viewer" role="dialog" aria-modal="true" aria-label={`${VIEW_ANGLES[image.viewAngle]} photo, full screen`}>
      <div className="as-viewer-bar">
        <b>{VIEW_ANGLES[image.viewAngle]}</b>
        <span className="as-viewer-count">{index + 1} / {images.length}</span>
        <div className="as-viewer-tools">
          <button type="button" className="btn btn-sm btn-outline-light" onClick={() => onIndex(index - 1)} disabled={index === 0} aria-label="Previous photo">
            <i className="bi bi-chevron-left" aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-sm btn-outline-light" onClick={() => onIndex(index + 1)} disabled={index === images.length - 1} aria-label="Next photo">
            <i className="bi bi-chevron-right" aria-hidden="true" />
          </button>
          <span className="as-viewer-sep" />
          <button type="button" className="btn btn-sm btn-outline-light" onClick={() => zoom(1 / 1.4)} disabled={view.scale === MIN} aria-label="Zoom out">
            <i className="bi bi-zoom-out" aria-hidden="true" />
          </button>
          <span className="as-viewer-zoom as-num">{Math.round(view.scale * 100)}%</span>
          <button type="button" className="btn btn-sm btn-outline-light" onClick={() => zoom(1.4)} disabled={view.scale === MAX} aria-label="Zoom in">
            <i className="bi bi-zoom-in" aria-hidden="true" />
          </button>
          <button type="button" className="btn btn-sm btn-outline-light" onClick={() => setView({ scale: 1, x: 0, y: 0 })} disabled={view.scale === MIN}>
            Fit
          </button>
          <span className="as-viewer-sep" />
          <label className="as-viewer-check">
            <input type="checkbox" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} /> Outlines
          </label>
          <label className="as-viewer-check">
            <input type="checkbox" checked={possible} disabled={!outlines} onChange={(e) => setPossible(e.target.checked)} /> Possible damage
          </label>
          <label className="as-viewer-check">
            Fill
            <input type="range" min={0} max={45} value={fill} disabled={!outlines} onChange={(e) => setFill(Number(e.target.value))} aria-label="Outline fill strength" />
          </label>
          <span className="as-viewer-sep" />
          <button type="button" className="btn btn-sm btn-light" onClick={onClose}>
            <i className="bi bi-x-lg me-1" aria-hidden="true" />Close
          </button>
        </div>
      </div>
      <div
        ref={stage}
        className={`as-viewer-stage${view.scale > MIN ? ' zoomed' : ''}`}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => {
          // Cleared after the click that may follow, so that click can still tell it ended a drag
          window.setTimeout(() => (drag.current = null));
        }}
        onPointerCancel={() => (drag.current = null)}
        onClickCapture={(e) => {
          if (drag.current?.moved) e.stopPropagation(); // the end of a drag is not a click on an outline
        }}
      >
        {/* The layer fills the stage and zooms from its top-left corner, so stage and layer coordinates match */}
        <div
          className="as-viewer-layer"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, ['--as-dmg-fill' as string]: fill / 100 }}
        >
          <div className="as-viewer-photo" style={{ width: `min(96vw, calc((100vh - 7rem) * ${w} / ${h}))` }}>
            <DamagePhoto image={image} numbers={drawn} selected={selected} onSelect={onSelect} />
          </div>
        </div>
      </div>
      <div className="as-viewer-hint">Scroll or + / − to zoom · drag to move · ← → photos · O outlines · Esc close</div>
    </div>
  );
}
