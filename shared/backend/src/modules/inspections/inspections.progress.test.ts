import { describe, expect, it } from 'vitest';
import type { DamagePrediction, SoundAnalysis } from '../../integrations/ml/damageService.js';
import { progressReporter, readProgress, silentReporter } from './inspections.progress.js';

const region = (possible: boolean, onVehicle = true) => ({ possible, onVehicle }) as DamagePrediction['detections'][number];
const photo = {
  model: { version: 'yolo11-seg', placeholder: false },
  detections: [region(false), region(false), region(true), region(false, false)],
  processingMs: 512.4,
} as DamagePrediction;
const sound = {
  windows: 9,
  familiarity: { familiar: true },
  result: { label: 'misfire', confidence: 0.82, sure: true },
  processingMs: 840,
} as SoundAnalysis;

describe('live analysis progress', () => {
  it('reports each photo and recording as it is analysed, then the inspection', () => {
    const r = progressReporter(7, 'abc12345-test');
    r.start(1, 1);
    expect(readProgress(7, 'abc12345-test')).toMatchObject({ stage: 'photos', photos: { total: 1, done: [] }, sounds: { total: 1 } });
    r.photo('front', photo);
    const p = readProgress(7, 'abc12345-test');
    expect(p.stage).toBe('sounds');
    // regions on another car are not counted; possible damage is counted apart
    expect(p.photos.done).toEqual([{ viewAngle: 'front', regions: 2, possible: 1, ms: 512, model: 'yolo11-seg' }]);
    r.sound('idling', sound);
    expect(readProgress(7, 'abc12345-test').sounds.done[0]).toMatchObject({ situation: 'idling', label: 'misfire', sure: true, familiar: true, windows: 9 });
    r.saving();
    r.done(45);
    expect(readProgress(7, 'abc12345-test')).toMatchObject({ stage: 'done', inspectionId: 45 });
  });

  it('is private to the user who started it', () => {
    progressReporter(7, 'private-001').start(2, 0);
    expect(readProgress(8, 'private-001').stage).toBe('waiting');
  });

  it('ignores a missing or malformed progress id', () => {
    expect(progressReporter(7, undefined)).toBe(silentReporter);
    expect(progressReporter(7, '../../x')).toBe(silentReporter);
  });
});
