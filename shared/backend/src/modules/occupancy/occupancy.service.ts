import type pg from 'pg';
import { withTransaction } from '../../db/pool.js';
import { BusinessRuleError, NotFoundError } from '../../http/errors.js';
import {
  cancelVideoJob as cancelOnService,
  fetchJobFrame,
  fetchVideoJob,
  occupancyModel,
  startVideoJob as startOnService,
  type OccupancyJob,
} from '../../integrations/ml/occupancyService.js';
import { audit } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { getSetting } from '../../lib/settings.js';
import * as repo from './occupancy.repository.js';

export type OccupancyDeps = { pool: pg.Pool; serviceUrl?: string };

/** The occupancy.rules setting; the service applies them (see member-1-occupancy/backend/app/state_machine.py). */
export const DEFAULT_RULES = { overlapThreshold: 0.4, confirmOccupiedSeconds: 3, confirmFreeSeconds: 5, sampleFps: 2 };
export type OccupancyRules = typeof DEFAULT_RULES & Partial<Record<'releaseThreshold' | 'toleranceSeconds' | 'minSupport' | 'staleAfterSeconds', number>>;

/** The service knows a job by this id; the API's own id is the number in it. */
export const serviceJobId = (videoJobId: number) => `VJ-${videoJobId}`;

/**
 * Starts processing a camera's recorded video: the job row is created first (so its id names the job on the service),
 * then the service is asked to start. If the service refuses or is down, the job is marked failed with the reason
 * and the caller gets the error.
 */
export async function startVideoJob(deps: OccupancyDeps, input: { cameraId: number; sampleFps?: number; live?: boolean; userId: number }) {
  const camera = await repo.getCamera(deps.pool, input.cameraId);
  if (!camera) throw new NotFoundError('That camera does not exist.');
  if (!camera.isActive) throw new BusinessRuleError('CAMERA_INACTIVE', 'This camera is switched off. Switch it on first.');
  if (!camera.sourceUrl) throw new BusinessRuleError('CAMERA_NO_SOURCE', 'Give this camera a video source first.');
  const bays = await repo.baysToWatch(deps.pool, camera.cameraId);
  if (bays.length === 0) throw new BusinessRuleError('NO_BAYS_DRAWN', 'Draw at least one bay outline on this camera first.');
  // The service runs one job at a time and a live job never ends on its own: anything started after it would wait forever
  const running = await repo.liveCameras(deps.pool);
  if (running.length > 0) {
    throw new BusinessRuleError('LIVE_CAMERA_RUNNING', `${running[0]!.cameraName} is running live. Stop it before processing another video.`);
  }

  const model = await occupancyModel(deps.serviceUrl);
  const rules = await getSetting<OccupancyRules>(deps.pool, 'occupancy.rules', DEFAULT_RULES);
  const sampleFps = input.sampleFps ?? rules.sampleFps;
  const { sampleFps: _s, ...stateRules } = rules;

  const id = await withTransaction(deps.pool, async (client) => {
    const videoJobId = await repo.insertVideoJob(client, {
      cameraId: camera.cameraId,
      sourcePath: camera.sourceUrl!,
      sampleFps,
      modelVersionId: await repo.modelVersionId(client, model.version, model.placeholder),
      userId: input.userId,
      live: input.live ?? false,
    });
    await audit(client, { table: 'occupancy.video_jobs', recordId: videoJobId, action: 'start', snapshot: { cameraId: camera.cameraId, sampleFps, live: input.live ?? false }, userId: input.userId });
    return videoJobId;
  });

  let started: OccupancyJob;
  try {
    started = await startOnService(deps.serviceUrl, {
      jobId: serviceJobId(id),
      source: camera.sourceUrl,
      bays: bays.map((b) => ({ id: String(b.bayId), polygon: b.polygon })),
      rules: stateRules,
      sampleFps,
      live: input.live ?? false,
    });
  } catch (err) {
    await repo.updateVideoJob(deps.pool, id, { status: 'failed', framesProcessed: 0, totalFrames: null, error: err instanceof Error ? err.message.slice(0, 500) : 'Could not start.' });
    throw err;
  }
  // The service decides masking from its model (OCC_ROI_MASK); store what it reported so results can be interpreted
  await repo.setVideoJobMask(deps.pool, id, started.roiMask ?? null);
  return id;
}

/** The latest picture around a bay from its camera's live job, or null when the camera is not live or has no picture yet. */
export async function liveBayPicture(deps: OccupancyDeps, bayId: number): Promise<Buffer | null> {
  const bay = await repo.getBay(deps.pool, bayId);
  if (!bay) throw new NotFoundError('Bay not found.');
  const live = (await repo.liveCameras(deps.pool)).find((c) => c.cameraId === bay.cameraId && c.bayIds.includes(bayId));
  if (!live) return null;
  return fetchJobFrame(deps.serviceUrl, serviceJobId(live.videoJobId), String(bayId));
}

export async function cancelVideoJob(deps: OccupancyDeps, videoJobId: number, userId: number) {
  const job = await repo.getVideoJob(deps.pool, videoJobId);
  if (!job) throw new NotFoundError('Video job not found.');
  if (!['queued', 'running'].includes(job.status)) throw new BusinessRuleError('JOB_FINISHED', 'This video job has already finished.');
  await cancelOnService(deps.serviceUrl, serviceJobId(videoJobId));
  await audit(deps.pool, { table: 'occupancy.video_jobs', recordId: videoJobId, action: 'cancel', userId });
  // The status itself is updated by the next sync, from what the service reports.
}

/**
 * Turns the service's report into rows. Bay ids on the service are our bay ids as text; transition times are seconds
 * into the video, stored as wall-clock time from when the job started. Transitions for bays we don't know are skipped.
 */
export function transitionRows(report: OccupancyJob, videoJobId: number, startedAt: Date) {
  return report.transitions.flatMap((t) => {
    const bayId = Number(t.bayId);
    if (!Number.isInteger(bayId) || bayId <= 0) return [];
    return [{
      bayId,
      fromState: t.fromState,
      toState: t.toState,
      at: new Date(startedAt.getTime() + Math.round(t.atSeconds * 1000)),
      trackId: t.trackId,
      overlap: t.overlap,
      evidence: t.evidence.slice(0, 200),
      videoJobId,
    }];
  });
}

/**
 * One sync pass: for every open job, fetch new transitions from the service and store them with the job's progress
 * in one transaction (so a crash never stores a transition twice: `since` = transitions already stored).
 */
export async function syncOpenJobs(deps: OccupancyDeps): Promise<void> {
  for (const job of await repo.openVideoJobs(deps.pool)) {
    let report: OccupancyJob | null;
    try {
      report = await fetchVideoJob(deps.serviceUrl, serviceJobId(job.videoJobId), job.stored);
    } catch (err) {
      logger.warn('occupancy sync: service not reachable', { videoJobId: job.videoJobId, error: err instanceof Error ? err.message : String(err) });
      if (job.cameraId) await repo.markCameraSeen(deps.pool, job.cameraId, false);
      return; // try again on the next pass
    }
    await withTransaction(deps.pool, async (client) => {
      if (!report) {
        await repo.updateVideoJob(client, job.videoJobId, { status: 'failed', framesProcessed: 0, totalFrames: null, error: 'The occupancy service restarted while this video was being processed.' });
        return;
      }
      for (const row of transitionRows(report, job.videoJobId, new Date(job.startedAt))) {
        await repo.applyTransition(client, row);
      }
      await repo.updateVideoJob(client, job.videoJobId, {
        status: report.status, framesProcessed: report.framesProcessed, totalFrames: report.totalFrames, error: report.error,
      });
      if (job.cameraId && report.status === 'running') await repo.markCameraSeen(client, job.cameraId, true);
    });
  }
}

/**
 * Camera suggestions for the Bay monitor: each occupied bay without a job is paired with the next vehicle in the queue
 * (the bay occupied longest gets the first one). Only a suggestion: staff confirm it, or pick another vehicle.
 */
export function pairBaysWithQueue(bays: repo.UnlinkedBay[], queue: repo.QueuedJob[]) {
  return bays.map((bay, i) => ({ ...bay, suggestedJobId: queue[i]?.jobId ?? null }));
}

export async function baySuggestions(pool: pg.Pool) {
  const [bays, queue, releases] = await Promise.all([repo.occupiedBaysWithoutJob(pool), repo.jobsReadyForBay(pool), repo.freeBaysWithJob(pool)]);
  return { suggestions: pairBaysWithQueue(bays, queue), queue, releases };
}

/** Staff confirmed that the vehicle left the bay (the camera saw it free): the job moves to ready and frees the bay. */
export async function confirmJobLeftBay(pool: pg.Pool, input: { bayId: number; jobId: number; userId: number }) {
  return withTransaction(pool, async (client) => {
    await repo.lockBay(client, input.bayId);
    const bay = await repo.getBay(client, input.bayId);
    if (!bay) throw new NotFoundError('That bay does not exist.');
    const moved = await repo.markJobReady(client, {
      jobId: input.jobId,
      bayId: input.bayId,
      userId: input.userId,
      note: `Confirmed on the Bay monitor: the camera saw ${bay.name} free`,
    });
    if (!moved) throw new BusinessRuleError('JOB_NOT_IN_BAY', 'That job is no longer in this bay. Refresh to see the current state.');
    await audit(client, { table: 'workshop.jobs', recordId: input.jobId, action: 'mark_ready', snapshot: { bayId: input.bayId, source: 'occupancy_suggestion' }, userId: input.userId });
  });
}

/** Staff confirmed that this job's vehicle is the one in the bay: the job moves to in_bay. */
export async function confirmJobInBay(pool: pg.Pool, input: { bayId: number; jobId: number; userId: number }) {
  return withTransaction(pool, async (client) => {
    // Lock the bay row first, so two people confirming at once cannot put two vehicles in one bay
    await repo.lockBay(client, input.bayId);
    const bay = await repo.getBay(client, input.bayId);
    if (!bay || !bay.isActive) throw new NotFoundError('That bay does not exist or is switched off.');
    const camera = bay.cameraId ? await repo.getCamera(client, bay.cameraId) : null;
    if (!repo.cameraTakesJobs(camera?.code)) {
      throw new BusinessRuleError('TEST_BAY', `${bay.name} is on a test camera (${camera!.code}); jobs cannot be put in it.`);
    }
    if (await repo.bayHasJob(client, input.bayId)) {
      throw new BusinessRuleError('BAY_HAS_JOB', `${bay.name} already has a vehicle linked to it. Refresh to see it.`);
    }
    const moved = await repo.moveJobIntoBay(client, {
      jobId: input.jobId,
      bayId: input.bayId,
      userId: input.userId,
      note: `Confirmed on the Bay monitor: the camera saw ${bay.name} occupied`,
    });
    if (!moved) throw new BusinessRuleError('JOB_NOT_WAITING', 'That job is no longer waiting for a bay. Refresh and pick another vehicle.');
    await audit(client, { table: 'workshop.jobs', recordId: input.jobId, action: 'move_to_bay', snapshot: { bayId: input.bayId, source: 'occupancy_suggestion' }, userId: input.userId });
  });
}
