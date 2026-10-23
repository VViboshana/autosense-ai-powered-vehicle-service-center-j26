import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type pg from 'pg';
import { z } from 'zod';
import { sendOk } from '../../http/envelope.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import {
  activateSoundVersion,
  analyseSound,
  soundVersions,
  startSoundTraining,
  trainingStatus,
  type SoundVersions,
} from '../../integrations/ml/damageService.js';
import { audit } from '../../lib/audit.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import { testSetMetrics } from '../inspections/inspections.repository.js';
import { SOUND_MODEL_NAME } from '../inspections/inspections.service.js';
import { AUDIO_TYPES, audioExtensionFor, isSoundLabel, SOUND_FAULTS, SOUND_LABELS } from '../inspections/inspections.sound.js';
import { damageFigures, soundFigures } from './ai.figures.js';
import { PACK_YAML, yoloLines } from './ai.pack.js';
import * as repo from './ai.repository.js';
import { zip } from './zip.js';

export type AiDeps = { pool: pg.Pool; damageServiceUrl?: string; uploadDir: string };

const MAX_LAB_FILES = 30;
const MAX_SOUND_MB = 10;
const runParam = z.object({ runId: z.string().regex(/^[0-9A-Za-z-]{6,40}$/) });
const versionParam = z.object({ versionNo: z.coerce.number().int().positive() });
const labParam = z.object({ id: z.coerce.number().int().positive() });
const labItemParam = labParam.extend({ itemId: z.coerce.number().int().positive() });
const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });
const labBody = z.object({
  name: z.string().trim().min(1, 'Give the test a name.').max(100),
  // One per recording, in the same order: the fault it really is
  labels: z.preprocess((v) => (v == null ? [] : Array.isArray(v) ? v : [v]), z.array(z.enum(SOUND_LABELS as [string, ...string[]]))),
});

/** The sound service's versions, or null (with the reason) when it is not running: the hub still shows the rest. */
async function versionsOrNull(url: string | undefined): Promise<{ data: SoundVersions | null; problem: string | null }> {
  try {
    return { data: await soundVersions(url), problem: null };
  } catch (err) {
    return { data: null, problem: err instanceof Error ? err.message : 'The damage service is not responding.' };
  }
}

async function receiveRecordings(req: Request, res: Response) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_SOUND_MB * 1024 * 1024, files: MAX_LAB_FILES, fields: MAX_LAB_FILES + 5 },
    fileFilter: (_req, file, accept) => accept(null, AUDIO_TYPES.includes(file.mimetype)),
  }).array('recordings', MAX_LAB_FILES);
  await new Promise<void>((resolve, reject) =>
    upload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        const message = err.code === 'LIMIT_FILE_SIZE' ? `Each recording must be ${MAX_SOUND_MB} MB or smaller.` : `Add at most ${MAX_LAB_FILES} recordings.`;
        return reject(new ValidationError(message, [{ field: 'recordings', message }]));
      }
      reject(err);
    }),
  );
  const files = (req.files ?? []) as Express.Multer.File[];
  if (!files.length) throw new ValidationError('Add at least one WAV, FLAC or OGG recording.', [{ field: 'recordings', message: 'Add a recording.' }]);
  return files;
}

/**
 * AI performance hub (DAMAGE_SETTINGS): how both models do in real use, the live feed of AI decisions, learning from
 * the app's own data (sound: retrain + activate; damage: training pack for Kaggle) and the sound Test lab.
 *
 *   GET  /api/ai/overview                       models in use, learning data collected, last training runs
 *   GET  /api/ai/activity?limit=                latest AI decisions and technicians' answers (live feed)
 *   GET  /api/ai/sound/performance              confusion per situation, calibration, per fault (+ test-set figures)
 *   GET  /api/ai/damage/insights                confusion (incl. missed / not damage) and calibration
 *   GET  /api/ai/damage/training-pack           zip: photos + YOLO labels from technicians' final decisions
 *   GET  /api/ai/sound/versions                 versions with their fair-test reports; which one is active
 *   POST /api/ai/sound/retrain                  start learning from the confirmed app recordings
 *   GET  /api/ai/sound/retrain/:runId           the run's live progress
 *   POST /api/ai/sound/versions/:versionNo/activate   use that version (also to roll back)
 *   GET  /api/ai/sound/lab | POST | GET /:id | GET /:id/items/:itemId/audio      Test lab
 */
export function aiRoutes(deps: AiDeps) {
  const router = Router();
  const { pool } = deps;
  router.use(requireScreen('DAMAGE_SETTINGS'));

  router.get('/overview', async (_req, res) => {
    const [learning, runs, damageTest, sound] = await Promise.all([
      repo.learningData(pool),
      repo.trainingRuns(pool, 10),
      testSetMetrics(pool, []),
      versionsOrNull(deps.damageServiceUrl),
    ]);
    const active = sound.data?.versions.find((v) => v.versionNo === sound.data!.active) ?? null;
    sendOk(res, {
      damage: { testSet: damageTest },
      sound: sound.data ? { serving: sound.data.serving, active, versions: sound.data.versions.length, running: sound.data.running } : null,
      soundProblem: sound.problem,
      learning: { ...learning, sound: { ...learning.sound, inActiveModel: active?.appRecordings ?? 0 } },
      runs,
    });
  });

  router.get('/activity', async (req, res) => {
    const { limit } = parse(activityQuery, req.query);
    sendOk(res, await repo.activity(pool, limit));
  });

  router.get('/sound/performance', async (_req, res) => {
    const [decisions, sound] = await Promise.all([repo.soundDecisions(pool), versionsOrNull(deps.damageServiceUrl)]);
    const active = sound.data?.versions.find((v) => v.versionNo === sound.data!.active) ?? null;
    sendOk(res, { ...soundFigures(decisions), testSet: active ? { version: active.version, ...active.comparison.new } : null });
  });

  router.get('/damage/insights', async (_req, res) => {
    sendOk(res, damageFigures(await repo.damageDecisions(pool)));
  });

  router.get('/damage/training-pack', async (_req, res) => {
    const photos = await repo.trainingPackPhotos(pool);
    if (!photos.length) throw new BusinessRuleError('NOTHING_TO_EXPORT', 'There are no confirmed inspections to learn from yet.');
    const files: { name: string; data: Buffer }[] = [];
    const manifest = ['image,inspection,regions,technician_added'];
    for (const p of photos) {
      let data: Buffer;
      try {
        data = await readFile(path.resolve(deps.uploadDir, p.storage_key));
      } catch {
        continue; // a photo stored on another computer: left out
      }
      const base = `app_${p.inspection_no}_${p.image_id}`;
      const ext = path.extname(p.storage_key) || '.jpg';
      files.push({ name: `images/${base}${ext}`, data });
      files.push({ name: `labels/${base}.txt`, data: Buffer.from(yoloLines(p.regions, p.width ?? 1280, p.height ?? 960).join('\n')) });
      manifest.push(`${base}${ext},${p.inspection_no},${p.regions.length},${p.regions.filter((r) => r.source === 'technician').length}`);
    }
    if (!files.length) throw new BusinessRuleError('NOTHING_TO_EXPORT', 'The photos are not stored on this server.');
    files.push({ name: 'data.yaml', data: Buffer.from(PACK_YAML) }, { name: 'manifest.csv', data: Buffer.from(manifest.join('\n')) });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="autosense-damage-training-pack-${stamp}.zip"`);
    res.send(zip(files));
  });

  router.get('/sound/versions', async (_req, res) => {
    const [versions, runs] = await Promise.all([soundVersions(deps.damageServiceUrl), repo.trainingRuns(pool)]);
    sendOk(res, { ...versions, runs });
  });

  router.post('/sound/retrain', async (req, res) => {
    const me = signedInUser(req);
    const rows = await repo.learnableRecordings(pool);
    if (!rows.length) {
      throw new BusinessRuleError('NOTHING_TO_LEARN', 'No technician-confirmed recordings yet: confirm some sound results in inspections first.');
    }
    const recordings = [];
    for (const r of rows) {
      try {
        const buffer = await readFile(path.resolve(deps.uploadDir, r.storage_key));
        const ext = path.extname(r.storage_key).slice(1) || 'wav';
        recordings.push({
          file: `sound-${r.sound_check_id}.${ext}`, buffer, mimeType: ext === 'flac' ? 'audio/flac' : ext === 'ogg' ? 'audio/ogg' : 'audio/wav',
          label: r.label, situation: r.situation, group: `app-vehicle-${r.vehicle_id}`, // one car's recordings stay together
        });
      } catch {
        // recorded on another computer: not available here
      }
    }
    if (!recordings.length) throw new BusinessRuleError('NOTHING_TO_LEARN', 'The confirmed recordings are not stored on this server.');
    const runId = await startSoundTraining(deps.damageServiceUrl, recordings);
    await repo.insertTrainingRun(pool, { runId, appRecordings: recordings.length, userId: me.userId });
    await audit(pool, { table: 'damage.sound_training_runs', recordId: 0, action: 'started', userId: me.userId, snapshot: { runId, recordings: recordings.length } });
    sendOk(res, { runId, appRecordings: recordings.length }, 202);
  });

  router.get('/sound/retrain/:runId', async (req, res) => {
    const { runId } = parse(runParam, req.params);
    const status = await trainingStatus(deps.damageServiceUrl, runId);
    if (status.state !== 'running') {
      await repo.finishTrainingRun(pool, {
        runId, state: status.state, versionNo: status.result?.versionNo ?? null, report: status.result, error: status.error,
      });
    }
    sendOk(res, status);
  });

  router.post('/sound/versions/:versionNo/activate', async (req, res) => {
    const me = signedInUser(req);
    const { versionNo } = parse(versionParam, req.params);
    const before = await soundVersions(deps.damageServiceUrl);
    const report = before.versions.find((v) => v.versionNo === versionNo);
    if (!report) throw new NotFoundError(`Sound model version ${versionNo} does not exist.`);
    const done = await activateSoundVersion(deps.damageServiceUrl, versionNo);
    await repo.registerActiveSoundModel(pool, { name: SOUND_MODEL_NAME, version: report.version, metrics: report });
    await audit(pool, {
      table: 'app.model_versions', recordId: versionNo, action: 'sound_model_activated', userId: me.userId,
      snapshot: { from: before.active, to: versionNo, version: report.version },
    });
    sendOk(res, done);
  });

  // ---------- Test lab ----------

  router.get('/sound/lab', async (_req, res) => {
    sendOk(res, await repo.labRuns(pool));
  });

  router.post('/sound/lab', async (req, res) => {
    const me = signedInUser(req);
    const files = await receiveRecordings(req, res);
    const body = parse(labBody, req.body);
    if (body.labels.length !== files.length) {
      throw new ValidationError('Give the real fault of every recording.', [{ field: 'labels', message: 'One fault per recording.' }]);
    }
    const versions = await soundVersions(deps.damageServiceUrl);
    const runId = await repo.insertLabRun(pool, { name: body.name, modelVersion: versions.serving.version, userId: me.userId });
    const folder = path.posix.join('sound-lab', String(runId));
    await mkdir(path.resolve(deps.uploadDir, folder), { recursive: true });
    for (const [n, f] of files.entries()) {
      const label = body.labels[n]!;
      if (!isSoundLabel(label)) continue;
      const situation = SOUND_FAULTS[label].situation;
      const storageKey = path.posix.join(folder, `${n + 1}.${audioExtensionFor(f.mimetype)}`);
      await writeFile(path.resolve(deps.uploadDir, storageKey), f.buffer);
      let a: Awaited<ReturnType<typeof analyseSound>> | null = null;
      try {
        a = await analyseSound(deps.damageServiceUrl, { buffer: f.buffer, filename: f.originalname, mimeType: f.mimetype }, situation);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err; // unreadable file: kept as "no answer"
      }
      await repo.insertLabItem(pool, {
        labRunId: runId, filename: f.originalname, storageKey, situation, trueLabel: label,
        predictedLabel: a?.result?.label ?? null, confidence: a?.result?.confidence ?? null, sure: a?.result?.sure ?? null,
        familiar: a?.familiarity?.familiar ?? null, quality: a?.quality ?? { warnings: ['The file could not be read.'] },
        probabilities: a?.probabilities ?? [], processingMs: a?.processingMs ?? 0,
      });
    }
    await audit(pool, { table: 'damage.sound_lab_runs', recordId: runId, action: 'created', userId: me.userId, snapshot: { name: body.name, recordings: files.length } });
    sendOk(res, await repo.labRun(pool, runId), 201);
  });

  router.get('/sound/lab/:id', async (req, res) => {
    const { id } = parse(labParam, req.params);
    const run = await repo.labRun(pool, id);
    if (!run) throw new NotFoundError('Test not found.');
    sendOk(res, run);
  });

  router.get('/sound/lab/:id/items/:itemId/audio', async (req, res) => {
    const { id, itemId } = parse(labItemParam, req.params);
    const key = await repo.labItemKey(pool, id, itemId);
    if (!key) throw new NotFoundError('Recording not found.');
    await new Promise<void>((resolve, reject) =>
      res.sendFile(key, { root: path.resolve(deps.uploadDir), dotfiles: 'deny' }, (err) =>
        err ? reject(res.headersSent ? err : new NotFoundError('This recording is not stored on this server.')) : resolve(),
      ),
    );
  });

  return router;
}
