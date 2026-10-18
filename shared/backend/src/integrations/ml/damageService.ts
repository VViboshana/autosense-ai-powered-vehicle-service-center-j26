import { z } from 'zod';
import { ServiceUnavailableError, ValidationError } from '../../http/errors.js';

/**
 * Client for the damage assessment service (member-2-damage-assessment, FastAPI): POST /predict with one photo.
 * The response is checked against the schema below, so a changed service shows up as a clear error here instead of
 * bad rows in the database. Never invent a result when the service fails: the caller gets a 503.
 */
const detection = z.object({
  label: z.string(),
  confidence: z.number().min(0).max(1),
  bbox: z.array(z.number()).length(4),
  polygon: z.array(z.array(z.number()).length(2)),
  areaPx: z.number(),
  onVehicle: z.boolean().default(true),
  areaRatioVehicle: z.number().nullable().default(null),
  location: z.string().nullable().default(null),
  severity: z.string().nullable().default(null),
  severityReason: z.string().nullable().default(null),
});

const prediction = z.object({
  model: z.object({ version: z.string(), placeholder: z.boolean() }),
  image: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  quality: z.object({ passed: z.boolean(), blurVar: z.number(), brightness: z.number(), warnings: z.array(z.string()) }),
  detections: z.array(detection),
  severity: z.object({ overall: z.string().nullable(), method: z.string(), validated: z.boolean() }),
  processingMs: z.number(),
});

export type DamagePrediction = z.infer<typeof prediction>;
export type PhotoUpload = { buffer: Buffer; filename: string; mimeType: string };

const NOT_RESPONDING = 'The damage service is not responding. Try again in a moment.';

export async function analysePhoto(baseUrl: string | undefined, photo: PhotoUpload, timeoutMs = 60_000): Promise<DamagePrediction> {
  if (!baseUrl) throw new ServiceUnavailableError('DAMAGE_SERVICE_NOT_CONFIGURED', 'The damage service is not set up (ML_DAMAGE_URL).');

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(photo.buffer)], { type: photo.mimeType }), photo.filename);

  let res: Response;
  try {
    res = await fetch(new URL('/predict', baseUrl), { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ServiceUnavailableError('DAMAGE_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  }

  const body: unknown = await res.json().catch(() => null);
  // 400/413: the service could not use the photo (not an image, too large). Its message is written for people.
  if (res.status === 400 || res.status === 413) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    throw new ValidationError(typeof detail === 'string' ? `${photo.filename}: ${detail}` : `${photo.filename} could not be read.`);
  }
  if (!res.ok) throw new ServiceUnavailableError('DAMAGE_SERVICE_UNAVAILABLE', NOT_RESPONDING);

  const parsed = prediction.safeParse(body);
  if (!parsed.success) throw new ServiceUnavailableError('DAMAGE_SERVICE_BAD_RESPONSE', 'The damage service sent a result in an unexpected format.');
  return parsed.data;
}
