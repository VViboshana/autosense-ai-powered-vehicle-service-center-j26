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
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  transitions: number;
};
