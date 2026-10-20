import { Router } from 'express';
import { z } from 'zod';
import { sendOk } from '../../http/envelope.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { pageQuery } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { fetchSnapshot, occupancyModel } from '../../integrations/ml/occupancyService.js';
import { audit } from '../../lib/audit.js';
import { clearSettingsCache, getSetting } from '../../lib/settings.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import * as repo from './occupancy.repository.js';
import { baySuggestions, cancelVideoJob, confirmJobInBay, confirmJobLeftBay, DEFAULT_RULES, liveBayPicture, startVideoJob, type OccupancyDeps, type OccupancyRules } from './occupancy.service.js';

const VIEW = ['BAY_MONITOR', 'BAYS_CAMERAS', 'OCCUPANCY_SETTINGS'] as const;
const SETUP = 'BAYS_CAMERAS';

const blankToNull = (max: number) =>
  z.string().trim().max(max).nullable().optional().transform((s) => (s ? s : s === undefined ? undefined : null));
const code = z.string().trim().min(1, 'Give a short code.').max(10).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and dashes only.');

/** A bay outline: 3 to 50 points, each normalised to 0..1 of the camera frame (so it survives a resolution change). */
export const polygonSchema = z
  .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
  .min(3, 'An outline needs at least 3 points.')
  .max(50, 'An outline can have at most 50 points.')
  .refine((pts) => Math.abs(area(pts)) > 1e-4, { message: 'The outline is too small or its points are in a line.' });

/** Shoelace area, in normalised units (1 = the whole frame). */
export function area(pts: [number, number][]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    const [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Live streams (rtsp) or a video file name in the occupancy service's video folder; never a path elsewhere. */
export const sourceSchema = z
  .string()
  .trim()
  .max(500)
  .refine((s) => /^rtsps?:\/\//i.test(s) || /^[\w .()-]+\.(mp4|avi|mov|mkv)$/i.test(s), {
    message: 'Use an rtsp:// address or a video file name such as workshop-a.mp4 (no folders).',
  });

export const cameraBody = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and dashes only.'),
  name: z.string().trim().min(1, 'Give the camera a name.').max(80),
  location: blankToNull(120),
  sourceUrl: z.union([sourceSchema, z.literal('').transform(() => null), z.null()]).optional(),
  isActive: z.boolean().optional(),
});

export const bayBody = z.object({
  code,
  name: z.string().trim().min(1, 'Give the bay a name.').max(40),
  cameraId: z.number().int().positive().nullable().optional(),
  polygon: polygonSchema.nullable().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

/** A number between `min` and `max`, with a message staff can act on (`exclusive`: min itself is not allowed). */
const between = (min: number, max: number, exclusive = false) => {
  const message = exclusive ? `Enter a number above ${min} and up to ${max}.` : `Enter a number from ${min} to ${max}.`;
  const n = z.number({ error: 'Enter a number.' });
  return (exclusive ? n.gt(min, message) : n.min(min, message)).max(max, message);
};

/** occupancy.rules; the same limits as the service accepts (member-1-occupancy/backend/app/main.py, RulesIn). */
export const rulesBody = z
  .object({
    overlapThreshold: between(0.05, 0.95),
    releaseThreshold: between(0, 0.95).optional(),
    confirmOccupiedSeconds: between(0, 120, true),
    confirmFreeSeconds: between(0, 120, true),
    toleranceSeconds: between(0, 30).optional(),
    minSupport: between(0.5, 1, true).optional(),
    staleAfterSeconds: between(0, 600, true).optional(),
    sampleFps: between(0, 15, true),
    autoConfirm: z.boolean().optional(),
  })
  .refine((r) => r.releaseThreshold === undefined || r.releaseThreshold <= r.overlapThreshold, {
    message: 'The release threshold must not be above the overlap threshold.',
    path: ['releaseThreshold'],
  });

const idParam = z.object({ id: z.coerce.number().int().positive() });
const baysQuery = z.object({ cameraId: z.coerce.number().int().positive().optional() });
const snapshotQuery = z.object({ at: z.coerce.number().min(0).max(86_400).default(0) });
export const confirmBayBody = z.object({
  bayId: z.number({ error: 'Pick a bay.' }).int().positive(),
  jobId: z.number({ error: 'Pick the vehicle that is in the bay.' }).int().positive(),
});
const jobBody = z.object({ cameraId: z.number().int().positive(), sampleFps: z.number().gt(0).max(15).optional(), live: z.boolean().optional() });

/**
 * Bay occupancy (component 1): cameras, bay outlines, video jobs and bay history. The occupancy service does the
 * detection; this module stores its results (occupancy.sync.ts) and serves the screens.
 *
 *   GET   /api/occupancy/cameras                   list (with number of bays)
 *   POST  /api/occupancy/cameras                   add            PATCH /api/occupancy/cameras/:id   change
 *   GET   /api/occupancy/cameras/:id/snapshot?at=  one JPEG frame of the camera's video, for drawing outlines
 *   GET   /api/occupancy/bays?cameraId=            list with current state
 *   POST  /api/occupancy/bays                      add            PATCH /api/occupancy/bays/:id      change (incl. outline)
 *   GET   /api/occupancy/bays/:id/events           history of confirmed changes (paged)
 *   GET   /api/occupancy/bays/:id/live.jpg         latest live picture around the bay (JPEG; 404 when not live)
 *   GET   /api/occupancy/live                      cameras running live, with their bays
 *   GET   /api/occupancy/video-jobs                list (paged)   GET /api/occupancy/video-jobs/:id  one
 *   POST  /api/occupancy/video-jobs                process the camera's video   POST /api/occupancy/video-jobs/:id/cancel
 *   GET   /api/occupancy/rules                     PUT /api/occupancy/rules (setting occupancy.rules)
 *   GET   /api/occupancy/service                   the model the occupancy service runs, and whether it masks frames
 *   GET   /api/occupancy/bay-suggestions           occupied bays without a job, each with the next vehicle in the queue
 *   POST  /api/occupancy/bay-suggestions/confirm   staff confirm which vehicle is in the bay: the job moves to in_bay
 *   POST  /api/occupancy/bay-suggestions/release   staff confirm the vehicle left a bay the camera sees free: job -> ready
 */
export function occupancyRoutes(deps: OccupancyDeps) {
  const router = Router();
  const { pool } = deps;

  // ---- cameras
  router.get('/cameras', requireScreen(...VIEW), async (_req, res) => {
    sendOk(res, await repo.listCameras(pool));
  });

  router.post('/cameras', requireScreen(SETUP), async (req, res) => {
    const me = signedInUser(req);
    const body = parse(cameraBody, req.body);
    if (await repo.codeTaken(pool, 'cameras', body.code)) throw new ConflictError('CAMERA_CODE_TAKEN', `A camera with code "${body.code}" already exists.`);
    const id = await repo.insertCamera(pool, { code: body.code, name: body.name, location: body.location ?? null, sourceUrl: body.sourceUrl ?? null, isActive: body.isActive ?? true });
    await audit(pool, { table: 'occupancy.cameras', recordId: id, action: 'create', snapshot: body, userId: me.userId });
    sendOk(res, await repo.getCamera(pool, id), 201);
  });

  router.patch('/cameras/:id', requireScreen(SETUP), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(cameraBody.partial(), req.body);
    if (body.code && (await repo.codeTaken(pool, 'cameras', body.code, id))) throw new ConflictError('CAMERA_CODE_TAKEN', `A camera with code "${body.code}" already exists.`);
    const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    if (!(await repo.updateCamera(pool, id, changes))) throw new NotFoundError('Camera not found.');
    await audit(pool, { table: 'occupancy.cameras', recordId: id, action: 'update', snapshot: changes, userId: me.userId });
    sendOk(res, await repo.getCamera(pool, id));
  });

  router.get('/cameras/:id/snapshot', requireScreen(SETUP), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { at } = parse(snapshotQuery, req.query);
    const camera = await repo.getCamera(pool, id);
    if (!camera) throw new NotFoundError('Camera not found.');
    if (!camera.sourceUrl) throw new NotFoundError('This camera has no video source yet.');
    const shot = await fetchSnapshot(deps.serviceUrl, camera.sourceUrl, at);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    if (shot.width && shot.height) res.setHeader('X-Frame-Size', `${shot.width}x${shot.height}`);
    res.send(shot.jpeg);
  });

  // ---- bays
  router.get('/bays', requireScreen(...VIEW), async (req, res) => {
    const { cameraId } = parse(baysQuery, req.query);
    sendOk(res, await repo.listBays(pool, cameraId));
  });

  router.post('/bays', requireScreen(SETUP), async (req, res) => {
    const me = signedInUser(req);
    const body = parse(bayBody, req.body);
    if (await repo.codeTaken(pool, 'bays', body.code)) throw new ConflictError('BAY_CODE_TAKEN', `A bay with code "${body.code}" already exists.`);
    if (body.cameraId && !(await repo.getCamera(pool, body.cameraId))) throw new NotFoundError('That camera does not exist.');
    const id = await repo.insertBay(pool, {
      code: body.code, name: body.name, cameraId: body.cameraId ?? null, polygon: body.polygon ?? null,
      displayOrder: body.displayOrder ?? 0, isActive: body.isActive ?? true,
    });
    await audit(pool, { table: 'occupancy.bays', recordId: id, action: 'create', snapshot: body, userId: me.userId });
    sendOk(res, await repo.getBay(pool, id), 201);
  });

  router.patch('/bays/:id', requireScreen(SETUP), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(bayBody.partial(), req.body);
    if (body.code && (await repo.codeTaken(pool, 'bays', body.code, id))) throw new ConflictError('BAY_CODE_TAKEN', `A bay with code "${body.code}" already exists.`);
    if (body.cameraId && !(await repo.getCamera(pool, body.cameraId))) throw new NotFoundError('That camera does not exist.');
    const changes = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    if (!(await repo.updateBay(pool, id, changes))) throw new NotFoundError('Bay not found.');
    await audit(pool, { table: 'occupancy.bays', recordId: id, action: 'update', snapshot: changes, userId: me.userId });
    sendOk(res, await repo.getBay(pool, id));
  });

  router.get('/bays/:id/events', requireScreen(...VIEW), async (req, res) => {
    const { id } = parse(idParam, req.params);
    if (!(await repo.getBay(pool, id))) throw new NotFoundError('Bay not found.');
    sendOk(res, await repo.bayEvents(pool, id, parse(pageQuery, req.query)));
  });

  // ---- live cameras (a recorded video replayed as a live camera) and their bay pictures
  router.get('/live', requireScreen(...VIEW), async (_req, res) => {
    sendOk(res, await repo.liveCameras(pool));
  });

  router.get('/bays/:id/live.jpg', requireScreen(...VIEW), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const jpeg = await liveBayPicture(deps, id);
    if (!jpeg) throw new NotFoundError('No live picture for this bay right now.');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(jpeg);
  });

  // ---- video jobs
  router.get('/video-jobs', requireScreen(...VIEW), async (req, res) => {
    sendOk(res, await repo.listVideoJobs(pool, parse(pageQuery, req.query)));
  });

  router.get('/video-jobs/:id', requireScreen(...VIEW), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const job = await repo.getVideoJob(pool, id);
    if (!job) throw new NotFoundError('Video job not found.');
    sendOk(res, job);
  });

  router.post('/video-jobs', requireScreen(SETUP), async (req, res) => {
    const me = signedInUser(req);
    const body = parse(jobBody, req.body);
    const id = await startVideoJob(deps, { ...body, userId: me.userId });
    sendOk(res, await repo.getVideoJob(pool, id), 202);
  });

  router.post('/video-jobs/:id/cancel', requireScreen(SETUP), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    await cancelVideoJob(deps, id, me.userId);
    sendOk(res, await repo.getVideoJob(pool, id));
  });

  // ---- rules (setting occupancy.rules)
  router.get('/rules', requireScreen(...VIEW), async (_req, res) => {
    sendOk(res, await getSetting<OccupancyRules>(pool, 'occupancy.rules', DEFAULT_RULES));
  });

  // ---- the occupancy service's model (for the settings screen); 503 when the service is not running
  router.get('/service', requireScreen(...VIEW), async (_req, res) => {
    sendOk(res, await occupancyModel(deps.serviceUrl));
  });

  // ---- camera suggestions: which waiting vehicle is in an occupied bay (staff confirm)
  router.get('/bay-suggestions', requireScreen('BAY_MONITOR'), async (_req, res) => {
    sendOk(res, await baySuggestions(pool));
  });

  router.post('/bay-suggestions/confirm', requireScreen('BAY_JOB_CONFIRM'), async (req, res) => {
    const me = signedInUser(req);
    const body = parse(confirmBayBody, req.body);
    await confirmJobInBay(pool, { ...body, userId: me.userId });
    sendOk(res, await baySuggestions(pool));
  });

  router.post('/bay-suggestions/release', requireScreen('BAY_JOB_CONFIRM'), async (req, res) => {
    const me = signedInUser(req);
    const body = parse(confirmBayBody, req.body);
    await confirmJobLeftBay(pool, { ...body, userId: me.userId });
    sendOk(res, await baySuggestions(pool));
  });

  router.put('/rules', requireScreen('OCCUPANCY_SETTINGS'), async (req, res) => {
    const me = signedInUser(req);
    const rules = parse(rulesBody, req.body);
    await repo.saveRules(pool, rules, me.userId);
    clearSettingsCache();
    await audit(pool, { table: 'app.settings', recordId: 'occupancy.rules', action: 'update', snapshot: rules, userId: me.userId });
    sendOk(res, rules);
  });

  return router;
}
