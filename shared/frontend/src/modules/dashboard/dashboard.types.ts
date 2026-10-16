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
  state: 'free' | 'occupied' | 'uncertain' | 'unknown';
  since: string | null;
  overlap: number | null;
  job: {
    jobNo: string;
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
  key: 'safety_alerts' | 'inspection_review' | 'maintenance_suggestions' | 'waiting_for_bay' | 'cameras_offline';
  connected: boolean;
  count: number;
  detail: string | null;
  at: string | null;
};

export type JobStage = 'checked_in' | 'inspected' | 'waiting_for_bay' | 'in_bay' | 'ready' | 'completed' | 'cancelled';

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
