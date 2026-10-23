import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyseSound } from '../../integrations/ml/damageService.js';
import { soundReviewBody } from './inspections.routes.js';
import { audioExtensionFor, belongsTo, SOUND_FAULTS, SOUND_LABELS, SOUND_SITUATIONS } from './inspections.sound.js';

describe('sound faults', () => {
  it('has the same labels as the damage.sound_checks CHECK list (migration 0015)', () => {
    const sql = readFileSync(new URL('../../../../database/migrations/0015_sound_checks.sql', import.meta.url), 'utf8');
    const check = sql.match(/label\s+varchar\(20\)\s+NOT NULL CHECK \(label IN \(([^)]*)\)\)/)![1]!;
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual([...SOUND_LABELS].sort());
  });

  it('gives every situation one normal class and at least one fault', () => {
    for (const situation of SOUND_SITUATIONS) {
      const mine = SOUND_LABELS.filter((l) => SOUND_FAULTS[l].situation === situation);
      expect(mine.filter((l) => SOUND_FAULTS[l].normal)).toHaveLength(1);
      expect(mine.length).toBeGreaterThan(1);
    }
  });

  it('only lets a fault belong to its own situation', () => {
    expect(belongsTo('misfire', 'idling')).toBe(true);
    expect(belongsTo('misfire', 'braking')).toBe(false);
    expect(belongsTo('engine_knock', 'idling')).toBe(false);
  });

  it('stores browser WAV recordings as .wav', () => {
    expect(audioExtensionFor('audio/wav')).toBe('wav');
    expect(audioExtensionFor('audio/x-wav')).toBe('wav');
    expect(audioExtensionFor('audio/webm')).toBe('bin');
  });
});

describe('sound review body', () => {
  it('needs the fault when correcting', () => {
    expect(soundReviewBody.safeParse({ decision: 'corrected' }).success).toBe(false);
    expect(soundReviewBody.parse({ decision: 'corrected', label: 'worn_brakes' })).toEqual({ decision: 'corrected', label: 'worn_brakes' });
    expect(soundReviewBody.parse({ decision: 'rejected' })).toEqual({ decision: 'rejected' });
  });

  it('refuses an unknown fault', () => {
    expect(soundReviewBody.safeParse({ decision: 'corrected', label: 'engine_knock' }).success).toBe(false);
  });
});

describe('sound analysis client', () => {
  afterEach(() => vi.unstubAllGlobals());
  const sound = { buffer: Buffer.from('RIFF....WAVE'), filename: 'idling.wav', mimeType: 'audio/wav' };
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  const result = {
    model: { version: 'AutoSense Sound Inspection V1', experiment: 'F', trained: '2026-10-23' },
    situation: 'idling',
    quality: { passed: true, usable: true, durationS: 6.4, clippedRatio: 0, rms: 0.04, warnings: [] },
    windows: 7,
    result: { label: 'misfire', name: 'Engine misfire', confidence: 0.82, normal: false, sure: true, advice: '...', message: '...' },
    probabilities: [{ label: 'misfire', name: 'Engine misfire', probability: 0.82 }, { label: 'normal_idle', name: 'Normal idle', probability: 0.18 }],
    processingMs: 1400,
  };

  it('sends the recording and the situation, and returns the checked result', async () => {
    const fetchMock = reply(200, result);
    vi.stubGlobal('fetch', fetchMock);
    const out = await analyseSound('http://localhost:8001', sound, 'idling');
    expect(out.result).toMatchObject({ label: 'misfire', confidence: 0.82, sure: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://localhost:8001/analyze-audio?situation=idling');
    expect((init.body as FormData).get('audio')).toBeInstanceOf(Blob);
  });

  it('accepts an unusable recording (no result) so the caller can explain why', async () => {
    vi.stubGlobal('fetch', reply(200, { ...result, quality: { ...result.quality, usable: false, warnings: ['The recording is silent.'] }, result: null, probabilities: [], windows: 0 }));
    const out = await analyseSound('http://localhost:8001', sound, 'idling');
    expect(out.result).toBeNull();
    expect(out.quality.warnings).toEqual(['The recording is silent.']);
  });

  it('turns a service without a sound model (503) into SOUND_MODEL_NOT_READY', async () => {
    vi.stubGlobal('fetch', reply(503, { detail: 'Sound inspection is not installed.' }));
    await expect(analyseSound('http://localhost:8001', sound, 'idling')).rejects.toMatchObject({ status: 503, code: 'SOUND_MODEL_NOT_READY' });
  });

  it("passes on the service's message when it cannot read the recording (400)", async () => {
    vi.stubGlobal('fetch', reply(400, { detail: 'The file is not a readable recording (use WAV, FLAC or OGG).' }));
    await expect(analyseSound('http://localhost:8001', sound, 'idling')).rejects.toMatchObject({
      status: 400,
      message: 'idling.wav: The file is not a readable recording (use WAV, FLAC or OGG).',
    });
  });

  it('refuses a result in an unexpected format instead of storing it', async () => {
    vi.stubGlobal('fetch', reply(200, { ...result, result: { label: 'misfire' } }));
    await expect(analyseSound('http://localhost:8001', sound, 'idling')).rejects.toMatchObject({ code: 'DAMAGE_SERVICE_BAD_RESPONSE' });
  });
});
