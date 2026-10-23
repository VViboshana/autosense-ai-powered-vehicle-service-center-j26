import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { calibration, damageFigures, soundFigures, type SoundDecision } from './ai.figures.js';
import { PACK_YAML, yoloLines } from './ai.pack.js';
import { zip } from './zip.js';

describe('calibration', () => {
  it('groups by confidence and measures how often each group was right', () => {
    const c = calibration([
      { confidence: 0.95, correct: true }, { confidence: 0.92, correct: true },
      { confidence: 0.55, correct: true }, { confidence: 0.52, correct: false },
    ]);
    const high = c.bins.find((b) => b.from === 0.9)!;
    const mid = c.bins.find((b) => b.from === 0.5)!;
    expect(high).toMatchObject({ count: 2, accuracy: 1, meanConfidence: 0.935 });
    expect(mid).toMatchObject({ count: 2, accuracy: 0.5 });
    // |1 - 0.935| * 2/4 + |0.5 - 0.535| * 2/4
    expect(c.ece).toBeCloseTo(0.05, 3);
  });

  it('is empty without decisions', () => {
    expect(calibration([])).toMatchObject({ count: 0, ece: null });
  });
});

describe('sound figures', () => {
  const d = (label: SoundDecision['label'], finalLabel: SoundDecision['finalLabel'], confidence = 0.8, familiar: boolean | null = true): SoundDecision =>
    ({ situation: label.includes('brake') ? 'braking' : 'idling', label, finalLabel, confidence, familiar });

  it('counts right, corrected and rejected results and fills the confusion matrix', () => {
    const f = soundFigures([d('misfire', 'misfire'), d('misfire', 'normal_idle'), d('worn_brakes', null), d('normal_brakes', 'normal_brakes')]);
    expect(f).toMatchObject({ reviewed: 4, correct: 2, corrected: 1, rejected: 1, accuracy: 0.5 });
    const idling = f.situations.find((s) => s.situation === 'idling')!;
    const at = (t: string, p: string) => idling.matrix[idling.labels.indexOf(t as never)]![idling.labels.indexOf(p as never)];
    expect(at('normal_idle', 'misfire')).toBe(1);
    expect(at('misfire', 'misfire')).toBe(1);
    expect(f.perFault.find((p) => p.label === 'misfire')).toMatchObject({ said: 2, precision: 0.5, recall: 1 });
  });

  it('reports how the odd-sound check did in real use', () => {
    const f = soundFigures([d('misfire', 'normal_idle', 0.6, false), d('misfire', 'misfire', 0.9, true)]);
    expect(f.familiarity).toEqual({ flagged: 1, flaggedWrong: 1, othersWrong: 0, others: 1 });
  });
});

describe('damage figures', () => {
  it('puts rejected regions under "not damage" and technician-drawn ones under "missed"', () => {
    const f = damageFigures([
      { label: 'dent', correctedLabel: null, reviewStatus: 'confirmed', source: 'model', isSuggestion: false, confidence: 0.9 },
      { label: 'glass_shatter', correctedLabel: null, reviewStatus: 'rejected', source: 'model', isSuggestion: false, confidence: 0.7 },
      { label: 'scratch', correctedLabel: null, reviewStatus: 'confirmed', source: 'technician', isSuggestion: false, confidence: null },
      { label: 'crack', correctedLabel: null, reviewStatus: 'rejected', source: 'model', isSuggestion: true, confidence: 0.15 }, // dismissed suggestion: left out
    ]);
    const cell = (t: string, p: string) => f.matrix[f.truths.indexOf(t)]![f.predicted.indexOf(p)];
    expect(cell('dent', 'dent')).toBe(1);
    expect(cell('not_damage', 'glass_shatter')).toBe(1);
    expect(cell('scratch', 'missed')).toBe(1);
    expect(f.calibration.count).toBe(2);
  });
});

describe('damage training pack', () => {
  it('writes YOLO segmentation lines with normalised points and the CarDD class numbers', () => {
    const lines = yoloLines([{ label: 'glass_shatter', polygon: [[0, 0], [50, 0], [50, 100]], bbox: [0, 0, 50, 100] }], 100, 200);
    expect(lines).toEqual(['3 0.000000 0.000000 0.500000 0.000000 0.500000 0.500000']);
  });

  it('turns a technician box into a four-point outline and skips unknown types', () => {
    const lines = yoloLines([{ label: 'dent', polygon: null, bbox: [10, 20, 30, 40] }, { label: 'rust', polygon: null, bbox: [0, 0, 1, 1] }], 100, 100);
    expect(lines).toEqual(['0 0.100000 0.200000 0.300000 0.200000 0.300000 0.400000 0.100000 0.400000']);
  });

  it('names the classes in the CarDD order', () => {
    expect(PACK_YAML).toContain('  0: dent\n  1: scratch\n  2: crack\n  3: glass_shatter\n  4: lamp_broken\n  5: tire_flat');
  });
});

describe('zip writer', () => {
  it('makes an archive with every file readable back', () => {
    const files = [{ name: 'labels/a.txt', data: Buffer.from('0 0.1 0.2') }, { name: 'data.yaml', data: Buffer.from('names: x') }];
    const z = zip(files);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    expect(z.readUInt32LE(z.length - 22)).toBe(0x06054b50);
    expect(z.readUInt16LE(z.length - 22 + 10)).toBe(2);
    // first entry: stored, so the bytes follow the 30-byte header and the name
    const nameLength = z.readUInt16LE(26);
    expect(z.subarray(30, 30 + nameLength).toString()).toBe('labels/a.txt');
    expect(z.subarray(30 + nameLength, 30 + nameLength + 9).toString()).toBe('0 0.1 0.2');
    expect(typeof inflateRawSync).toBe('function');
  });
});
