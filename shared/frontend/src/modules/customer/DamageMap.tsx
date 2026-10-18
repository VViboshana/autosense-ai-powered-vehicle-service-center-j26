import type { ReportFinding } from './customer.types';
import { mapPosition } from './mapPosition';
import { SEVERITY_TONE } from './severity';

type MapFinding = ReportFinding & { viewAngle: string };

const GAP = 22; // marker diameter plus a little room

/**
 * Keeps markers apart: tries the spot, then alternately further along the side each way (+22, -22, +44, -44 ...),
 * staying on the car's side. A fixed number of tries, so it always ends: when a side is crowded, markers overlap a
 * little rather than the page hanging.
 */
function spread(p: { x: number; y: number }, alongX: boolean, placed: { x: number; y: number }[]) {
  const [min, max] = alongX ? [30, 170] : [40, 320];
  const base = alongX ? p.x : p.y;
  for (let k = 0; k < 12; k++) {
    const step = Math.ceil(k / 2) * GAP * (k % 2 ? 1 : -1);
    const v = Math.min(max, Math.max(min, base + step));
    const c = alongX ? { x: v, y: p.y } : { x: p.x, y: v };
    if (!placed.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < GAP)) return c;
  }
  return p;
}

/** A top-down drawing of the car with each confirmed finding as a numbered marker on its side. */
export function DamageMap({ findings }: { findings: MapFinding[] }) {
  const placed: { f: MapFinding; x: number; y: number }[] = [];
  for (const f of findings) {
    const p = mapPosition(f.viewAngle, f.location);
    if (!p) continue;
    placed.push({ f, ...spread(p, f.viewAngle === 'front' || f.viewAngle === 'rear', placed) });
  }
  const closeUps = findings.filter((f) => !mapPosition(f.viewAngle, f.location));

  return (
    <figure className="as-map">
      <svg viewBox="-4 -10 208 380" role="img" aria-label="Where the damage is on the vehicle, seen from above">
        <g className="as-map-car">
          <rect x="40" y="20" width="120" height="320" rx="34" />
          <path d="M54 118 Q100 98 146 118 L140 150 Q100 140 60 150 Z" />
          <path d="M60 268 Q100 278 140 268 L146 300 Q100 312 54 300 Z" />
          <rect x="62" y="156" width="76" height="104" rx="10" />
          <path d="M40 124 l-10 -4 v14 l10 2 M160 124 l10 -4 v14 l-10 2" />
          <rect x="32" y="62" width="9" height="36" rx="3" />
          <rect x="159" y="62" width="9" height="36" rx="3" />
          <rect x="32" y="252" width="9" height="36" rx="3" />
          <rect x="159" y="252" width="9" height="36" rx="3" />
        </g>
        <text className="as-map-label" x="100" y="-1" textAnchor="middle">FRONT</text>
        <text className="as-map-label" x="100" y="368" textAnchor="middle">REAR</text>
        <text className="as-map-label" x="6" y="180" textAnchor="middle" transform="rotate(-90 6 180)">LEFT</text>
        <text className="as-map-label" x="194" y="180" textAnchor="middle" transform="rotate(90 194 180)">RIGHT</text>
        {placed.map(({ f, x, y }) => (
          <g key={f.no} className={`as-map-mk as-tone-${SEVERITY_TONE[f.severity ?? ''] ?? 'muted'}`}>
            <title>{`${f.no}. ${f.label.replace('_', ' ')}${f.severity ? ` · ${f.severity}` : ''}`}</title>
            <circle cx={x} cy={y} r="11" />
            <text x={x} y={y + 4} textAnchor="middle">{f.no}</text>
          </g>
        ))}
      </svg>
      <figcaption>
        {closeUps.length > 0 && <>Close-up: {closeUps.map((f) => f.no).join(', ')}. </>}
        Approximate: the side comes from the photo, the position from where the damage is in it.
      </figcaption>
    </figure>
  );
}
