/** Shapes returned by /api/dashboard/* and /api/jobs (see backend/src/modules/dashboard and jobs). */
export type DashboardSummary = {
  vehiclesToday: number;
  vehiclesSameTimeLastWeek: number;
  bays: { total: number; occupied: number; free: number; uncertain: number };
  awaitingReview: { count: number; oldestAt: string | null };
  timeInBay: { averageMinutes: number | null; jobsDone: number };
  safety: { connected: boolean; openAlerts: number };
};

export type BayCard = {
  bayId: number;
  code: string;
  name: string;
  /** The camera that watches this bay (null when none is set) */
  camera: { cameraId: number; code: string; name: string } | null;
  state: 'free' | 'occupied' | 'uncertain' | 'unknown';
  since: string | null;
  overlap: number | null;
  job: {
    jobId: number;
    jobNo: string;
    /** in_bay, inspecting or inspected (the stages in which the vehicle is in its bay) */
    stage: 'in_bay' | 'inspecting' | 'inspected';
    /** The job's latest damage inspection (component 2), or null when none was started */
    inspectionStatus: 'draft' | 'processing' | 'awaiting_review' | 'confirmed' | 'failed' | null;
    registrationNo: string;
    vehicle: string;
    service: string;
    bayEnteredAt: string | null;
    estimatedMinutes: number | null;
  } | null;
};

export type BayBoardData = {
  camera: { code: string; name: string; status: 'online' | 'offline' } | null;
  bays: BayCard[];
  nextInQueue: { jobNo: string; registrationNo: string; vehicle: string; waitingSince: string } | null;
};

export type ActionItem = {
  key: 'safety_alerts' | 'inspection_review' | 'maintenance_suggestions' | 'waiting_for_bay' | 'vehicle_requests' | 'cameras_offline';
  connected: boolean;
  count: number;
  detail: string | null;
  at: string | null;
};

export type JobStage = 'checked_in' | 'waiting_for_bay' | 'in_bay' | 'inspecting' | 'inspected' | 'ready' | 'completed' | 'cancelled';

export type JobListItem = {
  jobId: number;
  jobNo: string;
  registrationNo: string;
  vehicle: string;
  customer: string | null;
  service: string;
  stage: JobStage;
  bay: string | null;
  checkedInAt: string;
  estimatedMinutes: number | null;
  estimateLkr: number | null;
  advisor: string | null;
};
