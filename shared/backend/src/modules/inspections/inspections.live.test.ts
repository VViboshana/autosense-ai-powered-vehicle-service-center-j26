import { describe, expect, it, vi } from 'vitest';
import type { DamagePrediction } from '../../integrations/ml/damageService.js';

const answer = vi.hoisted(() => ({ resolve: null as null | ((p: unknown) => void) }));
vi.mock('../../integrations/ml/damageService.js', () => ({
  analysePhoto: () => new Promise((resolve) => (answer.resolve = resolve)),
}));
const { liveFrame, summarise } = await import('./inspections.live.js');

const region = (label: string, confidence: number, onVehicle = true, possible = false) =>
  ({ label, confidence, bbox: [0, 0, 10, 10], polygon: [[0, 0], [10, 0], [10, 10]], onVehicle, possible }) as DamagePrediction['detections'][number];
const prediction = {
  image: { width: 640, height: 480 },
  vehicle: { bbox: [40, 40, 600, 440], areaPx: 153_600, cropped: false },
  quality: { passed: true, blurVar: 210, brightness: 120, warnings: [] },
  detections: [region('scratch', 0.4), region('dent', 0.8), region('dent', 0.9, false), region('crack', 0.15, true, true)],
  processingMs: 412.6,
} as unknown as DamagePrediction;

describe('live walk-around frame', () => {
  it('keeps damage on the vehicle, strongest first, and gives the vehicle its share of the frame', () => {
    const f = summarise(prediction);
    expect(f.vehicle).toEqual({ bbox: [40, 40, 600, 440], share: 0.5, cropped: false });
    expect(f.detections.map((d) => [d.label, d.confidence, d.possible])).toEqual([['dent', 0.8, false], ['scratch', 0.4, false], ['crack', 0.15, true]]);
    expect(f.ms).toBe(413);
  });

  it('answers "busy" while the same user\'s previous frame is still being analysed', async () => {
    const frame = { buffer: Buffer.from('x'), filename: 'frame.jpg', mimeType: 'image/jpeg' };
    const first = liveFrame('http://damage', 1, frame);
    expect((await liveFrame('http://damage', 1, frame)).busy).toBe(true);
    answer.resolve!(prediction);
    expect((await first).busy).toBe(false);
  });
});
