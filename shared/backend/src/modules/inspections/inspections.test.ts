import type pg from 'pg';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app.js';
import { loadEnv } from '../../config/env.js';
import { analysePhoto } from '../../integrations/ml/damageService.js';
import { finalSeverity, formatInspectionNo, worstSeverity } from './inspections.rules.js';

describe('inspection rules', () => {
  it('takes the worst graded severity', () => {
    expect(worstSeverity(['minor', 'severe', 'moderate'])).toBe('severe');
    expect(worstSeverity(['minor', 'unavailable', null])).toBe('minor');
  });

  it("is 'unavailable' when nothing could be graded, and null when there is no damage", () => {
    expect(worstSeverity(['unavailable', null])).toBe('unavailable');
    expect(worstSeverity([null])).toBeNull();
    expect(worstSeverity([])).toBeNull();
  });

  it("uses the technician's correction and drops rejected regions", () => {
    expect(finalSeverity({ reviewStatus: 'corrected', severity: 'minor', correctedSeverity: 'severe' })).toBe('severe');
    expect(finalSeverity({ reviewStatus: 'corrected', severity: 'minor', correctedSeverity: null })).toBe('minor');
    expect(finalSeverity({ reviewStatus: 'rejected', severity: 'severe', correctedSeverity: null })).toBeNull();
  });

  it('numbers inspections by year (Sri Lanka time) and id', () => {
    expect(formatInspectionNo(123, new Date('2026-10-18T10:00:00Z'))).toBe('INS-26-000123');
    // 31 Dec 20:00 UTC is already 1 Jan in Colombo (UTC+5:30)
    expect(formatInspectionNo(7, new Date('2026-12-31T20:00:00Z'))).toBe('INS-27-000007');
  });
});

describe('damage service client', () => {
  afterEach(() => vi.unstubAllGlobals());
  const photo = { buffer: Buffer.from([0xff, 0xd8, 0xff]), filename: 'front.jpg', mimeType: 'image/jpeg' };
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  const result = {
    model: { version: 'expA_yolo11n_640', placeholder: false },
    image: { width: 640, height: 480 },
    quality: { passed: true, blurVar: 512.3, brightness: 121.4, warnings: [] },
    vehicle: null,
    detections: [{ label: 'dent', confidence: 0.87, bbox: [1, 2, 30, 40], polygon: [[1, 2], [30, 2], [30, 40]], areaPx: 900,
                   areaRatioImage: 0.003, vehicleOverlap: 1, onVehicle: true, areaRatioVehicle: 0.02, location: 'lower left',
                   severity: 'moderate', severityReason: 'dent covers 2.0% of the vehicle' }],
    severity: { overall: 'moderate', method: 'rule-v0', validated: false },
    processingMs: 340,
  };

  it('sends the photo as multipart and returns the checked result', async () => {
    const fetchMock = reply(200, result);
    vi.stubGlobal('fetch', fetchMock);
    const out = await analysePhoto('http://localhost:8001', photo);
    expect(out.detections[0]).toMatchObject({ label: 'dent', severity: 'moderate', onVehicle: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://localhost:8001/predict');
    expect((init.body as FormData).get('image')).toBeInstanceOf(Blob);
  });

  it('turns an unreachable service into 503 DAMAGE_SERVICE_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(analysePhoto('http://localhost:8001', photo)).rejects.toMatchObject({ status: 503, code: 'DAMAGE_SERVICE_UNAVAILABLE' });
  });

  it("passes on the service's message when it cannot read the photo (400)", async () => {
    vi.stubGlobal('fetch', reply(400, { detail: 'The file is not a readable image (use JPEG or PNG).' }));
    await expect(analysePhoto('http://localhost:8001', photo)).rejects.toMatchObject({
      status: 400,
      message: 'front.jpg: The file is not a readable image (use JPEG or PNG).',
    });
  });

  it('refuses a result in an unexpected format instead of storing it', async () => {
    vi.stubGlobal('fetch', reply(200, { ...result, detections: [{ label: 'dent' }] }));
    await expect(analysePhoto('http://localhost:8001', photo)).rejects.toMatchObject({ code: 'DAMAGE_SERVICE_BAD_RESPONSE' });
  });

  it('reports a missing ML_DAMAGE_URL clearly', async () => {
    await expect(analysePhoto(undefined, photo)).rejects.toMatchObject({ code: 'DAMAGE_SERVICE_NOT_CONFIGURED' });
  });
});

describe('inspections API protection', () => {
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgres://test@localhost/test' });
  const pool = { query: async () => ({ rows: [] }) } as unknown as pg.Pool;

  it('asks for sign-in before listing or creating inspections', async () => {
    const app = createApp(pool, env);
    expect((await request(app).get('/api/inspections')).status).toBe(401);
    const res = await request(app).post('/api/inspections').set('Origin', 'http://localhost:5173').attach('images', Buffer.from('x'), 'a.jpg');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});
