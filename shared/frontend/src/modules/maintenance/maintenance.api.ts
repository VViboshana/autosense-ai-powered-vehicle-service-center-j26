import { apiSend } from '@/lib/api';
import type { ForecastDraft, MaintenanceForecast, MaintenanceForecastRequest, MaintenanceForecastResponse, ServiceHistoryRecord } from './maintenance.types';
import { SAMPLE_FORECASTS, SAMPLE_HISTORY } from './maintenance.data';
export const MAINTENANCE_SAMPLE_MODE = true;
const forecasts = [...SAMPLE_FORECASTS];
export async function listForecasts(): Promise<MaintenanceForecast[]> { return forecasts; }
export async function getForecast(id: string): Promise<MaintenanceForecast | undefined> { return forecasts.find((forecast) => forecast.id === id); }
export async function listHistory(): Promise<ServiceHistoryRecord[]> { return SAMPLE_HISTORY; }
export async function getHistory(id: string): Promise<ServiceHistoryRecord | undefined> { return SAMPLE_HISTORY.find((record) => record.id === id); }
export async function createForecast(draft: ForecastDraft): Promise<MaintenanceForecast> {
  const payload: MaintenanceForecastRequest = {
    vehicle: { registration: draft.registrationNo.trim(), make: draft.make.trim(), model: draft.model.trim(), year: Number(draft.year), mileage: Number(draft.mileage) },
    customerReport: {
      problemDescription: draft.problemDescription.trim(), severity: draft.severity.trim(),
      ...(draft.firstNoticed ? { firstNoticed: draft.firstNoticed } : {}),
      ...(draft.warningLight === 'Yes' || draft.warningLight === 'No' ? { warningLightVisible: draft.warningLight === 'Yes' } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    },
    ...(draft.ecuCode.trim() || draft.technicianDiagnosis.trim() ? { diagnostics: { ...(draft.ecuCode.trim() ? { ecuData: draft.ecuCode.trim() } : {}), ...(draft.technicianDiagnosis.trim() ? { diagnosis: draft.technicianDiagnosis.trim() } : {}) } } : {}),
    ...(draft.inspectionLinked ? { inspection: { linked: true, inspectionId: 'INSP-0142' } } : {}),
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
    id: 'LIVE', registrationNo: draft.registrationNo, vehicle: `${draft.make} ${draft.model} ${draft.year}`, customer: draft.customer || 'Not provided', mileage: Number(draft.mileage),
    maintenanceRequired: false, maintenanceRequiredStatus: response.maintenanceRequired.status, category: response.maintenanceCategory.predicted, modelScore: response.maintenanceCategory.modelScore,
    status: 'Preliminary', updatedAt: new Date().toISOString(), sourceAvailability, engineCondition: response.engineCondition.label ?? undefined, engineConditionStatus: response.engineCondition.status, engineConditionReason: response.engineCondition.reason ?? undefined,
    categoryScores: Object.entries(response.maintenanceCategory.scores).map(([label, score]) => ({ label, score })), durationMinutes: response.duration.minutes ?? undefined, durationStatus: response.duration.status, serviceHistory: [], problemDescription: draft.problemDescription, assessmentType: response.assessmentType, dataMode: 'live', model: response.model,
  };
}
