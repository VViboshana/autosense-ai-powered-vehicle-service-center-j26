import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import multer from 'multer';
import { NotFoundError, ValidationError } from '../http/errors.js';

/** A customer's photo of their vehicle: one image, at most this size (the browser shrinks it before sending). */
export const VEHICLE_PHOTO_MAX_MB = 8;
const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** True when the file's first bytes match the image type it claims, so nothing else is stored under an image name. */
export function looksLikeImage(buffer: Buffer, mimeType: string) {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buffer[i] === b);
  switch (mimeType) {
    case 'image/jpeg': return starts(0xff, 0xd8, 0xff);
    case 'image/png': return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp': return buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
    default: return false;
  }
}

/**
 * Reads a multipart form with one 'photo' file (and text fields, which land in req.body). Throws a field error when
 * the photo is missing, too large or not a JPEG, PNG or WebP image.
 */
export async function receiveVehiclePhoto(req: Request, res: Response) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: VEHICLE_PHOTO_MAX_MB * 1024 * 1024, files: 1, fields: 10 },
  }).single('photo');
  await new Promise<void>((resolve, reject) =>
    upload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? `The photo must be ${VEHICLE_PHOTO_MAX_MB} MB or smaller.` : 'Add one photo of the vehicle.';
        return reject(new ValidationError(message, [{ field: 'photo', message }]));
      }
      reject(err);
    }),
  );
  const file = req.file;
  if (!file) throw new ValidationError('Add a photo of the vehicle.', [{ field: 'photo', message: 'Add a photo of the vehicle.' }]);
  if (!EXTENSIONS[file.mimetype] || !looksLikeImage(file.buffer, file.mimetype)) {
    throw new ValidationError('Use a JPEG, PNG or WebP photo.', [{ field: 'photo', message: 'Use a JPEG, PNG or WebP photo.' }]);
  }
  return { buffer: file.buffer, mimeType: file.mimetype };
}

/** Stores the photo under vehicles/ with a random name and returns its key in the upload store. */
export async function saveVehiclePhoto(uploadDir: string, photo: { buffer: Buffer; mimeType: string }) {
  const key = path.posix.join('vehicles', `${randomUUID()}.${EXTENSIONS[photo.mimeType]}`);
  await mkdir(path.resolve(uploadDir, 'vehicles'), { recursive: true });
  await writeFile(path.resolve(uploadDir, key), photo.buffer);
  return key;
}

/** The URL a page uses for a stored photo; the key's random name is added so a changed photo gets a new URL. */
export const photoUrl = (route: string, key: string | null) => (key ? `${route}?v=${path.posix.basename(key).slice(0, 8)}` : null);

/** Sends a file from the upload store; a missing file is "not found". The URL changes with the photo, so it can be cached. */
export async function sendStoredPhoto(res: Response, uploadDir: string, key: string | null | undefined) {
  if (!key) throw new NotFoundError('Photo not found.');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  await new Promise<void>((resolve, reject) =>
    res.sendFile(key, { root: path.resolve(uploadDir), dotfiles: 'deny' }, (err) =>
      err ? reject(res.headersSent ? err : new NotFoundError('This photo is not stored on this server.')) : resolve(),
    ),
  );
}
