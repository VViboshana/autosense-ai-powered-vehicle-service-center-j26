import { describe, expect, it } from 'vitest';
import { describeWhere, groupRegions, type Region } from './inspections.areas.js';

const region = (label: string, bbox: number[], severity = 'moderate', source: Region['source'] = 'model'): Region => ({
  label,
  severity,
  bbox,
  polygon: null,
  source,
});

describe('grouping checked regions into damaged areas', () => {
  it('joins overlapping regions of the same damage into one area, graded by its worst piece', () => {
    // Five pieces of one bumper crack, as the model outlined INS-26-000025's front photo, and a dent beside them
    const areas = groupRegions(
      [
        region('crack', [877, 473, 945, 664]),
        region('crack', [880, 560, 916, 663]),
        region('dent', [766, 345, 909, 438], 'severe'),
        region('crack', [870, 459, 940, 592], 'severe'),
        region('crack', [893, 472, 941, 593]),
        region('crack', [849, 471, 919, 512]),
      ],
      'front',
      1408,
      768,
    );
    expect(areas.map((a) => [a.label, a.marks, a.severity])).toEqual([
      ['crack', 5, 'severe'],
      ['dent', 1, 'severe'],
    ]);
    expect(areas[0]!.bbox).toEqual([849, 459, 945, 664]);
    expect(areas[0]!.outlines).toHaveLength(5);
  });

  it('keeps different damage types apart even when they overlap', () => {
    const areas = groupRegions([region('dent', [0, 0, 100, 100]), region('scratch', [50, 50, 150, 150])], 'left', 1000, 1000);
    expect(areas).toHaveLength(2);
  });

  it('merges two groups that a later region connects', () => {
    const areas = groupRegions(
      [region('scratch', [0, 0, 10, 10]), region('scratch', [20, 0, 30, 10]), region('scratch', [5, 0, 25, 10])],
      'left',
      100,
      100,
    );
    expect(areas).toHaveLength(1);
    expect(areas[0]!.marks).toBe(3);
  });

  it('notes a region a technician drew, and outlines it by its box', () => {
    const [area] = groupRegions([region('crack', [116, 399, 210, 490], 'moderate', 'technician')], 'left', 1408, 768);
    expect(area!.addedByTechnician).toBe(true);
    expect(area!.outlines[0]).toEqual([[116, 399], [210, 399], [210, 490], [116, 490]]);
    expect(area!.where).toBe('Left side, towards the front');
  });
});

describe('where on the car', () => {
  it('turns the photo around to the car: facing the front, the right of the photo is the car left', () => {
    expect(describeWhere('front', 'lamp_broken', 0.67, 0.5)).toBe('Left headlight');
    expect(describeWhere('front', 'crack', 0.64, 0.73)).toBe('Front bumper, left side');
    expect(describeWhere('front', 'dent', 0.59, 0.51)).toBe('Bonnet, left side');
  });

  it('facing the rear, the right of the photo is the car right', () => {
    expect(describeWhere('rear', 'lamp_broken', 0.73, 0.49)).toBe('Right tail light');
    expect(describeWhere('rear', 'dent', 0.73, 0.73)).toBe('Rear bumper, right side');
    expect(describeWhere('rear', 'glass_shatter', 0.5, 0.28)).toBe('Rear windscreen');
  });

  it('along the sides, the front is on the left of a left-side photo and on the right of a right-side photo', () => {
    expect(describeWhere('left', 'dent', 0.66, 0.6)).toBe('Left side, towards the rear');
    expect(describeWhere('right', 'dent', 0.66, 0.6)).toBe('Right side, towards the front');
    expect(describeWhere('right', 'scratch', 0.5, 0.6)).toBe('Right side, middle');
    expect(describeWhere('left', 'tire_flat', 0.2, 0.8)).toBe('Left front tyre');
  });

  it('says nothing more for a close-up', () => {
    expect(describeWhere('other', 'scratch', 0.5, 0.5)).toBe('Close-up photo');
  });
});
