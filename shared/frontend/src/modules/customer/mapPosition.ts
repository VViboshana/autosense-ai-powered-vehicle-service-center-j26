import type { ViewAngle } from './customer.types';

// The car on the damage map, seen from above, front at the top: body from x 40 to 160, y 20 to 340
const GAP = 25; // marker diameter plus a little room

/**
 * Where on the map an area's marker goes, approximately: the photo gives the side, and the area's place across the
 * photo (x, 0 to 1) gives the position along that side, turned to the car. Standing at the car's left, the left of the
 * photo is the car's front; facing its front, the left of the photo is the car's right side; and so on.
 */
export function mapPosition(view: ViewAngle, x: number): { x: number; y: number } | null {
  switch (view) {
    case 'front': return { x: 160 - x * 120, y: 6 };
    case 'rear': return { x: 40 + x * 120, y: 354 };
    case 'left': return { x: 22, y: 60 + x * 240 };
    case 'right': return { x: 178, y: 300 - x * 240 };
    default: return null; // a close-up has no side
  }
}

/**
 * Keeps markers apart: tries the spot, then alternately further along the side each way (+25, -25, +50, ...), staying
 * on the car's side. A fixed number of tries, so it always ends: on a crowded side markers overlap a little rather
 * than the page hanging.
 */
export function spread(p: { x: number; y: number }, alongX: boolean, placed: { x: number; y: number }[]) {
  const [min, max] = alongX ? [30, 170] : [40, 320];
  const base = alongX ? p.x : p.y;
  for (let k = 0; k < 12; k++) {
    const v = Math.min(max, Math.max(min, base + Math.ceil(k / 2) * GAP * (k % 2 ? 1 : -1)));
    const c = alongX ? { x: v, y: p.y } : { x: p.x, y: v };
    if (!placed.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < GAP)) return c;
  }
  return p;
}
