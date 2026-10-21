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
const taskCandidate = z.object({
  fixTitle: z.string(), difficultyLevel: z.string(), probabilityRank: z.number().int(),
  partsCostMinUsd: z.number().nullable().optional(), partsCostMaxUsd: z.number().nullable().optional(),
});
const fastApiResponse = z.object({
  assessmentType: z.enum(['basic', 'enriched']),
  prediction: z.object({ category: z.string(), modelScore: z.number(), categoryScores: z.record(z.string(), z.number()) }),
  maintenanceRequired: fastApiStatus,
  engineCondition: fastApiStatus,
  duration: fastApiStatus.extend({ estimatedHours: z.number().nullable().optional(), estimatedMinutes: z.number().int().nullable().optional() }),
  taskSelection: z.object({ status: z.string(), required: z.boolean(), candidateTasks: z.array(taskCandidate) }),
  informationSources: z.record(z.string(), z.boolean()),
});
const healthResponse = z.object({ status: z.string(), service: z.string().optional(), modelsLoaded: z.boolean(), categoryModel: z.string().optional(), durationPrimaryModel: z.string().optional(), durationFallbackModel: z.string().optional(), taskCatalogue: z.string().optional() });
const modelResponse = z.object({ service: z.string(), task: z.string(), primaryModel: z.string(), variants: z.array(z.object({ name: z.string(), available: z.boolean(), ready: z.boolean().optional(), preprocessorReady: z.boolean().optional() })), classes: z.array(z.string()), durationModel: z.union([z.string(), z.record(z.string(), z.unknown())]), taskCatalogue: z.record(z.string(), z.unknown()).optional() });
const taskResponse = z.object({ category: z.string(), count: z.number().int(), taskSelectionRequired: z.boolean(), candidateTasks: z.array(taskCandidate) });
const durationResponse = z.object({
  status: z.literal('evaluated'),
  task: z.object({ fixTitle: z.string(), category: z.string(), difficultyLevel: z.string(), probabilityRank: z.number().int() }),
  duration: z.object({ estimatedHours: z.number().nonnegative(), estimatedMinutes: z.number().int().nonnegative() }),
  model: z.object({ algorithm: z.string(), variant: z.string() }),
  benchmark: z.boolean(), targetType: z.string(),
});

export type MaintenanceForecastRequest = z.infer<typeof requestSchema>;
export type MaintenanceForecast = {
  assessmentType: 'basic' | 'enriched';
  maintenanceCategory: { predicted: string; modelScore: number; scores: Record<string, number> };
  maintenanceRequired: z.infer<typeof fastApiStatus> & { value: null };
  engineCondition: z.infer<typeof fastApiStatus>;
  duration: z.infer<typeof fastApiStatus> & { estimatedHours?: number | null; estimatedMinutes?: number | null };
  taskSelection: { status: string; required: boolean; candidateTasks: z.infer<typeof taskCandidate>[] };
  informationSources: Record<string, boolean>;
  model: { task: string; algorithm: string; variant: 'basic' | 'enriched' };
};

export type MaintenanceServiceHealth = z.infer<typeof healthResponse>;
export type MaintenanceModelInfo = z.infer<typeof modelResponse>;
export type MaintenanceTaskResponse = z.infer<typeof taskResponse>;
export type MaintenanceDurationResponse = z.infer<typeof durationResponse>;

const DEFAULT_TIMEOUT_MS = 10_000;
const serviceUnavailable = 'Maintenance prediction service is currently unavailable.';

function endpoint(baseUrl: string | undefined, path: string) {
  if (!baseUrl) throw new ServiceUnavailableError('MAINTENANCE_SERVICE_NOT_CONFIGURED', 'The maintenance prediction service is not configured.');
  return new URL(path, baseUrl);
}

async function upstreamFailure(response: Response, fallback: string): Promise<never> {
  const body = await readJson(response);
  const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : fallback;
  if (response.status === 404) throw new AppError(404, 'MAINTENANCE_RESOURCE_NOT_FOUND', detail);
  if (response.status === 422) throw new ValidationError(detail);
  if (response.status === 503) throw new ServiceUnavailableError('MAINTENANCE_MODELS_UNAVAILABLE', detail);
  throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_GATEWAY', fallback);
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

  if (!response.ok) return upstreamFailure(response, 'The maintenance prediction service returned an unexpected error.');
  const body = await readJson(response);

  const parsed = fastApiResponse.safeParse(body);
  if (!parsed.success) throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_RESPONSE', 'The maintenance prediction service sent an unexpected result.');
  const result = parsed.data;
  return {
    assessmentType: result.assessmentType,
    maintenanceCategory: { predicted: result.prediction.category, modelScore: result.prediction.modelScore, scores: result.prediction.categoryScores },
    maintenanceRequired: { ...result.maintenanceRequired, value: null },
    engineCondition: result.engineCondition,
    duration: { ...result.duration, minutes: result.duration.estimatedMinutes ?? result.duration.minutes },
    taskSelection: result.taskSelection,
    informationSources: result.informationSources,
    model: { task: 'maintenance-category-classification', algorithm: 'XGBoost', variant: result.assessmentType },
  };
}

export async function maintenanceTasks(baseUrl: string | undefined, category: string, limit = 8, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MaintenanceTaskResponse> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ValidationError('limit must be between 1 and 20.');
  let response: Response;
  try {
    response = await fetch(endpoint(baseUrl, `/v1/tasks/${encodeURIComponent(category)}?limit=${limit}`), { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new GatewayTimeoutError('MAINTENANCE_SERVICE_TIMEOUT', 'Maintenance prediction service timed out.');
    throw new ServiceUnavailableError('MAINTENANCE_SERVICE_UNAVAILABLE', serviceUnavailable);
  }
  if (!response.ok) return upstreamFailure(response, 'The maintenance task catalogue request failed.');
  const parsed = taskResponse.safeParse(await readJson(response));
  if (!parsed.success) throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_RESPONSE', 'The maintenance prediction service sent an unexpected task result.');
  return parsed.data;
}

export function validateMaintenanceDuration(input: unknown): { fixTitle: string } {
  const parsed = z.object({ fixTitle: z.string().trim().min(1, 'Enter a repair task.').max(300) }).safeParse(input);
  if (!parsed.success) throw new ValidationError('Some values are not valid.', parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })));
  return parsed.data;
}

export async function maintenanceDuration(baseUrl: string | undefined, input: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MaintenanceDurationResponse> {
  const request = validateMaintenanceDuration(input);
  let response: Response;
  try {
    response = await fetch(endpoint(baseUrl, '/v1/duration'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new GatewayTimeoutError('MAINTENANCE_SERVICE_TIMEOUT', 'Maintenance prediction service timed out.');
    throw new ServiceUnavailableError('MAINTENANCE_SERVICE_UNAVAILABLE', serviceUnavailable);
  }
  if (!response.ok) return upstreamFailure(response, 'The maintenance duration request failed.');
  const parsed = durationResponse.safeParse(await readJson(response));
  if (!parsed.success) throw new AppError(502, 'MAINTENANCE_SERVICE_BAD_RESPONSE', 'The maintenance prediction service sent an unexpected duration result.');
  return parsed.data;
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
