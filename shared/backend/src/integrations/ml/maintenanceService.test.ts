import { afterEach, describe, expect, it, vi } from 'vitest';
import { maintenanceHealth, maintenanceModel, predictMaintenance } from './maintenanceService.js';

const basicRequest = {
  vehicle: { registration: 'TEST-001', make: 'Toyota', model: 'Corolla', year: 2018, mileage: 85000 },
  customerReport: { problemDescription: 'Grinding noise while braking', severity: 'High' },
};

const enrichedRequest = {
  ...basicRequest,
  serviceHistory: { available: true, summary: 'Brake inspection completed' },
  diagnostics: { ecuData: 'Unknown', diagnosis: 'Front brake pad wear' },
  inspection: { linked: true, inspectionId: 'INSP-0142' },
};

const response = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const result = (assessmentType: 'basic' | 'enriched') => ({
  assessmentType,
  prediction: { category: 'Battery', modelScore: 0.37, categoryScores: { Battery: 0.37, Brakes: 0.18, Electrical: 0.1, Engine: 0.17, Transmission: 0.18 } },
  maintenanceRequired: { status: 'not_evaluated', reason: 'not integrated' },
  engineCondition: { status: 'not_run', reason: 'not integrated' },
  duration: { status: 'model_pending' },
  informationSources: { customerReport: true, vehicleDetails: true, serviceHistory: assessmentType === 'enriched', ecuDiagnostics: false, technicianDiagnosis: assessmentType === 'enriched', inspectionReport: assessmentType === 'enriched' },
});

describe('maintenance prediction client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([['basic', basicRequest], ['enriched', enrichedRequest]])('forwards a valid %s request and preserves the real response', async (_name, input) => {
    const fetchMock = response(200, result(_name as 'basic' | 'enriched'));
    vi.stubGlobal('fetch', fetchMock);
    const out = await predictMaintenance('http://127.0.0.1:8003', input);
    expect(out.assessmentType).toBe(_name);
    expect(out.maintenanceCategory.predicted).toBe('Battery');
    expect(out.maintenanceRequired.status).toBe('not_evaluated');
    expect(out.duration.status).toBe('model_pending');
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: 'POST' }));
  });

  it('allows a basic request without enrichment fields', async () => {
    vi.stubGlobal('fetch', response(200, result('basic')));
    await expect(predictMaintenance('http://127.0.0.1:8003', basicRequest)).resolves.toMatchObject({ assessmentType: 'basic' });
  });

  it('rejects invalid required fields before calling FastAPI', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(predictMaintenance('http://127.0.0.1:8003', { ...basicRequest, vehicle: { ...basicRequest.vehicle, year: 1800 } })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps FastAPI failures without returning a fake prediction', async () => {
    vi.stubGlobal('fetch', response(503, { detail: 'unavailable' }));
    await expect(predictMaintenance('http://127.0.0.1:8003', basicRequest)).rejects.toMatchObject({ status: 503, code: 'MAINTENANCE_MODELS_UNAVAILABLE' });
  });

  it('maps network errors and timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(predictMaintenance('http://127.0.0.1:8003', basicRequest)).rejects.toMatchObject({ status: 503 });
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw timeout; }));
    await expect(predictMaintenance('http://127.0.0.1:8003', basicRequest)).rejects.toMatchObject({ status: 504, code: 'MAINTENANCE_SERVICE_TIMEOUT' });
  });

  it('proxies health and model metadata safely', async () => {
    vi.stubGlobal('fetch', response(200, { status: 'ok', service: 'maintenance-prediction', modelsLoaded: true }));
    await expect(maintenanceHealth('http://127.0.0.1:8003')).resolves.toMatchObject({ status: 'ok', modelsLoaded: true });
    vi.stubGlobal('fetch', response(200, { service: 'maintenance-prediction', task: 'maintenance-category-classification', primaryModel: 'XGBoost', variants: [{ name: 'basic', available: true }, { name: 'enriched', available: true }], classes: ['Battery', 'Brakes'], durationModel: 'not_available' }));
    await expect(maintenanceModel('http://127.0.0.1:8003')).resolves.toMatchObject({ primaryModel: 'XGBoost' });
  });
});
