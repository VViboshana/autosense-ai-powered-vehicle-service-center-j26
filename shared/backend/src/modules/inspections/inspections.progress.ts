import type { DamagePrediction, SoundAnalysis } from '../../integrations/ml/damageService.js';

/**
 * Live progress of a new inspection while the damage service analyses it, so the "analysing" screen shows real steps:
 * the browser picks an id, sends it with the upload, and polls GET /api/inspections/progress/:progressId. Kept in
 * memory only (one backend process), per user, and forgotten a minute after the last change.
 */
export type PhotoDone = { viewAngle: string; regions: number; possible: number; ms: number; model: string };
export type SoundDone = { situation: string; label: string | null; confidence: number | null; sure: boolean; familiar: boolean | null; windows: number; ms: number };
export type Progress = {
  stage: 'waiting' | 'photos' | 'sounds' | 'saving' | 'done' | 'failed';
  photos: { total: number; done: PhotoDone[] };
  sounds: { total: number; done: SoundDone[] };
  inspectionId: number | null;
};

export const PROGRESS_ID = /^[A-Za-z0-9-]{8,64}$/;
const KEEP_MS = 60_000;
const entries = new Map<string, { progress: Progress; at: number }>();

const key = (userId: number, progressId: string) => `${userId}:${progressId}`;

function sweep(now: number) {
  for (const [k, e] of entries) if (now - e.at > KEEP_MS) entries.delete(k);
}

export function readProgress(userId: number, progressId: string): Progress {
  sweep(Date.now());
  return entries.get(key(userId, progressId))?.progress ?? {
    stage: 'waiting', photos: { total: 0, done: [] }, sounds: { total: 0, done: [] }, inspectionId: null,
  };
}

/** What the service tells as it goes. A no-op reporter when the browser sent no progress id. */
export type Reporter = {
  start(photos: number, sounds: number): void;
  photo(viewAngle: string, result: DamagePrediction): void;
  sound(situation: string, analysis: SoundAnalysis): void;
  saving(): void;
  done(inspectionId: number): void;
  failed(): void;
};

export const silentReporter: Reporter = { start() {}, photo() {}, sound() {}, saving() {}, done() {}, failed() {} };

export function progressReporter(userId: number, progressId: string | undefined): Reporter {
  if (!progressId || !PROGRESS_ID.test(progressId)) return silentReporter;
  const k = key(userId, progressId);
  const p: Progress = { stage: 'waiting', photos: { total: 0, done: [] }, sounds: { total: 0, done: [] }, inspectionId: null };
  const touch = () => {
    const now = Date.now();
    sweep(now);
    entries.set(k, { progress: p, at: now });
  };
  return {
    start(photos, sounds) {
      p.stage = 'photos';
      p.photos.total = photos;
      p.sounds.total = sounds;
      touch();
    },
    photo(viewAngle, r) {
      const on = r.detections.filter((d) => d.onVehicle);
      p.photos.done.push({
        viewAngle,
        regions: on.filter((d) => !d.possible).length,
        possible: on.filter((d) => d.possible).length,
        ms: Math.round(r.processingMs),
        model: r.model.version,
      });
      if (p.photos.done.length === p.photos.total && p.sounds.total > 0) p.stage = 'sounds';
      touch();
    },
    sound(situation, a) {
      p.sounds.done.push({
        situation,
        label: a.result?.label ?? null,
        confidence: a.result?.confidence ?? null,
        sure: a.result?.sure ?? false,
        familiar: a.familiarity?.familiar ?? null,
        windows: a.windows,
        ms: Math.round(a.processingMs),
      });
      touch();
    },
    saving() {
      p.stage = 'saving';
      touch();
    },
    done(inspectionId) {
      p.stage = 'done';
      p.inspectionId = inspectionId;
      touch();
    },
    failed() {
      p.stage = 'failed';
      touch();
    },
  };
}
