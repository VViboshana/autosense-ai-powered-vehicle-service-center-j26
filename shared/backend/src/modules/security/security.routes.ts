import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../http/errors.js';
import { pageQuery } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import {
  acknowledgeAlert,
  addAction,
  alertSnapshotKey,
  cameraForVideo,
  getAlert,
  getVideoAnalysis,
  insertVideoAnalysis,
  listVideoAnalyses,
  runningVideoIds,
  videoKey,
  listAlerts,
  listCameras,
  lockAlert,
  resolveAlert,
  securityRules,
  securitySummary,
} from './security.repository.js';
import { actionProblem, RECORDED_ACTIONS, RESOLUTIONS, SEVERITIES, THREAT_TYPES } from './security.rules.js';
import { removeUpload, serviceHealth, submitVideo, syncAnalysis, type VideoDeps } from './security.videos.js';

const blankToUndefined = (v: unknown) => (v === '' || v == null ? undefined : v);

/** Recorded clips: the common camera export formats, up to 500 MB. */
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm', 'video/avi'];
const MAX_VIDEO_MB = 500;
const videoBody = z.object({
  cameraId: z.coerce.number().int().positive({ message: 'Choose the camera this video is from.' }),
  startTime: z.preprocess(blankToUndefined, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 21:30.').optional()),
  shortTimings: z.preprocess((v) => v === 'true' || v === true, z.boolean()),
});
const listQuery = pageQuery.extend({
  view: z.enum(['active', 'resolved', 'all']).default('active'),
  severity: z.preprocess(blankToUndefined, z.enum(SEVERITIES).optional()),
  threat: z.preprocess(blankToUndefined, z.enum(THREAT_TYPES).optional()),
  cameraId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  search: z.string().trim().max(60).optional().transform((s) => s || undefined),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const note = z.string().trim().max(500).optional().transform((s) => s || null);
const resolveBody = z
  .object({ resolution: z.enum(RESOLUTIONS), note })
  .refine((b) => b.resolution !== 'false_alarm' || b.note, { message: 'Say why this is a false alarm.', path: ['note'] });
const actionBody = z
  .object({ action: z.enum(RECORDED_ACTIONS), note })
  .refine((b) => b.action !== 'note' || b.note, { message: 'Write the note.', path: ['note'] });

/**
 * Vehicle security and safety alerts (component 4). The security service raises alerts; a guard or supervisor
 * acknowledges each one, records what was done (emergency services called, owner informed, notes) and resolves it
 * as handled or as a false alarm. The AI flags; a person decides.
 *
 *   GET  /api/security/summary                          figures for the Alerts screen
 *   GET  /api/security/alerts?view=&severity=&threat=&cameraId=&search=&page=&pageSize=
 *   GET  /api/security/alerts/:id                       detail with detections and timeline
 *   POST /api/security/alerts/:id/acknowledge
 *   POST /api/security/alerts/:id/resolve               { resolution: handled | false_alarm, note }
 *   POST /api/security/alerts/:id/actions               { action: emergency_called | owner_informed | note, note }
 *   GET  /api/security/cameras                          security cameras with their alert counts
 *   GET  /api/security/rules                            threat catalogue, zones, thresholds, notification matrix
 *   GET  /api/security/alerts/:id/snapshot              the evidence frame of an alert
 *   GET  /api/security/service                          is the security service (model) running?
 *   GET  /api/security/videos                           latest recorded video analyses
 *   POST /api/security/videos                           upload a clip (multipart: video, cameraId, startTime, shortTimings)
 *   GET  /api/security/videos/:id                       one analysis with its alerts (follows a running job)
 *   GET  /api/security/videos/:id/video                 the annotated video (H.264, seekable)
 */
export function securityRoutes(deps: VideoDeps) {
  const router = Router();
  const { pool, uploadDir } = deps;
  const tmpDir = path.resolve(uploadDir, 'tmp');
  mkdirSync(tmpDir, { recursive: true });

  /** Sends a stored file (relative to UPLOAD_DIR); sendFile refuses paths that try to leave the folder. */
  const sendStored = (res: Response, key: string, missing: string) =>
    new Promise<void>((resolve, reject) =>
      res.sendFile(key, { root: path.resolve(uploadDir), dotfiles: 'deny', headers: { 'Cache-Control': 'private, max-age=3600' } }, (err) =>
        err ? reject(res.headersSent ? err : new NotFoundError(missing)) : resolve(),
      ),
    );

  router.get('/summary', requireScreen('SAFETY_ALERTS'), async (_req, res) => {
    sendOk(res, await securitySummary(pool));
  });

  router.get('/alerts', requireScreen('SAFETY_ALERTS', 'CAMERAS'), async (req, res) => {
    sendOk(res, await listAlerts(pool, parse(listQuery, req.query)));
  });

  router.get('/alerts/:id', requireScreen('SAFETY_ALERTS'), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const alert = await getAlert(pool, id);
    if (!alert) throw new NotFoundError('Alert not found.');
    sendOk(res, alert);
  });

  /** Runs one change on a locked alert, checks it is allowed, and audits it. */
  async function change(id: number, action: Parameters<typeof actionProblem>[0], userId: number, fn: (client: pg.PoolClient) => Promise<void>, snapshot: Record<string, unknown> = {}) {
    await withTransaction(pool, async (client) => {
      const alert = await lockAlert(client, id);
      if (!alert) throw new NotFoundError('Alert not found.');
      const problem = actionProblem(action, alert);
      if (problem) throw new BusinessRuleError('ALERT_ACTION_NOT_ALLOWED', problem);
      await fn(client);
      await audit(client, { table: 'security.alerts', recordId: id, action, userId, snapshot: { alertNo: alert.alertNo, ...snapshot } });
    });
  }

  router.post('/alerts/:id/acknowledge', requireScreen('SAFETY_ALERT_ACK'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    await change(id, 'acknowledge', me.userId, async (client) => {
      await acknowledgeAlert(client, id, me.userId);
      await addAction(client, id, 'acknowledged', null, me.userId);
    });
    sendOk(res, await getAlert(pool, id));
  });

  router.post('/alerts/:id/resolve', requireScreen('SAFETY_ALERT_ACK'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(resolveBody, req.body);
    await change(
      id,
      'resolve',
      me.userId,
      async (client) => {
        await resolveAlert(client, id, body.resolution, body.note, me.userId);
        await addAction(client, id, body.resolution === 'false_alarm' ? 'false_alarm' : 'resolved', body.note, me.userId);
      },
      body,
    );
    sendOk(res, await getAlert(pool, id));
  });

  router.post('/alerts/:id/actions', requireScreen('SAFETY_ALERT_ACK'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(actionBody, req.body);
    await change(id, body.action, me.userId, (client) => addAction(client, id, body.action, body.note, me.userId), body);
    sendOk(res, await getAlert(pool, id));
  });

  router.get('/cameras', requireScreen('CAMERAS'), async (_req, res) => {
    sendOk(res, await listCameras(pool));
  });

  router.get('/rules', requireScreen('ALERT_RULES', 'SAFETY_ALERTS'), async (_req, res) => {
    sendOk(res, await securityRules(pool));
  });

  router.get('/alerts/:id/snapshot', requireScreen('SAFETY_ALERTS', 'CAMERAS'), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const key = await alertSnapshotKey(pool, id);
    if (!key) throw new NotFoundError('This alert has no stored snapshot.');
    await sendStored(res, key, 'The snapshot is not stored on this server.');
  });

  // ---------------------------------------------------------------- recorded video analysis

  router.get('/service', requireScreen('CAMERAS'), async (_req, res) => {
    sendOk(res, await serviceHealth(deps.serviceUrl));
  });

  router.get('/videos', requireScreen('CAMERAS'), async (_req, res) => {
    for (const id of await runningVideoIds(pool)) await syncAnalysis(deps, id);
    sendOk(res, await listVideoAnalyses(pool));
  });

  router.post('/videos', requireScreen('CAMERAS'), async (req: Request, res: Response) => {
    const me = signedInUser(req);
    const upload = multer({
      storage: multer.diskStorage({ destination: tmpDir }),
      limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1, fields: 10 },
      fileFilter: (_req, file, accept) => accept(null, VIDEO_TYPES.includes(file.mimetype)),
    }).single('video');
    await new Promise<void>((resolve, reject) =>
      upload(req, res, (err: unknown) => {
        if (!err) return resolve();
        if (err instanceof multer.MulterError) {
          const message = err.code === 'LIMIT_FILE_SIZE' ? `The video must be ${MAX_VIDEO_MB} MB or smaller.` : 'The upload could not be read.';
          return reject(new ValidationError(message, [{ field: 'video', message }]));
        }
        reject(err);
      }),
    );
    const file = req.file;
    if (!file) throw new ValidationError('Add a video.', [{ field: 'video', message: 'Choose an MP4, MOV, AVI, MKV or WebM video.' }]);
    try {
      const body = parse(videoBody, req.body);
      const camera = await cameraForVideo(pool, body.cameraId);
      if (!camera) throw new ValidationError('Choose the camera this video is from.', [{ field: 'cameraId', message: 'Not a security camera.' }]);
      const jobId = await submitVideo(deps.serviceUrl, { path: file.path, name: file.originalname, mimeType: file.mimetype }, camera.code,
        body.startTime ?? null, body.shortTimings);
      const id = await insertVideoAnalysis(pool, {
        cameraId: body.cameraId, fileName: file.originalname, fileSize: file.size, startTime: body.startTime ?? null,
        shortTimings: body.shortTimings, serviceJobId: jobId, userId: me.userId,
      });
      await audit(pool, { table: 'security.video_analyses', recordId: id, action: 'uploaded', userId: me.userId,
        snapshot: { fileName: file.originalname, camera: camera.code } });
      sendOk(res, await getVideoAnalysis(pool, id), 201);
    } finally {
      await removeUpload(file.path); // the service keeps its own copy
    }
  });

  router.get('/videos/:id', requireScreen('CAMERAS', 'SAFETY_ALERTS'), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { reachable } = await syncAnalysis(deps, id);
    const analysis = await getVideoAnalysis(pool, id);
    if (!analysis) throw new NotFoundError('Video analysis not found.');
    sendOk(res, { ...analysis, serviceReachable: reachable });
  });

  router.get('/videos/:id/video', requireScreen('CAMERAS', 'SAFETY_ALERTS'), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const key = await videoKey(pool, id);
    if (!key) throw new NotFoundError('No annotated video is stored for this analysis.');
    await sendStored(res, key, 'The annotated video is not stored on this server.');
  });

  return router;
}
