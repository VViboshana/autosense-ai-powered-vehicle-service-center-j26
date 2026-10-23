import { DAMAGE_LABELS } from '../inspections/inspections.rules.js';

/**
 * The damage training pack: confirmed inspections' photos with their FINAL regions as YOLO segmentation labels, the
 * same classes and order as the CarDD training (cardd.yaml: 0 dent ... 5 tire_flat). What the technicians taught:
 *   - corrected regions carry the corrected type;
 *   - damage the model missed (drawn by a technician as a box) becomes a box-shaped outline;
 *   - regions marked "not damage" are left out, so a photo of shiny glass where everything was rejected becomes a
 *     "nothing here" example (an empty label file) - exactly what reduces false alarms.
 * Coordinates are normalised by the photo's size after EXIF rotation (as stored); YOLO reads images the same way.
 */
export type PackRegion = { label: string; polygon: number[][] | null; bbox: number[] };

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function yoloLines(regions: PackRegion[], width: number, height: number): string[] {
  return regions
    .map((r) => {
      const cls = (DAMAGE_LABELS as readonly string[]).indexOf(r.label);
      if (cls < 0) return null;
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = r.bbox;
      const points = r.polygon && r.polygon.length >= 3 ? r.polygon : [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      return [cls, ...points.flatMap(([x = 0, y = 0]) => [clamp(x / width).toFixed(6), clamp(y / height).toFixed(6)])].join(' ');
    })
    .filter((l): l is string => l !== null);
}

export const PACK_YAML = `# AutoSense damage training pack: technician-reviewed photos from the app.
# Merge into the CarDD training set on Kaggle (same classes and order as cardd.yaml), e.g. copy
# images/ and labels/ into /kaggle/temp/cardd/{images,labels}/train2017 before training, then continue from best.pt.
path: .
train: images
val: images
names:
${DAMAGE_LABELS.map((l, i) => `  ${i}: ${l}`).join('\n')}
`;
