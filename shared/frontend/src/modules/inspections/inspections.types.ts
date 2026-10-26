/** Shapes returned by /api/inspections (backend/src/modules/inspections/inspections.repository.ts). */
export type DamageLabel = 'dent' | 'scratch' | 'crack' | 'glass_shatter' | 'lamp_broken' | 'tire_flat';
export type Severity = 'minor' | 'moderate' | 'severe';
export type SeverityValue = Severity | 'unavailable' | null;
export type InspectionStatus = 'draft' | 'processing' | 'awaiting_review' | 'confirmed' | 'failed';
export type ViewAngle = 'front' | 'rear' | 'left' | 'right' | 'other';
export type ReviewStatus = 'pending' | 'confirmed' | 'corrected' | 'rejected';

/** Repair guide (backend inspections.repair.ts, repair-v0): from the final damage type and severity. */
export type Priority = 'before_driving' | 'soon' | 'planned' | 'cosmetic';
export type Hours = [number, number];
export type AreaRepair = { priority: Priority; why: string; service: string | null; effortHours: Hours | null };
export type RepairPlan = {
  method: string;
  /** False until the service centre's technician has confirmed the rules and the hours */
  validated: boolean;
  priority: Priority | null;
  services: { code: string; name: string; areas: number; priority: Priority; effortHours: Hours | null }[];
  effortHours: Hours | null;
  notEstimated: number;
};

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
  /** Null for rejected regions and undecided possible damage */
  repair: AreaRepair | null;
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
  /** For the whole inspection, from its damaged areas (overlapping regions of one damage count once) */
  repair: RepairPlan;
  /** Sound recordings made with the inspection, at most one per situation */
  sounds: SoundCheck[];
  /** Mechanical repair guide from the sound findings (sound-repair-v0), kept apart from the body-damage plan */
  mechanical: MechanicalPlan;
  /** What the maintenance forecast receives (inspection-handover-v1); a draft until the inspection is confirmed */
  handover: Handover;
};

export type Handover = {
  version: string;
  final: boolean;
  confirmedAt: string | null;
  safeToDrive: { safe: boolean; reasons: string[] };
  /** Ready for the forecast's "technician diagnosis" */
  diagnosis: string;
  /** Sound faults in the forecast model's categories */
  categoryHints: { category: string; because: string[] }[];
  work: {
    bodyHours: Hours | null;
    mechanicalHours: Hours | null;
    totalHours: Hours | null;
    services: { code: string; name: string; kind: 'body' | 'mechanical'; priority: Priority; effortHours: Hours | null }[];
  };
  /** Proposed (parts-v0): a guide, not a quote or an order */
  parts: { part: string; quantity: number; for: string[]; kind: 'body' | 'mechanical' }[];
  methods: { severity: string | null; repair: string; mechanical: string; parts: string; validated: boolean };
};

export type MechanicalPlan = {
  method: string;
  validated: boolean;
  priority: Priority | null;
  items: { situation: SoundSituation; label: SoundLabel; name: string; priority: Priority; why: string; service: string; effortHours: Hours }[];
  services: { code: string; name: string; faults: number; priority: Priority; effortHours: Hours | null }[];
  effortHours: Hours | null;
};

/** Sound inspection (backend inspections.sound.ts): the technician picks what the vehicle was doing. */
export type SoundSituation = 'starting' | 'idling' | 'braking';
export type SoundLabel =
  | 'normal_start' | 'bad_ignition' | 'dead_battery'
  | 'normal_idle' | 'low_oil' | 'power_steering' | 'serpentine_belt' | 'misfire' | 'tappet'
  | 'normal_brakes' | 'worn_brakes';

export type SoundCheck = {
  soundCheckId: number;
  situation: SoundSituation;
  url: string;
  durationS: number | null;
  quality: { passed?: boolean; warnings?: string[] };
  /** The model's answer; finalLabel is after review (null when rejected) */
  label: SoundLabel;
  confidence: number;
  /** Confidence at or above the service's "sure" level (0.7) */
  sure: boolean;
  /** False when it did not sound like the engine-bay recordings the model learned from (then never "sure") */
  familiar: boolean | null;
  probabilities: { label: SoundLabel; probability: number }[];
  reviewStatus: ReviewStatus;
  correctedLabel: SoundLabel | null;
  finalLabel: SoundLabel | null;
  name: string;
  advice: string;
  normal: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type VehicleOption = {
  jobId: number;
  jobNo: string;
  vehicleId: number;
  registrationNo: string;
  vehicle: string;
  customer: string | null;
  stage: string;
  /** The bay the vehicle is in, while it is in one */
  bay: string | null;
  checkedInAt: string;
  inspectionCount: number;
};
