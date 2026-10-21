import type { ForecastDraft, ServiceHistoryRecord } from './maintenance.types';

/** No live sample records. Fixtures, if needed for isolated design work, belong in tests. */
export const EMPTY_DRAFT: ForecastDraft = {
  vehicleId: undefined, bookingId: undefined, jobId: undefined, registrationNo: '', make: '', model: '', year: '', mileage: '', customer: '',
  problemDescription: '', firstNoticed: '', warningLight: '', severity: '', notes: '', ecuCode: '', technicianDiagnosis: '',
  engineCondition: '', technicianNotes: '', serviceHistoryAvailable: false, serviceHistorySummary: '', inspectionId: '',
  brakeCondition: 'Unknown', batteryCondition: 'Unknown', tireCondition: 'Unknown', inspectionLinked: false,
};
export const SAMPLE_HISTORY: ServiceHistoryRecord[] = [];
