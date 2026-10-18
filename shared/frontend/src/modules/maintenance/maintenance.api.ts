import type { ForecastDraft, MaintenanceForecast, ServiceHistoryRecord } from './maintenance.types';
import { SAMPLE_FORECASTS, SAMPLE_HISTORY } from './maintenance.data';
export const MAINTENANCE_SAMPLE_MODE = true;
const forecasts = [...SAMPLE_FORECASTS];
export async function listForecasts(): Promise<MaintenanceForecast[]> { return forecasts; }
export async function getForecast(id: string): Promise<MaintenanceForecast | undefined> { return forecasts.find((forecast) => forecast.id === id); }
export async function listHistory(): Promise<ServiceHistoryRecord[]> { return SAMPLE_HISTORY; }
export async function getHistory(id: string): Promise<ServiceHistoryRecord | undefined> { return SAMPLE_HISTORY.find((record) => record.id === id); }
export async function createForecast(draft: ForecastDraft): Promise<MaintenanceForecast> {
  const sample = SAMPLE_FORECASTS[0]!;
  const created = { ...sample, maintenanceRequired: true, category: 'Brakes', id: `DEMO-${Date.now()}`, registrationNo: draft.registrationNo, vehicle: `${draft.make} ${draft.model} ${draft.year}`, customer: draft.customer || 'Not provided', mileage: Number(draft.mileage), status: 'Preliminary' as const, updatedAt: new Date().toISOString(), problemDescription: draft.problemDescription, sourceAvailability: { 'Customer report': true, 'Vehicle details': true, 'Service history': false, 'ECU diagnostics': Boolean(draft.ecuCode), 'Technician diagnosis': Boolean(draft.technicianDiagnosis), 'Inspection report': draft.inspectionLinked }, serviceHistory: [], inspection: undefined };
  forecasts.unshift(created);
  return created;
}
