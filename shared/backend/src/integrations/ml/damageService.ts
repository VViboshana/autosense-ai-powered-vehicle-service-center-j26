import { z } from 'zod';
import { ServiceUnavailableError, ValidationError } from '../../http/errors.js';

/**
 * Client for the damage assessment service (member-2-damage-assessment, FastAPI): POST /predict with one photo, and
 * POST /analyze-audio with one sound recording.
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
  possible: z.boolean().default(false), // weaker region, for the technician to accept or dismiss
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

/** POST /analyze-audio: one recording and the situation it was made in -> the most likely fault of that situation. */
const soundAnalysis = z.object({
  model: z.object({ version: z.string(), experiment: z.string(), trained: z.string() }),
  situation: z.string(),
  quality: z.object({
    passed: z.boolean(),
    usable: z.boolean(),
    durationS: z.number(),
    clippedRatio: z.number(),
    rms: z.number(),
    warnings: z.array(z.string()),
  }),
  windows: z.number().int(),
  // null when the recording could not be used (silent, too short): no prediction is made
  result: z.object({ label: z.string(), confidence: z.number().min(0).max(1), sure: z.boolean() }).nullable(),
  probabilities: z.array(z.object({ label: z.string(), probability: z.number().min(0).max(1) })),
  processingMs: z.number(),
});

export type SoundAnalysis = z.infer<typeof soundAnalysis>;
export type SoundUpload = { buffer: Buffer; filename: string; mimeType: string };

export async function analyseSound(
  baseUrl: string | undefined,
  sound: SoundUpload,
  situation: string,
  timeoutMs = 60_000,
): Promise<SoundAnalysis> {
  if (!baseUrl) throw new ServiceUnavailableError('DAMAGE_SERVICE_NOT_CONFIGURED', 'The damage service is not set up (ML_DAMAGE_URL).');

  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(sound.buffer)], { type: sound.mimeType }), sound.filename);
  const url = new URL('/analyze-audio', baseUrl);
  url.searchParams.set('situation', situation);

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ServiceUnavailableError('DAMAGE_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  }

  const body: unknown = await res.json().catch(() => null);
  if (res.status === 400 || res.status === 413) {
    const detail = (body as { detail?: unknown } | null)?.detail;
    throw new ValidationError(typeof detail === 'string' ? `${sound.filename}: ${detail}` : `${sound.filename} could not be read.`);
  }
  // 503 from a running service: it is up but has no sound model (acoustic/model/sound_classifier.joblib)
  if (res.status === 503) {
    throw new ServiceUnavailableError('SOUND_MODEL_NOT_READY', 'The sound model is not installed on the damage service, so recordings cannot be assessed.');
  }
  if (!res.ok) throw new ServiceUnavailableError('DAMAGE_SERVICE_UNAVAILABLE', NOT_RESPONDING);

  const parsed = soundAnalysis.safeParse(body);
  if (!parsed.success) throw new ServiceUnavailableError('DAMAGE_SERVICE_BAD_RESPONSE', 'The damage service sent a result in an unexpected format.');
  return parsed.data;
}
