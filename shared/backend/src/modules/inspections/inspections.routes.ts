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
import { getInspection, imageStorageKey, listInspections, vehicleOptions } from './inspections.repository.js';
import { DAMAGE_LABELS, INSPECTION_STATUSES, REVIEW_DECISIONS, SEVERITIES, VIEW_ANGLES } from './inspections.rules.js';
import { confirmInspection, createInspection, reviewDetection, type InspectionDeps } from './inspections.service.js';

const DEFAULT_UPLOAD = { maxImageMb: 10, maxImagesPerInspection: 3, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] };

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
const confirmBody = z.object({ notes: z.string().trim().max(1000).optional().transform((s) => s || null) });

/** Reads the photos of a multipart form into memory, with the limits from the damage.upload setting. */
async function receivePhotos(req: Request, res: Response, limits: typeof DEFAULT_UPLOAD) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxImageMb * 1024 * 1024, files: limits.maxImagesPerInspection, fields: 20 },
    fileFilter: (_req, file, accept) => accept(null, limits.allowedTypes.includes(file.mimetype)),
  }).array('images', limits.maxImagesPerInspection);

  await new Promise<void>((resolve, reject) =>
    upload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        const message =
          err.code === 'LIMIT_FILE_SIZE' ? `Each photo must be ${limits.maxImageMb} MB or smaller.`
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Add at most ${limits.maxImagesPerInspection} photos.`
          : 'The upload could not be read.';
        return reject(new ValidationError(message, [{ field: 'images', message }]));
      }
      reject(err);
    }),
  );
  const files = (req.files ?? []) as Express.Multer.File[];
  if (files.length === 0) {
    const types = limits.allowedTypes.map((t) => t.replace('image/', '').toUpperCase()).join(', ');
    throw new ValidationError('Add at least one photo.', [{ field: 'images', message: `Add a ${types} photo of the vehicle.` }]);
  }
  return files.map((f) => ({ buffer: f.buffer, filename: f.originalname, mimeType: f.mimetype }));
}

/**
 * Damage inspections (component 2). Staff take photos; the damage service finds and grades the damage; a technician
 * reviews each region; confirming makes it final and visible to the customer.
 *
 *   POST  /api/inspections                                   new inspection (multipart: images, viewAngles, jobId | vehicleId)
 *   GET   /api/inspections?status=&search=&page=&pageSize=    list (review queue: status=awaiting_review)
 *   GET   /api/inspections/vehicle-options?search=            open jobs to start an inspection for
 *   GET   /api/inspections/:id                               detail with photos and damage regions
 *   GET   /api/inspections/:id/images/:imageId                the photo itself
 *   PATCH /api/inspections/:id/detections/:detectionId        review one region (confirmed | corrected | rejected)
 *   POST  /api/inspections/:id/confirm                       make it final
 */
export function inspectionsRoutes(deps: InspectionDeps) {
  const router = Router();
  const { pool } = deps;

  router.post('/', requireScreen('INSPECTION_CREATE'), async (req, res) => {
    const me = signedInUser(req);
    const limits = await getSetting(pool, 'damage.upload', DEFAULT_UPLOAD);
    const photos = await receivePhotos(req, res, limits);
    const body = parse(createBody, req.body);
    if (body.viewAngles.length > photos.length) {
      throw new ValidationError('There are more view angles than photos.', [{ field: 'viewAngles', message: 'Give one view angle per photo.' }]);
    }
    const id = await createInspection(deps, { ...body, photos, userId: me.userId });
    sendOk(res, await getInspection(pool, id), 201);
  });

  router.get('/', requireScreen('INSPECTION_HISTORY', 'INSPECTION_REVIEW'), async (req, res) => {
    sendOk(res, await listInspections(pool, parse(listQuery, req.query)));
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

  router.patch('/:id/detections/:detectionId', requireScreen('INSPECTION_REVIEW'), async (req, res) => {
    const me = signedInUser(req);
    const { id, detectionId } = parse(detectionParams, req.params);
    const body = parse(reviewBody, req.body);
    await reviewDetection(pool, { inspectionId: id, detectionId, ...body, userId: me.userId });
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
