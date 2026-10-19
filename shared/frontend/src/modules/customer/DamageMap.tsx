import type { CSSProperties } from 'react';
import type { InspectionReport } from './customer.types';
import { DAMAGE_NAMES, severityTone } from './customer.ui';
import { mapPosition, spread } from './mapPosition';
import { useTraceLengths } from './useTraceLengths';

type MapArea = InspectionReport['areas'][number];

/**
 * A top-down drawing of the car with each damaged area as a numbered marker on its side. The car draws itself, then
 * the markers drop in; severe ones pulse. Tapping a marker selects the area (the photo and the list follow).
 */
export function DamageMap({ areas, active, onSelect, onHover }: {
  areas: MapArea[];
  active: number | null;
  onSelect: (no: number) => void;
  onHover: (no: number | null) => void;
}) {
  const svg = useTraceLengths<SVGSVGElement>('.draw', 250, 90);
  const placed: { a: MapArea; x: number; y: number }[] = [];
  for (const a of areas) {
    const p = mapPosition(a.viewAngle, a.x);
    if (p) placed.push({ a, ...spread(p, a.viewAngle === 'front' || a.viewAngle === 'rear', placed) });
  }
  const closeUps = areas.filter((a) => !mapPosition(a.viewAngle, a.x));

  return (
    <figure className="cp-map">
      <svg ref={svg} viewBox="-6 -14 212 390" role="group" aria-label="Where the damage is on the car, seen from above, front at the top">
        <rect className="wheel" x="31" y="64" width="11" height="38" rx="4" />
        <rect className="wheel" x="158" y="64" width="11" height="38" rx="4" />
        <rect className="wheel" x="31" y="252" width="11" height="38" rx="4" />
        <rect className="wheel" x="158" y="252" width="11" height="38" rx="4" />
        <rect className="shell draw" x="40" y="20" width="120" height="320" rx="36" />
        <path className="line draw" d="M52 60 Q100 46 148 60" />
        <path className="part draw" d="M54 118 Q100 98 146 118 L140 152 Q100 141 60 152 Z" />
        <rect className="part draw" x="62" y="158" width="76" height="102" rx="10" />
        <path className="part draw" d="M60 268 Q100 279 140 268 L146 302 Q100 314 54 302 Z" />
        <path className="shell draw" d="M40 124 l-11 -4 v14 l11 2 M160 124 l11 -4 v14 l-11 2" />
        <path className="line draw" d="M48 30 q8 -6 20 -6 M152 30 q-8 -6 -20 -6 M50 334 h18 M150 334 h-18" />
        <text className="lbl" x="100" y="-4" textAnchor="middle">FRONT</text>
        <text className="lbl" x="100" y="372" textAnchor="middle">REAR</text>
        <text className="lbl" x="2" y="180" textAnchor="middle" transform="rotate(-90 2 180)">LEFT</text>
        <text className="lbl" x="198" y="180" textAnchor="middle" transform="rotate(90 198 180)">RIGHT</text>
        {placed.map(({ a, x, y }, i) => (
          <g
            key={a.no}
            className={`cp-pin cp-tone-${severityTone(a.severity)}${a.severity === 'severe' ? ' sev' : ''}${active === a.no ? ' on' : ''}`}
            tabIndex={0}
            role="button"
            aria-pressed={active === a.no}
            aria-label={`${a.no}. ${DAMAGE_NAMES[a.label] ?? a.label}, ${a.where}${a.severity ? `, ${a.severity}` : ''}`}
            onClick={() => onSelect(a.no)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect(a.no))}
            onPointerEnter={() => onHover(a.no)}
            onPointerLeave={() => onHover(null)}
          >
            <circle className="halo" cx={x} cy={y} r="11" />
            <g className="core" style={{ '--i': i } as CSSProperties}>
              <circle className="dot" cx={x} cy={y} r="11" />
              <text x={x} y={y + 3.8} textAnchor="middle">{a.no}</text>
            </g>
          </g>
        ))}
      </svg>
      <figcaption>
        {closeUps.length > 0 && <>Close-up: {closeUps.map((a) => a.no).join(', ')}. </>}
        Approximate. The side comes from the photo, the spot from where the damage is in it.
      </figcaption>
    </figure>
  );
}
