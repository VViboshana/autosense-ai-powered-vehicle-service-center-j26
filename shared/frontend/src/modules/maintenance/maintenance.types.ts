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
  maintenanceRequiredStatus?: 'not_evaluated' | string;
  category: string;
  modelScore: number;
  status: ForecastStatus;
  updatedAt: string;
  sourceAvailability: Record<InformationSource, boolean>;
  engineCondition?: string;
  engineConditionStatus?: 'not_run' | string;
  engineConditionReason?: string;
  categoryScores: { label: string; score: number }[];
  durationMinutes?: number;
  durationStatus?: 'model_pending' | string;
  assessmentType?: 'basic' | 'enriched';
  dataMode?: 'sample' | 'live';
  model?: { task: string; algorithm: string; variant: 'basic' | 'enriched' };
  serviceHistory: ServiceHistoryRecord[];
  inspection?: InspectionSummary;
  problemDescription: string;
  reviewNote?: string;
};

export type MaintenanceForecastRequest = {
  vehicle: { registration?: string; make: string; model: string; year: number; mileage?: number };
  customerReport: { problemDescription: string; severity: string; firstNoticed?: string; warningLightVisible?: boolean; notes?: string };
  serviceHistory?: { available: boolean; summary?: string };
  diagnostics?: { ecuData?: unknown; diagnosis?: string };
  inspection?: { linked: boolean; inspectionId?: string };
};

export type MaintenanceForecastResponse = {
  assessmentType: 'basic' | 'enriched';
  maintenanceCategory: { predicted: string; modelScore: number; scores: Record<string, number> };
  maintenanceRequired: { status: string; reason?: string | null; value?: null };
  engineCondition: { status: string; reason?: string | null; label?: string | null };
  duration: { status: string; minutes?: number | null };
  informationSources: Record<string, boolean>;
  model: { task: string; algorithm: string; variant: 'basic' | 'enriched' };
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
