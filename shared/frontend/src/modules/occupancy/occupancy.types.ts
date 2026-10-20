/** Shapes returned by /api/occupancy (backend/src/modules/occupancy/occupancy.repository.ts). */
export type BayState = 'free' | 'occupied' | 'uncertain';
export type Point = [number, number];

export type Camera = {
  cameraId: number;
  code: string;
  name: string;
  location: string | null;
  sourceUrl: string | null;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
  isActive: boolean;
  bayCount: number;
};

export type Bay = {
  bayId: number;
  code: string;
  name: string;
  cameraId: number | null;
  cameraCode: string | null;
  /** Normalised 0..1 of the camera frame; null until drawn. */
  polygon: Point[] | null;
  displayOrder: number;
  isActive: boolean;
  state: BayState | null;
  since: string | null;
  overlap: number | null;
};

export type VideoJob = {
  videoJobId: number;
  cameraId: number | null;
  cameraName: string | null;
  sourcePath: string;
  sampleFps: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  framesProcessed: number;
  totalFrames: number | null;
  error: string | null;
  modelVersion: string | null;
  /** Frames greyed out outside the bays before detection; null = not recorded (older jobs). */
  roiMask: boolean | null;
  /** Replaying the video as a live camera until stopped (no end, no total frames). */
  live: boolean;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  transitions: number;
};

/** The occupancy.rules setting (GET/PUT /api/occupancy/rules). Optional values: the service uses its default. */
export type OccupancyRules = {
  overlapThreshold: number;
  releaseThreshold?: number;
  confirmOccupiedSeconds: number;
  confirmFreeSeconds: number;
  toleranceSeconds?: number;
  minSupport?: number;
  staleAfterSeconds?: number;
  sampleFps: number;
  /** Move the only waiting vehicle into the only newly occupied bay without asking staff (off unless switched on). */
  autoConfirm?: boolean;
};

/** GET /api/occupancy/service: the model the occupancy service runs. */
export type OccupancyServiceInfo = {
  version: string;
  placeholder: boolean;
  imgsz?: number;
  /** Missing when the service is a version without ROI masking. */
  roiMask?: { setting: string; default: boolean; marginPx: number };
};

/** GET /api/occupancy/bays/:id/events: one confirmed change of a bay's state (newest first). */
export type BayEvent = {
  eventId: number;
  fromState: 'free' | 'occupied' | 'uncertain' | null;
  toState: 'free' | 'occupied' | 'uncertain';
  at: string;
  trackId: number | null;
  /** Share of the bay the vehicle covered when the change was confirmed. */
  overlap: number | null;
  evidence: string | null;
  videoJobId: number | null;
};

/** GET /api/occupancy/bay-suggestions: occupied bays with no job, each with the next vehicle in the queue. */
export type QueuedJob = {
  jobId: number;
  jobNo: string;
  registrationNo: string;
  vehicle: string;
  service: string;
  stage: 'waiting_for_bay' | 'checked_in';
  checkedInAt: string;
};
export type BaySuggestion = { bayId: number; code: string; name: string; since: string | null; overlap: number | null; suggestedJobId: number | null };
/** A bay the camera sees free while a job is still in it: the vehicle has probably left. */
export type BayRelease = {
  bayId: number; code: string; name: string; since: string | null; overlap: number | null;
  jobId: number; jobNo: string; registrationNo: string; vehicle: string; bayEnteredAt: string | null;
};
export type BaySuggestions = { suggestions: BaySuggestion[]; queue: QueuedJob[]; releases: BayRelease[] };

/** GET /api/occupancy/live: cameras replaying their video as a live camera, and the bays they watch. */
export type LiveCamera = { videoJobId: number; cameraId: number; cameraCode: string; cameraName: string; startedAt: string; bayIds: number[] };
