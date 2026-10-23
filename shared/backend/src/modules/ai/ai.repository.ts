import type { Db } from '../../db/pool.js';
import type { SoundLabel, SoundSituation } from '../inspections/inspections.sound.js';
import type { DamageDecision, SoundDecision } from './ai.figures.js';

const USER_NAME = (alias: string) => `nullif(trim(${alias}.first_name || ' ' || ${alias}.last_name), '')`;

/** Confirmed inspections from a real model (alias i): the demo data's '…-sample' results are not measurements. */
const MEASURED = `i.status = 'confirmed' AND NOT EXISTS (
  SELECT 1 FROM app.model_versions s WHERE s.model_version_id = i.model_version_id AND s.version LIKE '%-sample')`;

/** Every sound result of a confirmed inspection, with the technician's final decision. */
export async function soundDecisions(db: Db, modelVersion?: string): Promise<SoundDecision[]> {
  const { rows } = await db.query(
    `SELECT s.situation, s.label, s.review_status, s.corrected_label, s.confidence, s.familiar
     FROM damage.sound_checks s
     JOIN damage.inspections i ON i.inspection_id = s.inspection_id
     LEFT JOIN app.model_versions mv ON mv.model_version_id = s.model_version_id
     WHERE i.status = 'confirmed' AND s.review_status <> 'pending' AND ($1::text IS NULL OR mv.version = $1)`,
    [modelVersion ?? null],
  );
  return rows.map((r) => ({
    situation: r.situation,
    label: r.label,
    finalLabel: r.review_status === 'rejected' ? null : (r.corrected_label ?? r.label),
    confidence: Number(r.confidence),
    familiar: r.familiar,
  }));
}

export async function damageDecisions(db: Db): Promise<DamageDecision[]> {
  const { rows } = await db.query(
    `SELECT d.label, d.corrected_label, d.review_status, d.source, d.is_suggestion, d.confidence
     FROM damage.detections d
     JOIN damage.inspection_images im USING (image_id)
     JOIN damage.inspections i ON i.inspection_id = im.inspection_id
     WHERE ${MEASURED}`,
  );
  return rows.map((r) => ({
    label: r.label,
    correctedLabel: r.corrected_label,
    reviewStatus: r.review_status,
    source: r.source,
    isSuggestion: r.is_suggestion,
    confidence: r.confidence === null ? null : Number(r.confidence),
  }));
}

/** Recordings the sound model can learn from: technician-confirmed or corrected results of confirmed inspections. */
export async function learnableRecordings(db: Db) {
  const { rows } = await db.query<{ sound_check_id: number; storage_key: string; situation: SoundSituation; label: SoundLabel; vehicle_id: number; created_at: string }>(
    `SELECT s.sound_check_id, s.storage_key, s.situation, COALESCE(s.corrected_label, s.label) AS label, i.vehicle_id, s.created_at
     FROM damage.sound_checks s JOIN damage.inspections i ON i.inspection_id = s.inspection_id
     WHERE i.status = 'confirmed' AND s.review_status IN ('confirmed', 'corrected')
     ORDER BY s.sound_check_id`,
  );
  return rows;
}

/** What the models can learn from, in numbers: shown as "learning data" in the hub. */
export async function learningData(db: Db) {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM damage.sound_checks s JOIN damage.inspections i USING (inspection_id)
         WHERE i.status = 'confirmed' AND s.review_status IN ('confirmed', 'corrected'))::int AS sound_learnable,
       (SELECT count(*) FROM damage.sound_checks s JOIN damage.inspections i USING (inspection_id)
         WHERE i.status = 'confirmed' AND s.review_status = 'corrected')::int AS sound_corrected,
       (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
         JOIN damage.inspections i ON i.inspection_id = im.inspection_id WHERE ${MEASURED} AND d.review_status = 'corrected')::int AS damage_corrected,
       (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
         JOIN damage.inspections i ON i.inspection_id = im.inspection_id WHERE ${MEASURED} AND d.source = 'technician')::int AS damage_missed,
       (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
         JOIN damage.inspections i ON i.inspection_id = im.inspection_id
         WHERE ${MEASURED} AND d.review_status = 'rejected' AND NOT d.is_suggestion)::int AS damage_false_alarms,
       (SELECT count(*) FROM damage.inspection_images im JOIN damage.inspections i ON i.inspection_id = im.inspection_id
         WHERE ${MEASURED})::int AS damage_photos`,
  );
  const r = rows[0];
  return {
    sound: { learnable: r.sound_learnable, corrected: r.sound_corrected },
    damage: { photos: r.damage_photos, corrected: r.damage_corrected, missed: r.damage_missed, falseAlarms: r.damage_false_alarms },
  };
}

/**
 * The latest AI moments, newest first: inspections analysed, sound results, technicians' decisions on regions and
 * sounds, training runs. One list for the hub's live feed.
 */
export async function activity(db: Db, limit: number) {
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT i.created_at AS at, 'analysed' AS kind, i.inspection_id, i.inspection_no, v.registration_no,
              json_build_object('photos', (SELECT count(*) FROM damage.inspection_images im WHERE im.inspection_id = i.inspection_id),
                                'regions', (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
                                            WHERE im.inspection_id = i.inspection_id AND NOT d.is_suggestion AND d.source = 'model'),
                                'sounds', (SELECT count(*) FROM damage.sound_checks s WHERE s.inspection_id = i.inspection_id),
                                'severity', i.overall_severity) AS detail,
              ${USER_NAME('cu')} AS who
       FROM damage.inspections i JOIN workshop.vehicles v ON v.vehicle_id = i.vehicle_id LEFT JOIN app.users cu ON cu.user_id = i.created_by
       UNION ALL
       SELECT s.created_at, 'heard', i.inspection_id, i.inspection_no, v.registration_no,
              json_build_object('situation', s.situation, 'label', s.label, 'confidence', s.confidence, 'sure', s.sure, 'familiar', s.familiar),
              NULL
       FROM damage.sound_checks s JOIN damage.inspections i ON i.inspection_id = s.inspection_id JOIN workshop.vehicles v ON v.vehicle_id = i.vehicle_id
       UNION ALL
       SELECT s.reviewed_at, 'sound_review', i.inspection_id, i.inspection_no, v.registration_no,
              json_build_object('situation', s.situation, 'label', s.label, 'decision', s.review_status, 'corrected', s.corrected_label, 'confidence', s.confidence),
              ${USER_NAME('ru')}
       FROM damage.sound_checks s JOIN damage.inspections i ON i.inspection_id = s.inspection_id JOIN workshop.vehicles v ON v.vehicle_id = i.vehicle_id
       LEFT JOIN app.users ru ON ru.user_id = s.reviewed_by
       WHERE s.reviewed_at IS NOT NULL
       UNION ALL
       SELECT d.reviewed_at, CASE WHEN d.source = 'technician' THEN 'missed' ELSE 'region_review' END, i.inspection_id, i.inspection_no, v.registration_no,
              json_build_object('label', d.label, 'decision', d.review_status, 'corrected', d.corrected_label, 'confidence', d.confidence, 'suggestion', d.is_suggestion),
              ${USER_NAME('ru')}
       FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
       JOIN damage.inspections i ON i.inspection_id = im.inspection_id JOIN workshop.vehicles v ON v.vehicle_id = i.vehicle_id
       LEFT JOIN app.users ru ON ru.user_id = d.reviewed_by
       WHERE d.reviewed_at IS NOT NULL
       UNION ALL
       SELECT coalesce(t.finished_at, t.started_at), 'training', NULL, NULL, NULL,
              json_build_object('state', t.state, 'recordings', t.app_recordings, 'version', t.version_no), ${USER_NAME('su')}
       FROM damage.sound_training_runs t LEFT JOIN app.users su ON su.user_id = t.started_by
     ) feed
     ORDER BY at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    at: r.at,
    kind: r.kind as 'analysed' | 'heard' | 'sound_review' | 'region_review' | 'missed' | 'training',
    inspectionId: r.inspection_id,
    inspectionNo: r.inspection_no,
    registrationNo: r.registration_no,
    detail: r.detail,
    who: r.who,
  }));
}

// ---------- training runs ----------

export async function insertTrainingRun(db: Db, r: { runId: string; appRecordings: number; userId: number }) {
  await db.query('INSERT INTO damage.sound_training_runs (run_id, app_recordings, started_by) VALUES ($1, $2, $3)', [r.runId, r.appRecordings, r.userId]);
}

/** Records how a run ended (once: a finished run is not changed again). */
export async function finishTrainingRun(db: Db, r: { runId: string; state: 'done' | 'failed'; versionNo: number | null; report: unknown; error: string | null }) {
  await db.query(
    `UPDATE damage.sound_training_runs SET state = $2, version_no = $3, report = $4, error = $5, finished_at = now()
     WHERE run_id = $1 AND state = 'running'`,
    [r.runId, r.state, r.versionNo, r.report === null ? null : JSON.stringify(r.report), r.error?.slice(0, 500) ?? null],
  );
}

export async function trainingRuns(db: Db, limit = 20) {
  const { rows } = await db.query(
    `SELECT t.run_id, t.state, t.app_recordings, t.version_no, t.error, t.started_at, t.finished_at, ${USER_NAME('u')} AS started_by
     FROM damage.sound_training_runs t LEFT JOIN app.users u ON u.user_id = t.started_by
     ORDER BY t.started_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    runId: r.run_id, state: r.state, appRecordings: r.app_recordings, versionNo: r.version_no, error: r.error,
    startedAt: r.started_at, finishedAt: r.finished_at, startedBy: r.started_by,
  }));
}

/** Registers the activated sound model version as the active one of its name (app.model_versions). */
export async function registerActiveSoundModel(db: Db, m: { name: string; version: string; metrics: unknown }) {
  await db.query(`UPDATE app.model_versions SET is_active = false WHERE component = 'damage' AND name = $1`, [m.name]);
  await db.query(
    `INSERT INTO app.model_versions (component, name, version, metrics, notes, is_active)
     VALUES ('damage', $1, $2, $3, 'Activated in the AI performance hub', true)
     ON CONFLICT (component, name, version) DO UPDATE SET metrics = EXCLUDED.metrics, is_active = true`,
    [m.name, m.version, JSON.stringify(m.metrics ?? {})],
  );
}

// ---------- damage training pack ----------

/** Photos of confirmed inspections with their final regions, for a YOLO segmentation training pack. */
export async function trainingPackPhotos(db: Db) {
  const images = await db.query<{ image_id: number; inspection_no: string; storage_key: string; width: number | null; height: number | null }>(
    `SELECT im.image_id, i.inspection_no, im.storage_key, im.width, im.height
     FROM damage.inspection_images im JOIN damage.inspections i ON i.inspection_id = im.inspection_id
     WHERE ${MEASURED} ORDER BY im.image_id`,
  );
  const regions = await db.query<{ image_id: number; label: string; polygon: number[][] | null; bbox: number[]; source: string }>(
    `SELECT d.image_id, COALESCE(d.corrected_label, d.label) AS label, d.polygon, d.bbox, d.source
     FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
     JOIN damage.inspections i ON i.inspection_id = im.inspection_id
     WHERE ${MEASURED} AND d.review_status <> 'rejected' AND (NOT d.is_suggestion OR d.review_status IN ('confirmed', 'corrected'))`,
  );
  return images.rows.map((im) => ({ ...im, regions: regions.rows.filter((r) => r.image_id === im.image_id) }));
}

// ---------- test lab ----------

export async function insertLabRun(db: Db, r: { name: string; modelVersion: string; userId: number }): Promise<number> {
  const { rows } = await db.query<{ lab_run_id: number }>(
    'INSERT INTO damage.sound_lab_runs (name, model_version, created_by) VALUES ($1, $2, $3) RETURNING lab_run_id',
    [r.name, r.modelVersion, r.userId],
  );
  return rows[0]!.lab_run_id;
}

export async function insertLabItem(
  db: Db,
  it: { labRunId: number; filename: string; storageKey: string; situation: string; trueLabel: string; predictedLabel: string | null;
        confidence: number | null; sure: boolean | null; familiar: boolean | null; quality: unknown; probabilities: unknown; processingMs: number },
) {
  await db.query(
    `INSERT INTO damage.sound_lab_items (lab_run_id, filename, storage_key, situation, true_label, predicted_label, confidence, sure,
                                         familiar, quality, probabilities, processing_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [it.labRunId, it.filename.slice(0, 200), it.storageKey, it.situation, it.trueLabel, it.predictedLabel, it.confidence, it.sure,
     it.familiar, JSON.stringify(it.quality), JSON.stringify(it.probabilities), Math.round(it.processingMs)],
  );
}

export async function labRuns(db: Db) {
  const { rows } = await db.query(
    `SELECT r.lab_run_id, r.name, r.model_version, r.created_at, ${USER_NAME('u')} AS created_by,
            count(it.*)::int AS items, count(*) FILTER (WHERE it.predicted_label = it.true_label)::int AS correct
     FROM damage.sound_lab_runs r LEFT JOIN damage.sound_lab_items it ON it.lab_run_id = r.lab_run_id
     LEFT JOIN app.users u ON u.user_id = r.created_by
     GROUP BY r.lab_run_id, u.first_name, u.last_name ORDER BY r.created_at DESC`,
  );
  return rows.map((r) => ({
    labRunId: r.lab_run_id, name: r.name, modelVersion: r.model_version, createdAt: r.created_at, createdBy: r.created_by,
    items: r.items, correct: r.correct,
  }));
}

export async function labRun(db: Db, id: number) {
  const head = await db.query(
    `SELECT r.lab_run_id, r.name, r.model_version, r.created_at, ${USER_NAME('u')} AS created_by
     FROM damage.sound_lab_runs r LEFT JOIN app.users u ON u.user_id = r.created_by WHERE r.lab_run_id = $1`,
    [id],
  );
  if (!head.rows[0]) return null;
  const items = await db.query('SELECT * FROM damage.sound_lab_items WHERE lab_run_id = $1 ORDER BY lab_item_id', [id]);
  const h = head.rows[0];
  return {
    labRunId: h.lab_run_id, name: h.name, modelVersion: h.model_version, createdAt: h.created_at, createdBy: h.created_by,
    items: items.rows.map((it) => ({
      labItemId: it.lab_item_id,
      filename: it.filename,
      url: `/api/ai/sound/lab/${id}/items/${it.lab_item_id}/audio`,
      situation: it.situation as SoundSituation,
      trueLabel: it.true_label as SoundLabel,
      predictedLabel: it.predicted_label as SoundLabel | null,
      confidence: it.confidence === null ? null : Number(it.confidence),
      sure: it.sure,
      familiar: it.familiar,
      quality: it.quality,
      probabilities: it.probabilities,
    })),
  };
}

export async function labItemKey(db: Db, runId: number, itemId: number): Promise<string | null> {
  const { rows } = await db.query<{ storage_key: string }>(
    'SELECT storage_key FROM damage.sound_lab_items WHERE lab_run_id = $1 AND lab_item_id = $2',
    [runId, itemId],
  );
  return rows[0]?.storage_key ?? null;
}
