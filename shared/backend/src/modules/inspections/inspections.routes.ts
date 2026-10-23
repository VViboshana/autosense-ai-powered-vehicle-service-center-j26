import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { sendOk } from '../../http/envelope.js';
import { NotFoundError, ValidationError } from '../../http/errors.js';
import { pageQuery } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { getSetting } from '../../lib/settings.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import { fieldPerformance } from './inspections.performance.js';
import {
  getInspection,
  imageStorageKey,
  listInspections,
  reviewedRegions,
  soundStorageKey,
  testSetMetrics,
  vehicleOptions,
} from './inspections.repository.js';
import { DAMAGE_LABELS, INSPECTION_STATUSES, REVIEW_DECISIONS, SEVERITIES, VIEW_ANGLES } from './inspections.rules.js';
import {
  addTechnicianRegion,
  confirmInspection,
  createInspection,
  removeTechnicianRegion,
  reviewDetection,
  reviewSound,
  type InspectionDeps,
  type SoundRecording,
} from './inspections.service.js';
import { AUDIO_TYPES, SOUND_LABELS, SOUND_SITUATIONS, type SoundLabel } from './inspections.sound.js';

const DEFAULT_UPLOAD = { maxImageMb: 10, maxImagesPerInspection: 5, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] };
// Sound recordings: one per situation (starting, idling, braking); 5-10 s of WAV is about 1-2 MB
const MAX_SOUND_MB = 10;

/** Form fields arrive as text: an empty field means "not given". */
const optionalId = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().positive().optional());

const listQuery = pageQuery.extend({
  status: z.enum(INSPECTION_STATUSES).optional(),
  search: z.string().trim().max(60).optional().transform((s) => s || undefined),
});
const optionsQuery = z.object({ search: z.string().trim().max(60).optional().transform((s) => s || undefined) });
const createBody = z
  .object({
    jobId: optionalId,
    vehicleId: optionalId,
    // One per photo, in the same order; repeated form field (viewAngles=front&viewAngles=left), missing ones = 'other'
    viewAngles: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(VIEW_ANGLES))),
    // One per recording, in the same order (soundSituations=idling&soundSituations=braking)
    soundSituations: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(SOUND_SITUATIONS))),
  })
  .refine((b) => b.jobId || b.vehicleId, { message: 'Choose the job or the vehicle.', path: ['vehicleId'] });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const imageParams = idParam.extend({ imageId: z.coerce.number().int().positive() });
const detectionParams = idParam.extend({ detectionId: z.coerce.number().int().positive() });
const reviewBody = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    label: z.enum(DAMAGE_LABELS).optional(),
    severity: z.enum(SEVERITIES).optional(),
  })
  .refine((b) => b.decision !== 'corrected' || b.label || b.severity, {
    message: 'Give the correct damage type or severity.',
    path: ['label'],
  });
export const regionBody = z.object({
  label: z.enum(DAMAGE_LABELS),
  severity: z.enum(SEVERITIES),
  // [x1, y1, x2, y2] in the photo's pixels; at least 8 px each way so a stray click is not a region
  bbox: z
    .tuple([z.number().min(0), z.number().min(0), z.number().min(0), z.number().min(0)])
    .refine(([x1, y1, x2, y2]) => x2 - x1 >= 8 && y2 - y1 >= 8, { message: 'Draw a larger box around the damage.' }),
});
const soundParams = idParam.extend({ soundId: z.coerce.number().int().positive() });
export const soundReviewBody = z
  .object({ decision: z.enum(REVIEW_DECISIONS), label: z.enum(SOUND_LABELS as [SoundLabel, ...SoundLabel[]]).optional() })
  .refine((b) => b.decision !== 'corrected' || b.label, { message: 'Choose the fault you heard.', path: ['label'] });
const confirmBody = z.object({ notes: z.string().trim().max(1000).optional().transform((s) => s || null) });

/**
 * Reads the photos (field "images") and sound recordings (field "sounds") of a multipart form into memory, with the
 * photo limits from the damage.upload setting. Files of another type are left out (then "Add at least one photo").
 */
async function receiveUpload(req: Request, res: Response, limits: typeof DEFAULT_UPLOAD) {
  const maxSounds = SOUND_SITUATIONS.length;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.max(limits.maxImageMb, MAX_SOUND_MB) * 1024 * 1024, files: limits.maxImagesPerInspection + maxSounds, fields: 30 },
    fileFilter: (_req, file, accept) =>
      accept(null, file.fieldname === 'sounds' ? AUDIO_TYPES.includes(file.mimetype) : limits.allowedTypes.includes(file.mimetype)),
  }).fields([{ name: 'images', maxCount: limits.maxImagesPerInspection }, { name: 'sounds', maxCount: maxSounds }]);

  await new Promise<void>((resolve, reject) =>
    upload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        const sound = err.field === 'sounds';
        const message =
          err.code === 'LIMIT_FILE_SIZE' ? `Each photo must be ${limits.maxImageMb} MB or smaller, each recording ${MAX_SOUND_MB} MB.`
          : sound ? `Add at most ${maxSounds} recordings (one per situation).`
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Add at most ${limits.maxImagesPerInspection} photos.`
          : 'The upload could not be read.';
        return reject(new ValidationError(message, [{ field: sound ? 'sounds' : 'images', message }]));
      }
      reject(err);
    }),
  );
  const fields = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const photos = fields.images ?? [];
  if (photos.length === 0) {
    const types = limits.allowedTypes.map((t) => t.replace('image/', '').toUpperCase()).join(', ');
    throw new ValidationError('Add at least one photo.', [{ field: 'images', message: `Add a ${types} photo of the vehicle.` }]);
  }
  const sounds = fields.sounds ?? [];
  // The size limit above is the larger of the two; each kind is held to its own here
  const tooBig = [...photos.filter((f) => f.size > limits.maxImageMb * 1024 * 1024), ...sounds.filter((f) => f.size > MAX_SOUND_MB * 1024 * 1024)];
  if (tooBig.length) {
    const message = `${tooBig[0]!.originalname} is too large (photos up to ${limits.maxImageMb} MB, recordings up to ${MAX_SOUND_MB} MB).`;
    throw new ValidationError(message, [{ field: sounds.includes(tooBig[0]!) ? 'sounds' : 'images', message }]);
  }
  const file = (f: Express.Multer.File) => ({ buffer: f.buffer, filename: f.originalname, mimeType: f.mimetype });
  return { photos: photos.map(file), sounds: sounds.map(file) };
}

/**
 * Damage inspections (component 2). Staff take photos (and may record the vehicle starting, idling or braking); the
 * damage service finds and grades the damage and names the fault it hears; a technician reviews each region and sound
 * result; confirming makes it final and visible to the customer.
 *
 *   POST  /api/inspections                                   new inspection (multipart: images, viewAngles, jobId | vehicleId;
 *                                                            optional sounds + soundSituations, one recording per situation)
 *   GET   /api/inspections?status=&search=&page=&pageSize=    list (review queue: status=awaiting_review)
 *   GET   /api/inspections/vehicle-options?search=            open jobs to start an inspection for
 *   GET   /api/inspections/performance                        field figures: model per damage type + severity rule check
 *   GET   /api/inspections/:id                               detail with photos and damage regions
 *   GET   /api/inspections/:id/images/:imageId                the photo itself
 *   GET   /api/inspections/:id/sounds/:soundId/audio          a sound recording itself
 *   PATCH /api/inspections/:id/sounds/:soundId                review one sound result (confirmed | corrected | rejected)
 *   PATCH /api/inspections/:id/detections/:detectionId        review one region (confirmed | corrected | rejected)
 *   POST  /api/inspections/:id/images/:imageId/detections     technician adds damage the model missed (box + type + severity)
 *   DELETE /api/inspections/:id/detections/:detectionId       remove a region a technician added
 *   POST  /api/inspections/:id/confirm                       make it final
 */
export function inspectionsRoutes(deps: InspectionDeps) {
  const router = Router();
  const { pool } = deps;

  router.post('/', requireScreen('INSPECTION_CREATE'), async (req, res) => {
    const me = signedInUser(req);
    const limits = await getSetting(pool, 'damage.upload', DEFAULT_UPLOAD);
    const { photos, sounds } = await receiveUpload(req, res, limits);
    const body = parse(createBody, req.body);
    if (body.viewAngles.length > photos.length) {
      throw new ValidationError('There are more view angles than photos.', [{ field: 'viewAngles', message: 'Give one view angle per photo.' }]);
    }
    if (body.soundSituations.length !== sounds.length || new Set(body.soundSituations).size !== sounds.length) {
      const message = 'Give one situation (starting, idling or braking) per recording, each at most once.';
      throw new ValidationError(message, [{ field: 'sounds', message }]);
    }
    const recordings: SoundRecording[] = sounds.map((s, n) => ({ ...s, situation: body.soundSituations[n]! }));
    const id = await createInspection(deps, { ...body, photos, sounds: recordings, userId: me.userId });
    sendOk(res, await getInspection(pool, id), 201);
  });

  router.get('/', requireScreen('INSPECTION_HISTORY', 'INSPECTION_REVIEW'), async (req, res) => {
    sendOk(res, await listInspections(pool, parse(listQuery, req.query)));
  });

  // Before '/:id' (like vehicle-options below): how the model and the severity rules do in real use
  router.get('/performance', requireScreen('DAMAGE_SETTINGS'), async (_req, res) => {
    const { regions, sample } = await reviewedRegions(pool);
    const testSet = await testSetMetrics(pool, sample.modelVersions);
    sendOk(res, { sample, regionsReviewed: regions.length, testSet, ...fieldPerformance(regions) });
  });

  // Before '/:id', so "vehicle-options" is not read as an inspection id
  router.get('/vehicle-options', requireScreen('INSPECTION_CREATE'), async (req, res) => {
    const { search } = parse(optionsQuery, req.query);
    sendOk(res, await vehicleOptions(pool, search));
  });

  router.get('/:id', requireScreen('INSPECTION_HISTORY', 'INSPECTION_REVIEW', 'INSPECTION_CREATE'), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const inspection = await getInspection(pool, id);
    if (!inspection) throw new NotFoundError('Inspection not found.');
    sendOk(res, inspection);
  });

  router.get('/:id/images/:imageId', requireScreen('INSPECTION_HISTORY', 'INSPECTION_REVIEW', 'INSPECTION_CREATE'), async (req, res) => {
    const { id, imageId } = parse(imageParams, req.params);
    const key = await imageStorageKey(pool, id, imageId);
    if (!key) throw new NotFoundError('Photo not found.');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    // root + a relative key: sendFile refuses paths that try to leave the upload folder
    await new Promise<void>((resolve, reject) =>
      res.sendFile(key, { root: path.resolve(deps.uploadDir), dotfiles: 'deny' }, (err) =>
        err ? reject(res.headersSent ? err : new NotFoundError('This photo is not stored on this server.')) : resolve(),
      ),
    );
  });

  router.get('/:id/sounds/:soundId/audio', requireScreen('INSPECTION_HISTORY', 'INSPECTION_REVIEW', 'INSPECTION_CREATE'), async (req, res) => {
    const { id, soundId } = parse(soundParams, req.params);
    const key = await soundStorageKey(pool, id, soundId);
    if (!key) throw new NotFoundError('Recording not found.');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    await new Promise<void>((resolve, reject) =>
      res.sendFile(key, { root: path.resolve(deps.uploadDir), dotfiles: 'deny' }, (err) =>
        err ? reject(res.headersSent ? err : new NotFoundError('This recording is not stored on this server.')) : resolve(),
      ),
    );
  });

  router.patch('/:id/sounds/:soundId', requireScreen('INSPECTION_REVIEW'), async (req, res) => {
    const me = signedInUser(req);
    const { id, soundId } = parse(soundParams, req.params);
    const body = parse(soundReviewBody, req.body);
    await reviewSound(pool, { inspectionId: id, soundCheckId: soundId, ...body, userId: me.userId });
    sendOk(res, await getInspection(pool, id));
  });

  router.patch('/:id/detections/:detectionId', requireScreen('INSPECTION_REVIEW'), async (req, res) => {
    const me = signedInUser(req);
    const { id, detectionId } = parse(detectionParams, req.params);
    const body = parse(reviewBody, req.body);
    await reviewDetection(pool, { inspectionId: id, detectionId, ...body, userId: me.userId });
    sendOk(res, await getInspection(pool, id));
  });

  router.post('/:id/images/:imageId/detections', requireScreen('INSPECTION_REVIEW'), async (req, res) => {
    const me = signedInUser(req);
    const { id, imageId } = parse(imageParams, req.params);
    const body = parse(regionBody, req.body);
    await addTechnicianRegion(pool, { inspectionId: id, imageId, ...body, userId: me.userId });
    sendOk(res, await getInspection(pool, id), 201);
  });

  router.delete('/:id/detections/:detectionId', requireScreen('INSPECTION_REVIEW'), async (req, res) => {
    const me = signedInUser(req);
    const { id, detectionId } = parse(detectionParams, req.params);
    await removeTechnicianRegion(pool, { inspectionId: id, detectionId, userId: me.userId });
    sendOk(res, await getInspection(pool, id));
  });

  router.post('/:id/confirm', requireScreen('INSPECTION_CONFIRM'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { notes } = parse(confirmBody, req.body);
    await confirmInspection(pool, { inspectionId: id, notes, userId: me.userId });
    sendOk(res, await getInspection(pool, id));
  });

  return router;
}
