export type ForecastStatus = 'Preliminary' | 'Awaiting review' | 'Confirmed' | 'Needs inspection';
export type Condition = 'Good' | 'Attention required' | 'Poor' | 'Unknown';

export type InformationSource = 'Customer report' | 'Vehicle details' | 'Service history' | 'ECU diagnostics' | 'Technician diagnosis' | 'Inspection report';

export type ServiceHistoryRecord = {
  id: string;
  date: string;
  registrationNo: string;
  customer: string;
  mileage: number;
  service: string;
  category: string;
  durationMinutes?: number;
  advisor: string;
  notes: string;
};

export type InspectionSummary = {
  id: string;
  status: string;
  detectedIssue: string;
  severity: string;
  reviewStatus: string;
};

export type MaintenanceForecast = {
  id: string;
  registrationNo: string;
  vehicle: string;
  customer: string;
  mileage: number;
  maintenanceRequired: boolean;
  category: string;
  modelScore: number;
  status: ForecastStatus;
  updatedAt: string;
  sourceAvailability: Record<InformationSource, boolean>;
  engineCondition?: string;
  categoryScores: { label: string; score: number }[];
  durationMinutes?: number;
  serviceHistory: ServiceHistoryRecord[];
  inspection?: InspectionSummary;
  problemDescription: string;
  reviewNote?: string;
};

export type ForecastDraft = {
  registrationNo: string;
  make: string;
  model: string;
  year: string;
  mileage: string;
  customer: string;
  problemDescription: string;
  firstNoticed: string;
  warningLight: string;
  severity: string;
  notes: string;
  ecuCode: string;
  technicianDiagnosis: string;
  engineCondition: string;
  technicianNotes: string;
  brakeCondition: Condition;
  batteryCondition: Condition;
  tireCondition: Condition;
  inspectionLinked: boolean;
};
