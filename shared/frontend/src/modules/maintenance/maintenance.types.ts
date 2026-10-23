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
  durationHours?: number;
  durationStatus?: 'awaiting_task_selection' | 'evaluated' | string;
  durationVariant?: string;
  durationBenchmark?: boolean;
  durationTargetType?: string;
  candidateTasks?: MaintenanceTask[];
  taskSelection?: { status: string; required: boolean };
  assessmentType?: 'basic' | 'enriched';
  dataMode?: 'sample' | 'live';
  model?: { task: string; algorithm: string; variant: 'basic' | 'enriched' };
  serviceHistory: ServiceHistoryRecord[];
  inspection?: InspectionSummary;
  problemDescription: string;
  reviewNote?: string;
};

export type MaintenanceForecastRequest = {
  vehicleId?: number;
  bookingId?: number;
  jobId?: number;
  inspectionId?: number;
  vehicle: { registration?: string; make: string; model: string; year: number; mileage?: number };
  customerReport: { problemDescription: string; severity: string; firstNoticed?: string; warningLightVisible?: boolean; notes?: string };
  serviceHistory?: { available: boolean; summary?: string };
  diagnostics?: { ecuData?: unknown; diagnosis?: string };
  inspection?: { linked: boolean; inspectionId?: string };
};

export type MaintenanceTask = {
  fixTitle: string;
  difficultyLevel: string;
  probabilityRank: number;
  partsCostMinUsd?: number | null;
  partsCostMaxUsd?: number | null;
};

export type MaintenanceHealth = {
  status: string;
  service?: string;
  modelsLoaded: boolean;
  categoryModel?: string;
  durationPrimaryModel?: string;
  durationFallbackModel?: string;
  taskCatalogue?: string;
};

export type MaintenanceModelInfo = {
  service: string;
  task: string;
  primaryModel: string;
  variants: { name: string; available: boolean; ready?: boolean; preprocessorReady?: boolean }[];
  classes: string[];
  durationModel: string | {
    status: string;
    algorithm: string;
    primaryVariant: string;
    fallbackVariant: string;
    targetType: string;
    benchmark: boolean;
    primaryCvMetrics?: Record<string, number>;
    fallbackCvMetrics?: Record<string, number>;
  };
  taskCatalogue?: { status: string; supportedCategories: string[] };
};

export type MaintenanceForecastResponse = {
  forecastId?: number;
  assessmentType: 'basic' | 'enriched';
  maintenanceCategory: { predicted: string; modelScore: number; scores: Record<string, number> };
  maintenanceRequired: { status: string; reason?: string | null; value?: null };
  engineCondition: { status: string; reason?: string | null; label?: string | null };
  duration: { status: string; minutes?: number | null; estimatedHours?: number | null; estimatedMinutes?: number | null };
  taskSelection: { status: string; required: boolean; candidateTasks: MaintenanceTask[] };
  informationSources: Record<string, boolean>;
  model: { task: string; algorithm: string; variant: 'basic' | 'enriched' };
};

export type MaintenanceTaskListResponse = {
  category: string;
  count: number;
  taskSelectionRequired: boolean;
  candidateTasks: MaintenanceTask[];
};

export type MaintenanceDurationResponse = {
  status: 'evaluated';
  task: { fixTitle: string; category: string; difficultyLevel: string; probabilityRank: number };
  duration: { estimatedHours: number; estimatedMinutes: number };
  model: { algorithm: string; variant: string };
  benchmark: boolean;
  targetType: string;
};

export type ForecastDraft = {
  vehicleId?: number;
  bookingId?: number;
  /** The visit (job) at the centre this forecast is for; absent for a preliminary forecast from a booking */
  jobId?: number;
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
  serviceHistoryAvailable: boolean;
  serviceHistorySummary: string;
  inspectionId: string;
  brakeCondition: Condition;
  batteryCondition: Condition;
  tireCondition: Condition;
  inspectionLinked: boolean;
};
