/**
 * Turns the checked damage regions of one photo into the "damaged areas" a customer reads.
 *
 * The model often outlines one damage in several overlapping pieces (a long crack as five regions), and a technician
 * may confirm them all. For the customer, overlapping regions with the same damage type on the same photo are one area,
 * graded by its worst piece. Each area also gets a description of where it is on the car, in the car's own terms.
 */
export type ViewAngle = 'front' | 'rear' | 'left' | 'right' | 'other';
export type Region = {
  label: string;
  severity: string | null;
  bbox: number[]; // [x1, y1, x2, y2] in the photo's pixels
  polygon: number[][] | null;
  source: 'model' | 'technician';
};
export type Area = {
  label: string;
  severity: string | null;
  where: string;
  /** The area's centre across and down the photo, 0 to 1 (places the marker on the damage map). */
  x: number;
  y: number;
  bbox: [number, number, number, number];
  outlines: number[][][];
  marks: number;
  addedByTechnician: boolean;
};

const RANK: Record<string, number> = { minor: 1, moderate: 2, severe: 3 };
const worst = (a: string | null, b: string | null) => ((RANK[b ?? ''] ?? 0) > (RANK[a ?? ''] ?? 0) ? b : a);
const overlaps = (a: number[], b: number[]) => a[0]! <= b[2]! && b[0]! <= a[2]! && a[1]! <= b[3]! && b[1]! <= a[3]!;

export function groupRegions(regions: Region[], view: ViewAngle, width: number, height: number): Area[] {
  const groups: Region[][] = [];
  for (const r of regions) {
    const touching = groups.filter((g) => g[0]!.label === r.label && g.some((o) => overlaps(o.bbox, r.bbox)));
    if (!touching.length) {
      groups.push([r]);
      continue;
    }
    // r may join two groups that did not touch each other: merge them into the first
    const [keep, ...rest] = touching;
    keep!.push(r, ...rest.flat());
    for (const g of rest) groups.splice(groups.indexOf(g), 1);
  }
  return groups.map((g) => {
    const bbox: Area['bbox'] = [
      Math.min(...g.map((r) => r.bbox[0]!)),
      Math.min(...g.map((r) => r.bbox[1]!)),
      Math.max(...g.map((r) => r.bbox[2]!)),
      Math.max(...g.map((r) => r.bbox[3]!)),
    ];
    const x = (bbox[0] + bbox[2]) / 2 / width;
    const y = (bbox[1] + bbox[3]) / 2 / height;
    const label = g[0]!.label;
    return {
      label,
      severity: g.map((r) => r.severity).reduce(worst),
      where: describeWhere(view, label, x, y),
      x: round(x),
      y: round(y),
      bbox,
      outlines: g.map((r) => (r.polygon && r.polygon.length >= 3 ? r.polygon : boxOutline(r.bbox))),
      marks: g.length,
      addedByTechnician: g.some((r) => r.source === 'technician'),
    };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const boxOutline = ([x1 = 0, y1 = 0, x2 = 0, y2 = 0]: number[]) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * Where an area is on the car, from the side the photo shows and where the area is in it. Facing the front, the
 * photo's right is the car's left; facing the rear, it is the car's right; standing at the left side, the photo's left
 * is the front. Approximate: it assumes the photo was taken straight on, as the capture guide asks.
 */
export function describeWhere(view: ViewAngle, label: string, x: number, y: number): string {
  const third = x < 0.42 ? 0 : x > 0.58 ? 2 : 1;
  if (view === 'front' || view === 'rear') {
    const side = (view === 'front' ? ['right', 'centre', 'left'] : ['left', 'centre', 'right'])[third]!;
    if (label === 'lamp_broken') return `${side === 'centre' ? 'Centre' : cap(side)} ${view === 'front' ? 'headlight' : 'tail light'}`;
    if (label === 'glass_shatter') return view === 'front' ? 'Windscreen' : 'Rear windscreen';
    if (label === 'tire_flat') return `${cap(view)} ${side === 'centre' ? '' : `${side} `}tyre`;
    const part = view === 'front' ? (y < 0.55 ? 'Bonnet' : 'Front bumper') : (y < 0.55 ? 'Tailgate' : 'Rear bumper');
    return side === 'centre' ? `${part}, centre` : `${part}, ${side} side`;
  }
  if (view === 'left' || view === 'right') {
    const end = ['front', 'middle', 'rear'][view === 'left' ? third : 2 - third]!;
    if (label === 'tire_flat') return `${cap(view)} ${end === 'middle' ? '' : `${end} `}tyre`;
    return `${cap(view)} side, ${end === 'middle' ? 'middle' : `towards the ${end}`}`;
  }
  return 'Close-up photo';
}
