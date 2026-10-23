import { afterEach, describe, expect, it, vi } from 'vitest';
import { maintenanceDuration, maintenanceHealth, maintenanceModel, maintenanceTasks, predictMaintenance } from './maintenanceService.js';

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
  duration: { status: 'awaiting_task_selection', estimatedHours: null, estimatedMinutes: null },
  taskSelection: { status: 'available', required: true, candidateTasks: [{ fixTitle: 'Replace brake pedal switch', difficultyLevel: 'Moderate DIY', probabilityRank: 3, partsCostMinUsd: 15, partsCostMaxUsd: 60 }] },
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
    expect(out.duration.status).toBe('awaiting_task_selection');
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

  it('proxies catalogue tasks and duration without client model features', async () => {
    const fetchMock = response(200, { category: 'Brakes', count: 1, taskSelectionRequired: true, candidateTasks: [{ fixTitle: 'Replace brake pedal switch', difficultyLevel: 'Moderate DIY', probabilityRank: 3, partsCostMinUsd: 15, partsCostMaxUsd: 60 }] });
    vi.stubGlobal('fetch', fetchMock);
    await expect(maintenanceTasks('http://127.0.0.1:8003', 'Brakes', 5)).resolves.toMatchObject({ count: 1 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'evaluated', task: { fixTitle: 'Replace brake pedal switch', category: 'Brakes', difficultyLevel: 'Moderate DIY', probabilityRank: 3 }, duration: { estimatedHours: 0.6, estimatedMinutes: 36 }, model: { algorithm: 'RandomForestRegressor', variant: 'task_plus_cost' }, benchmark: true, targetType: 'estimated_labor_hours' }), { status: 200 }));
    await expect(maintenanceDuration('http://127.0.0.1:8003', { fixTitle: 'Replace brake pedal switch', partsCostMidUsd: 1 })).resolves.toMatchObject({ status: 'evaluated' });
    expect(fetchMock).toHaveBeenLastCalledWith(expect.any(URL), expect.objectContaining({ body: JSON.stringify({ fixTitle: 'Replace brake pedal switch' }) }));
  });

  it('forwards unknown duration tasks as 404', async () => {
    vi.stubGlobal('fetch', response(404, { detail: 'Specific repair task not found.' }));
    await expect(maintenanceDuration('http://127.0.0.1:8003', { fixTitle: 'Made Up Repair Task XYZ' })).rejects.toMatchObject({ status: 404 });
  });
});
