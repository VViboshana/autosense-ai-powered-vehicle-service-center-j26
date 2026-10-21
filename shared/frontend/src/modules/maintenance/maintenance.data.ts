import type { ForecastDraft, MaintenanceForecast, ServiceHistoryRecord } from './maintenance.types';

export const SAMPLE_HISTORY: ServiceHistoryRecord[] = [
  { id: 'SR-1088', date: '2026-08-12', registrationNo: 'CAR-4581', customer: 'Nimal Perera', mileage: 81420, service: 'Brake inspection', category: 'Brakes', advisor: 'R. Fernando', notes: 'Front pads approaching service threshold.' },
  { id: 'SR-1014', date: '2026-05-22', registrationNo: 'CAR-4581', customer: 'Nimal Perera', mileage: 79210, service: 'Oil service', category: 'Engine', durationMinutes: 75, advisor: 'A. Silva', notes: 'Routine service completed.' },
  { id: 'SR-0972', date: '2026-02-06', registrationNo: 'CAR-1207', customer: 'K. Jayasinghe', mileage: 53210, service: 'Battery replacement', category: 'Battery', durationMinutes: 45, advisor: 'R. Fernando', notes: 'Battery replaced under service recommendation.' },
];

export const SAMPLE_FORECASTS: MaintenanceForecast[] = [
  {
    id: 'FRC-0024', registrationNo: 'CAR-4581', vehicle: 'Toyota Corolla 2018', customer: 'Nimal Perera', mileage: 85240,
    maintenanceRequired: true, category: 'Brakes', modelScore: 0.91, status: 'Awaiting review', updatedAt: '2026-10-18T10:42:00Z',
    sourceAvailability: { 'Customer report': true, 'Vehicle details': true, 'Service history': true, 'ECU diagnostics': false, 'Technician diagnosis': true, 'Inspection report': true },
    engineCondition: 'Condition class 1', categoryScores: [{ label: 'Brakes', score: 0.68 }, { label: 'Engine', score: 0.16 }, { label: 'Electrical', score: 0.08 }, { label: 'Battery', score: 0.05 }, { label: 'Transmission', score: 0.03 }],
    serviceHistory: SAMPLE_HISTORY.filter((r) => r.registrationNo === 'CAR-4581'), inspection: { id: 'INSP-0142', status: 'Completed', detectedIssue: 'Front brake wear', severity: 'Medium', reviewStatus: 'Technician review pending' }, problemDescription: 'Grinding noise when braking at low speed.',
  },
  {
    id: 'FRC-0023', registrationNo: 'CAR-1207', vehicle: 'Honda Fit 2020', customer: 'K. Jayasinghe', mileage: 54880,
    maintenanceRequired: true, category: 'Battery', modelScore: 0.84, status: 'Preliminary', updatedAt: '2026-10-18T09:15:00Z',
    sourceAvailability: { 'Customer report': true, 'Vehicle details': true, 'Service history': true, 'ECU diagnostics': true, 'Technician diagnosis': false, 'Inspection report': false },
    engineCondition: 'Condition class 0', categoryScores: [{ label: 'Battery', score: 0.71 }, { label: 'Electrical', score: 0.14 }, { label: 'Engine', score: 0.08 }, { label: 'Brakes', score: 0.04 }, { label: 'Transmission', score: 0.03 }],
    serviceHistory: SAMPLE_HISTORY.filter((r) => r.registrationNo === 'CAR-1207'), problemDescription: 'Vehicle takes longer to start than usual.',
  },
];

export const EMPTY_DRAFT: ForecastDraft = {
  registrationNo: '', make: '', model: '', year: '', mileage: '', customer: '', problemDescription: '', firstNoticed: '', warningLight: '', severity: '', notes: '', ecuCode: '', technicianDiagnosis: '', engineCondition: '', technicianNotes: '', serviceHistoryAvailable: false, serviceHistorySummary: '', inspectionId: '', brakeCondition: 'Unknown', batteryCondition: 'Unknown', tireCondition: 'Unknown', inspectionLinked: false,
};
