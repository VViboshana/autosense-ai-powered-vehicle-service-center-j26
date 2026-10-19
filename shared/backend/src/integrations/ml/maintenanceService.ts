import { z } from 'zod';
import { AppError, GatewayTimeoutError, ServiceUnavailableError, ValidationError } from '../../http/errors.js';

const requestSchema = z.object({
  vehicle: z.object({
    registration: z.string().trim().max(30).optional(),
    make: z.string().trim().min(1, 'Enter the vehicle make.').max(100),
    model: z.string().trim().min(1, 'Enter the vehicle model.').max(100),
    year: z.coerce.number().int().min(1886).max(2100),
    mileage: z.coerce.number().finite().min(0).optional(),
  }),
  customerReport: z.object({
    problemDescription: z.string().trim().min(1, 'Describe the problem.').max(2000),
    severity: z.string().trim().min(1, 'Enter the severity.').max(50),
    firstNoticed: z.string().trim().max(100).optional(),
    warningLightVisible: z.boolean().optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  serviceHistory: z.object({ available: z.boolean(), summary: z.string().trim().max(4000).optional() }).optional(),
  diagnostics: z.object({ ecuData: z.unknown().optional(), diagnosis: z.string().trim().max(2000).optional() }).optional(),
  inspection: z.object({ linked: z.boolean(), inspectionId: z.string().trim().max(100).optional() }).optional(),
});

const fastApiStatus = z.object({ status: z.string(), label: z.string().nullable().optional(), reason: z.string().nullable().optional(), minutes: z.number().int().nullable().optional() });
const fastApiResponse = z.object({
  assessmentType: z.enum(['basic', 'enriched']),
  prediction: z.object({ category: z.string(), modelScore: z.number(), categoryScores: z.record(z.string(), z.number()) }),
  maintenanceRequired: fastApiStatus,
  engineCondition: fastApiStatus,
  duration: fastApiStatus,
  informationSources: z.record(z.string(), z.boolean()),
});
const healthResponse = z.object({ status: z.string(), service: z.string().optional(), modelsLoaded: z.boolean() });
const modelResponse = z.object({ service: z.string(), task: z.string(), primaryModel: z.string(), variants: z.array(z.object({ name: z.string(), available: z.boolean() })), classes: z.array(z.string()), durationModel: z.string() });

export type MaintenanceForecastRequest = z.infer<typeof requestSchema>;
export type MaintenanceForecast = {
  assessmentType: 'basic' | 'enriched';
  maintenanceCategory: { predicted: string; modelScore: number; scores: Record<string, number> };
  maintenanceRequired: z.infer<typeof fastApiStatus> & { value: null };
  engineCondition: z.infer<typeof fastApiStatus>;
  duration: z.infer<typeof fastApiStatus>;
  informationSources: Record<string, boolean>;
  model: { task: string; algorithm: string; variant: 'basic' | 'enriched' };
};

export type MaintenanceServiceHealth = z.infer<typeof healthResponse>;
export type MaintenanceModelInfo = z.infer<typeof modelResponse>;

const DEFAULT_TIMEOUT_MS = 10_000;
const serviceUnavailable = 'Maintenance prediction service is currently unavailable.';

function endpoint(baseUrl: string | undefined, path: string) {
  if (!baseUrl) throw new ServiceUnavailableError('MAINTENANCE_SERVICE_NOT_CONFIGURED', 'The maintenance prediction service is not configured.');
  return new URL(path, baseUrl);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

export function validateMaintenanceRequest(input: unknown): MaintenanceForecastRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Some values are not valid.', parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
  }
  return parsed.data;
}

export async function predictMaintenance(baseUrl: string | undefined, input: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MaintenanceForecast> {
  const request = validateMaintenanceRequest(input);
  let response: Response;
  try {
    response = await fetch(endpoint(baseUrl, '/v1/forecast'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new GatewayTimeoutError('MAINTENANCE_SERVICE_TIMEOUT', 'Maintenance prediction service timed out.');
    }
    throw new ServiceUnavailableError('MAINTENANCE_SERVICE_UNAVAILABLE', serviceUnavailable);
  }

  const body = await readJson(response);
  if (response.status === 422) throw new ValidationError('The maintenance prediction request was rejected by the inference service.');
  if (response.status === 503) throw new ServiceUnavailableError('MAINTENANCE_MODELS_UNAVAILABLE', 'Maintenance prediction models are currently unavailable.');
  if (!response.ok) throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_GATEWAY', 'The maintenance prediction service returned an unexpected error.');

  const parsed = fastApiResponse.safeParse(body);
  if (!parsed.success) throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_RESPONSE', 'The maintenance prediction service sent an unexpected result.');
  const result = parsed.data;
  return {
    assessmentType: result.assessmentType,
    maintenanceCategory: { predicted: result.prediction.category, modelScore: result.prediction.modelScore, scores: result.prediction.categoryScores },
    maintenanceRequired: { ...result.maintenanceRequired, value: null },
    engineCondition: result.engineCondition,
    duration: result.duration,
    informationSources: result.informationSources,
    model: { task: 'maintenance-category-classification', algorithm: 'XGBoost', variant: result.assessmentType },
  };
}

export async function maintenanceHealth(baseUrl: string | undefined, timeoutMs = 2_000): Promise<MaintenanceServiceHealth> {
  let response: Response;
  try {
    response = await fetch(endpoint(baseUrl, '/health'), { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ServiceUnavailableError('MAINTENANCE_SERVICE_UNAVAILABLE', serviceUnavailable);
  }
  const body = healthResponse.safeParse(await readJson(response));
  if (!body.success) throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_RESPONSE', 'The maintenance prediction service sent an unexpected health result.');
  return body.data;
}

export async function maintenanceModel(baseUrl: string | undefined, timeoutMs = 2_000): Promise<MaintenanceModelInfo> {
  let response: Response;
  try {
    response = await fetch(endpoint(baseUrl, '/v1/model'), { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ServiceUnavailableError('MAINTENANCE_SERVICE_UNAVAILABLE', serviceUnavailable);
  }
  const body = modelResponse.safeParse(await readJson(response));
  if (!response.ok || !body.success) throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_RESPONSE', 'The maintenance prediction service sent an unexpected model result.');
  return body.data;
}
