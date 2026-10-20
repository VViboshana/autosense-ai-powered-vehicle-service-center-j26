/** Shapes returned by /api/inspections (backend/src/modules/inspections/inspections.repository.ts). */
export type DamageLabel = 'dent' | 'scratch' | 'crack' | 'glass_shatter' | 'lamp_broken' | 'tire_flat';
export type Severity = 'minor' | 'moderate' | 'severe';
export type SeverityValue = Severity | 'unavailable' | null;
export type InspectionStatus = 'draft' | 'processing' | 'awaiting_review' | 'confirmed' | 'failed';
export type ViewAngle = 'front' | 'rear' | 'left' | 'right' | 'other';
export type ReviewStatus = 'pending' | 'confirmed' | 'corrected' | 'rejected';

export type InspectionListItem = {
  inspectionId: number;
  inspectionNo: string;
  status: InspectionStatus;
  overallSeverity: SeverityValue;
  registrationNo: string;
  vehicle: string;
  jobNo: string | null;
  imageCount: number;
  thumbnailUrl: string | null;
  detectionCount: number;
  pendingCount: number;
  possibleCount: number;
  createdBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type Detection = {
  detectionId: number;
  label: DamageLabel;
  confidence: number | null;
  bbox: number[];
  polygon: number[][] | null;
  areaPx: number | null;
  areaRatioVehicle: number | null;
  location: string | null;
  severity: SeverityValue;
  severityReason: string | null;
  source: 'model' | 'technician';
  /** Possible damage: the model was less sure (confidence below the normal threshold). */
  suggestion: boolean;
  reviewStatus: ReviewStatus;
  correctedLabel: DamageLabel | null;
  correctedSeverity: Severity | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type InspectionImage = {
  imageId: number;
  viewAngle: ViewAngle;
  width: number | null;
  height: number | null;
  quality: { passed?: boolean; blurVar?: number; brightness?: number; warnings?: string[] };
  processingMs: number | null;
  url: string;
  detections: Detection[];
};

export type InspectionDetail = {
  inspectionId: number;
  inspectionNo: string;
  status: InspectionStatus;
  overallSeverity: SeverityValue;
  severityMethod: string | null;
  severityValidated: boolean;
  registrationNo: string;
  vehicle: { vehicleId: number; registrationNo: string; description: string };
  job: { jobId: number; jobNo: string } | null;
  model: { name: string; version: string } | null;
  createdBy: string | null;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  images: InspectionImage[];
};

export type VehicleOption = {
  jobId: number;
  jobNo: string;
  vehicleId: number;
  registrationNo: string;
  vehicle: string;
  customer: string | null;
  stage: string;
  checkedInAt: string;
  inspectionCount: number;
};
