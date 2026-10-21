import { z } from 'zod';
import { BusinessRuleError, ServiceUnavailableError } from '../../http/errors.js';

/**
 * Client for the bay occupancy service (member-1-occupancy, FastAPI). The API starts video jobs there and fetches
 * their progress (see occupancy.sync.ts); the service never writes to the database. Every response is checked
 * against a schema, so a changed service shows up as a clear error instead of bad rows. Never invent a result.
 */
const state = z.enum(['free', 'occupied', 'uncertain']);
const roiMask = z.object({ setting: z.string(), default: z.boolean(), marginPx: z.number().int() });
const plateReading = z.object({
  text: z.string().nullable(), core: z.string().nullable(), votes: z.number().int(), reads: z.number().int(),
  confidence: z.number().optional(), stable: z.boolean(), done: z.boolean(),
});
export type PlateReading = z.infer<typeof plateReading>;
const modelInfo = z.object({ version: z.string(), placeholder: z.boolean(), imgsz: z.number().int().optional(), roiMask: roiMask.optional(),
  plates: z.object({ setting: z.string(), enabled: z.boolean() }).optional() });
const transition = z.object({
  bayId: z.string(),
  fromState: state,
  toState: state,
  atSeconds: z.number().min(0),
  trackId: z.number().int().nullable(),
  overlap: z.number().min(0).max(1).nullable(),
  evidence: z.string(),
});
const job = z.object({
  jobId: z.string(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  error: z.string().nullable(),
  /** Frames greyed out outside the bays before detection; missing from service versions without masking. */
  roiMask: z.boolean().nullable().optional(),
  /** Replaying a recorded video as a live camera; missing from older service versions. */
  live: z.boolean().optional(),
  framesProcessed: z.number().int(),
  totalFrames: z.number().int().nullable(),
  streamSeconds: z.number(),
  bays: z.record(z.string(), z.object({
    state, confirming: state.nullable(), score: z.number(), trackId: z.number().int().nullable(),
    /** The parked vehicle's number plate as read so far (plates.py); missing from older service versions. */
    plate: plateReading.nullable().optional(),
  })),
  transitions: z.array(transition),
  transitionCount: z.number().int(),
});
const health = z.object({ status: z.literal('up'), model: modelInfo });

export type OccupancyTransition = z.infer<typeof transition>;
export type OccupancyJob = z.infer<typeof job>;
export type OccupancyModel = z.infer<typeof modelInfo>;
export type VideoJobRequest = {
  jobId: string;
  source: string;
  bays: { id: string; polygon: [number, number][] }[];
  rules: Record<string, number>;
  sampleFps: number;
  live?: boolean;
};

const NOT_RESPONDING = 'The occupancy service is not responding. Try again in a moment.';

function base(url: string | undefined): string {
  if (!url) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_NOT_CONFIGURED', 'The occupancy service is not set up (ML_OCCUPANCY_URL).');
  return url;
}

async function call(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 10_000) });
  } catch {
    throw new ServiceUnavailableError('OCCUPANCY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  }
}

/** FastAPI puts its message in `detail` (a string for our own errors). */
async function detail(res: Response): Promise<string | null> {
  const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
  return typeof body?.detail === 'string' ? body.detail : null;
}

function checked<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_BAD_RESPONSE', 'The occupancy service sent a result in an unexpected format.');
  return parsed.data;
}

export async function occupancyModel(url: string | undefined): Promise<OccupancyModel> {
  const res = await call(new URL('/health', base(url)).href, { timeoutMs: 3000 });
  if (!res.ok) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  return checked(health, await res.json().catch(() => null)).model;
}

export async function startVideoJob(url: string | undefined, request: VideoJobRequest): Promise<OccupancyJob> {
  const res = await call(new URL('/video-jobs', base(url)).href, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  // 404: the video is not in the service's video folder; 409: that job is already running; 422: bad rules/bays
  if (res.status === 404 || res.status === 409 || res.status === 422) {
    throw new BusinessRuleError('OCCUPANCY_JOB_REJECTED', (await detail(res)) ?? 'The occupancy service could not start this video.');
  }
  if (!res.ok) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  return checked(job, await res.json().catch(() => null));
}

/** Progress of a job; `since` = transitions already stored. Null when the service no longer knows the job (restarted). */
export async function fetchVideoJob(url: string | undefined, jobId: string, since: number): Promise<OccupancyJob | null> {
  const u = new URL(`/video-jobs/${encodeURIComponent(jobId)}`, base(url));
  u.searchParams.set('since', String(since));
  const res = await call(u.href, { timeoutMs: 5000 });
  if (res.status === 404) return null;
  if (!res.ok) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  return checked(job, await res.json().catch(() => null));
}

export async function cancelVideoJob(url: string | undefined, jobId: string): Promise<void> {
  const res = await call(new URL(`/video-jobs/${encodeURIComponent(jobId)}/cancel`, base(url)).href, { method: 'POST' });
  if (!res.ok && res.status !== 404) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
}

/** The latest analysed picture of a running job around one bay (JPEG), or null when there is none yet. */
export async function fetchJobFrame(url: string | undefined, jobId: string, bayId: string, width = 480): Promise<Buffer | null> {
  const u = new URL(`/video-jobs/${encodeURIComponent(jobId)}/frame`, base(url));
  u.searchParams.set('bay', bayId);
  u.searchParams.set('width', String(width));
  const res = await call(u.href, { timeoutMs: 5000 });
  if (res.status === 404) return null;
  if (!res.ok) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  return Buffer.from(await res.arrayBuffer());
}

/** One JPEG frame of a camera's video, for drawing bay outlines. */
export async function fetchSnapshot(url: string | undefined, source: string, atSeconds: number) {
  const u = new URL('/snapshot', base(url));
  u.searchParams.set('source', source);
  u.searchParams.set('at', String(atSeconds));
  const res = await call(u.href, { timeoutMs: 15_000 });
  if (res.status === 404 || res.status === 422) {
    throw new BusinessRuleError('OCCUPANCY_SNAPSHOT_FAILED', (await detail(res)) ?? 'No picture could be taken from this camera source.');
  }
  if (!res.ok) throw new ServiceUnavailableError('OCCUPANCY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  return {
    jpeg: Buffer.from(await res.arrayBuffer()),
    width: Number(res.headers.get('x-frame-width')) || null,
    height: Number(res.headers.get('x-frame-height')) || null,
  };
}
