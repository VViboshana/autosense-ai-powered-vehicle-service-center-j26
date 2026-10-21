import { apiGet, apiSend } from '@/lib/api';
import type { ForecastDraft, MaintenanceDurationResponse, MaintenanceForecast, MaintenanceForecastRequest, MaintenanceForecastResponse, MaintenanceHealth, MaintenanceModelInfo, MaintenanceTaskListResponse, ServiceHistoryRecord } from './maintenance.types';
export const MAINTENANCE_SAMPLE_MODE = false;
export type VehicleBootstrap = { vehicle: { vehicleId: number; registrationNo: string; make: string; model: string; year: number | null; latestMileage: number | null; customer: { customerId: number; name: string } | null }; bookings: { bookingId: number; bookingNo: string; date: string; time: string; status: string; service: string; notes: string | null }[]; serviceHistory: ServiceHistoryRecord[]; inspections: { inspectionId: number; inspectionNo: string; status: string; severity: string | null; notes: string | null; reviewedAt: string | null }[] };
export type VehicleSearchResult = VehicleBootstrap['vehicle'];
export type AwaitingForecastBooking = { bookingId: number; bookingNo: string; vehicleId: number; registrationNo: string; make: string; model: string; customer: string; service: string; date: string; time: string; status: string; notes: string | null };
export function searchVehicles(search: string) { return apiGet<VehicleSearchResult[]>('/maintenance/vehicles/search', { search }); }
export function getVehicleBootstrap(vehicleId: number, bookingId?: number) { return apiGet<VehicleBootstrap>('/maintenance/vehicles/bootstrap', { vehicleId, bookingId }); }
export function listBookingsAwaitingForecast() { return apiGet<AwaitingForecastBooking[]>('/maintenance/bookings/awaiting-forecast'); }
export function updateVehicleYear(vehicleId: number, year: number) { return apiSend<{ vehicleId: number; year: number }>('PATCH', `/maintenance/vehicles/${vehicleId}`, { year }); }
export function listForecasts(): Promise<MaintenanceForecast[]> { return apiGet<MaintenanceForecast[]>('/maintenance/forecasts'); }
export async function getForecast(id: string): Promise<MaintenanceForecast | undefined> {
  const r = await apiGet<Record<string, unknown> | null>(`/maintenance/forecasts/${encodeURIComponent(id)}`);
  if (!r) return undefined;
  const categoryScores = r.category_scores && typeof r.category_scores === 'object' ? Object.entries(r.category_scores as Record<string, number>).map(([label, score]) => ({ label, score })) : [];
  return { id: String(r.forecast_id), registrationNo: String(r.registration_no), vehicle: `${String(r.make)} ${String(r.model)}${r.year ? ` · ${r.year}` : ''}`, customer: String(r.customer_name ?? 'Not recorded'), mileage: 0, maintenanceRequired: false, maintenanceRequiredStatus: 'not_evaluated', category: String(r.predicted_category), modelScore: Number(r.model_score), status: r.status === 'confirmed' ? 'Confirmed' : 'Preliminary', updatedAt: String(r.created_at), sourceAvailability: { 'Customer report': true, 'Vehicle details': true, 'Service history': Boolean(r.service_history), 'ECU diagnostics': false, 'Technician diagnosis': false, 'Inspection report': Boolean(r.inspection_id) }, categoryScores, durationMinutes: r.estimated_minutes == null ? undefined : Number(r.estimated_minutes), durationHours: r.estimated_hours == null ? undefined : Number(r.estimated_hours), durationStatus: r.estimated_minutes == null ? 'awaiting_task_selection' : 'evaluated', serviceHistory: [], problemDescription: String(r.problem_description), taskSelection: { status: r.selected_fix_title ? 'selected' : 'required', required: true }, candidateTasks: r.selected_fix_title ? [{ fixTitle: String(r.selected_fix_title), difficultyLevel: 'Confirmed', probabilityRank: 0 }] : [], dataMode: 'live' };
}
export async function listHistory(): Promise<ServiceHistoryRecord[]> { return []; }
export async function getHistory(_id: string): Promise<ServiceHistoryRecord | undefined> { return undefined; }
export function getMaintenanceHealth(): Promise<MaintenanceHealth> { return apiGet<MaintenanceHealth>('/maintenance/health'); }
export function getMaintenanceModelInfo(): Promise<MaintenanceModelInfo> { return apiGet<MaintenanceModelInfo>('/maintenance/model'); }
export function getMaintenanceTasks(category: string, limit = 8): Promise<MaintenanceTaskListResponse> { return apiGet<MaintenanceTaskListResponse>(`/maintenance/tasks/${encodeURIComponent(category)}`, { limit }); }
export function estimateMaintenanceDuration(fixTitle: string): Promise<MaintenanceDurationResponse> { return apiSend<MaintenanceDurationResponse>('POST', '/maintenance/duration', { fixTitle }); }
export async function createForecast(draft: ForecastDraft): Promise<MaintenanceForecast> {
  const payload: MaintenanceForecastRequest = {
    ...(draft.vehicleId ? { vehicleId: draft.vehicleId } : {}), ...(draft.bookingId ? { bookingId: draft.bookingId } : {}),
    vehicle: { registration: draft.registrationNo.trim(), make: draft.make.trim(), model: draft.model.trim(), year: Number(draft.year), mileage: Number(draft.mileage) },
    customerReport: {
      problemDescription: draft.problemDescription.trim(), severity: draft.severity.trim(),
      ...(draft.firstNoticed ? { firstNoticed: draft.firstNoticed } : {}),
      ...(draft.warningLight === 'Yes' || draft.warningLight === 'No' ? { warningLightVisible: draft.warningLight === 'Yes' } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    },
    ...(draft.serviceHistoryAvailable || draft.serviceHistorySummary.trim() ? { serviceHistory: { available: draft.serviceHistoryAvailable, ...(draft.serviceHistorySummary.trim() ? { summary: draft.serviceHistorySummary.trim() } : {}) } } : {}),
    ...(draft.ecuCode.trim() || draft.technicianDiagnosis.trim() ? { diagnostics: { ...(draft.ecuCode.trim() ? { ecuData: draft.ecuCode.trim() } : {}), ...(draft.technicianDiagnosis.trim() ? { diagnosis: draft.technicianDiagnosis.trim() } : {}) } } : {}),
    ...(draft.inspectionLinked ? { inspection: { linked: true, ...(draft.inspectionId.trim() ? { inspectionId: draft.inspectionId.trim() } : {}) } } : {}),
  };
  const response = await apiSend<MaintenanceForecastResponse>('POST', '/maintenance/forecasts', payload);
  const sourceAvailability = {
    'Customer report': Boolean(response.informationSources.customerReport),
    'Vehicle details': Boolean(response.informationSources.vehicleDetails),
    'Service history': Boolean(response.informationSources.serviceHistory),
    'ECU diagnostics': Boolean(response.informationSources.ecuDiagnostics),
    'Technician diagnosis': Boolean(response.informationSources.technicianDiagnosis),
    'Inspection report': Boolean(response.informationSources.inspectionReport),
  };
  return {
    id: String(response.forecastId ?? 'LIVE'), registrationNo: draft.registrationNo, vehicle: `${draft.make} ${draft.model} ${draft.year}`, customer: draft.customer || 'Not provided', mileage: Number(draft.mileage),
    maintenanceRequired: false, maintenanceRequiredStatus: response.maintenanceRequired.status, category: response.maintenanceCategory.predicted, modelScore: response.maintenanceCategory.modelScore,
    status: 'Preliminary', updatedAt: new Date().toISOString(), sourceAvailability, engineCondition: response.engineCondition.label ?? undefined, engineConditionStatus: response.engineCondition.status, engineConditionReason: response.engineCondition.reason ?? undefined,
    categoryScores: Object.entries(response.maintenanceCategory.scores).map(([label, score]) => ({ label, score })), durationMinutes: response.duration.estimatedMinutes ?? response.duration.minutes ?? undefined, durationHours: response.duration.estimatedHours ?? undefined, durationStatus: response.duration.status, candidateTasks: response.taskSelection.candidateTasks, taskSelection: { status: response.taskSelection.status, required: response.taskSelection.required }, serviceHistory: [], problemDescription: draft.problemDescription, assessmentType: response.assessmentType, dataMode: 'live', model: response.model,
  };
}
export function confirmForecast(id: string, body: { fixTitle: string; estimatedHours: number; estimatedMinutes: number; durationVariant: string; benchmark: boolean; targetType: string; note?: string }) { return apiSend<{ forecastId: number; status: string }>('POST', `/maintenance/forecasts/${id}/confirm`, body); }
