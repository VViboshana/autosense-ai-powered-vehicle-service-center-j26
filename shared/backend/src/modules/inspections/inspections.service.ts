import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { withTransaction } from '../../db/pool.js';
import { BusinessRuleError, NotFoundError, ServiceUnavailableError, ValidationError } from '../../http/errors.js';
import {
  analysePhoto,
  analyseSound,
  type DamagePrediction,
  type PhotoUpload,
  type SoundAnalysis,
  type SoundUpload,
} from '../../integrations/ml/damageService.js';
import { audit } from '../../lib/audit.js';
import { moveStage } from '../jobs/jobs.repository.js';
import * as repo from './inspections.repository.js';
import type { ReviewDecision, ViewAngle } from './inspections.repository.js';
import { extensionFor, finalSeverity, formatInspectionNo, isDamageLabel, worstSeverity, type DamageLabel, type Severity } from './inspections.rules.js';
import { mechanicalPlan } from './inspections.mechanical.js';
import { silentReporter, type Reporter } from './inspections.progress.js';
import { audioExtensionFor, belongsTo, SOUND_FAULTS, type SoundLabel, type SoundSituation } from './inspections.sound.js';

export type InspectionDeps = { pool: pg.Pool; damageServiceUrl?: string; uploadDir: string };
export type SoundRecording = SoundUpload & { situation: SoundSituation };

/** Registered in app.model_versions next to the damage model (same component, its own name). */
export const SOUND_MODEL_NAME = 'panns-mfcc-sound-classifier';

/**
 * New inspection: every photo, and every sound recording (optional, one per situation), goes to the damage service
 * first. Only when all of them have a result are the inspection, photos, detections and sound results saved, in one
 * transaction, as 'awaiting_review'. If the service fails, nothing is saved and staff try again (503). A recording the
 * service cannot use (silent, too short) is refused with its reason, so staff record it again. Damage the service
 * found outside the inspected vehicle (onVehicle: false) is not stored: it belongs to another car in the photo.
 * Possible damage (weaker regions) is stored as suggestions.
 */
export async function createInspection(
  deps: InspectionDeps,
  input: { jobId?: number; vehicleId?: number; viewAngles: ViewAngle[]; photos: PhotoUpload[]; sounds?: SoundRecording[]; userId: number },
  report: Reporter = silentReporter,
) {
  try {
    const id = await analyseAndSave(deps, input, report);
    report.done(id);
    return id;
  } catch (err) {
    report.failed();
    throw err;
  }
}

async function analyseAndSave(
  deps: InspectionDeps,
  input: { jobId?: number; vehicleId?: number; viewAngles: ViewAngle[]; photos: PhotoUpload[]; sounds?: SoundRecording[]; userId: number },
  report: Reporter,
) {
  const target = await repo.findJobOrVehicle(deps.pool, input);
  if (!target) throw new NotFoundError(input.jobId ? 'That job does not exist.' : 'That vehicle does not exist.');
  if (input.jobId && input.vehicleId && input.vehicleId !== target.vehicleId) {
    throw new ValidationError('The vehicle does not match the job.', [{ field: 'vehicleId', message: 'This job is for another vehicle.' }]);
  }
  if (target.jobStage === 'cancelled') throw new BusinessRuleError('JOB_CANCELLED', 'This job was cancelled.');

  // One photo at a time: the service runs one prediction at a time anyway.
  const sounds = input.sounds ?? [];
  report.start(input.photos.length, sounds.length);
  const results: DamagePrediction[] = [];
  for (const [n, photo] of input.photos.entries()) {
    const result = await analysePhoto(deps.damageServiceUrl, photo);
    results.push(result);
    report.photo(input.viewAngles[n] ?? 'other', result);
  }

  if (results.some((r) => r.model.placeholder)) {
    throw new ServiceUnavailableError(
      'DAMAGE_MODEL_NOT_READY',
      'The damage model is not installed on the damage service yet, so photos cannot be assessed.',
    );
  }
  const versions = new Set(results.map((r) => `${r.model.version}|${r.severity.method}`));
  if (versions.size > 1) throw new ServiceUnavailableError('DAMAGE_MODEL_CHANGED', 'The damage model changed while the photos were assessed. Try again.');
  const first = results[0]!;

  const heard: SoundAnalysis[] = [];
  for (const sound of sounds) {
    const analysis = await analyseSound(deps.damageServiceUrl, sound, sound.situation);
    report.sound(sound.situation, analysis);
    if (!analysis.result) {
      const why = analysis.quality.warnings[0] ?? 'The recording could not be used.';
      throw new ValidationError(`${capitalise(sound.situation)} recording: ${why}`, [{ field: 'sounds', message: why }]);
    }
    if (!belongsTo(analysis.result.label, sound.situation)) {
      throw new ServiceUnavailableError('DAMAGE_SERVICE_BAD_RESPONSE', `The damage service returned an unknown sound fault "${analysis.result.label}".`);
    }
    heard.push(analysis);
  }

  report.saving();
  const id = await repo.nextInspectionId(deps.pool);
  const inspectionNo = formatInspectionNo(id);
  const folder = path.join('inspections', inspectionNo);
  try {
    await withTransaction(deps.pool, async (client) => {
      await repo.insertInspection(client, {
        inspectionId: id,
        inspectionNo,
        jobId: target.jobId,
        vehicleId: target.vehicleId,
        overallSeverity: worstSeverity(results.map((r) => r.severity.overall)),
        severityMethod: first.severity.method,
        modelVersionId: await repo.modelVersionId(client, first.model.version),
        userId: input.userId,
      });
      // Service flow: a vehicle in a bay that was not sent for inspection yet is now being inspected
      if (target.jobId && target.jobStage === 'in_bay') {
        await moveStage(client, { jobId: target.jobId, from: ['in_bay'], to: 'inspecting', userId: input.userId, note: `Damage inspection ${inspectionNo} started` });
      }
      await mkdir(path.resolve(deps.uploadDir, folder), { recursive: true });

      for (const [n, result] of results.entries()) {
        const photo = input.photos[n]!;
        const viewAngle = input.viewAngles[n] ?? 'other';
        const storageKey = path.posix.join('inspections', inspectionNo, `${n + 1}-${viewAngle}.${extensionFor(photo.mimeType)}`);
        await writeFile(path.resolve(deps.uploadDir, storageKey), photo.buffer);
        const imageId = await repo.insertImage(client, {
          inspectionId: id,
          viewAngle,
          storageKey,
          width: result.image.width,
          height: result.image.height,
          // A side photo without a vehicle (the close-up slot may show only part of one): say so to the technician
          quality: !result.vehicle && viewAngle !== 'other'
            ? { ...result.quality, warnings: [...result.quality.warnings, 'No vehicle was found in this photo: check that the marked damage is on the vehicle.'] }
            : result.quality,
          processingMs: result.processingMs,
        });
        for (const d of result.detections) {
          if (!d.onVehicle) continue;
          if (!isDamageLabel(d.label)) {
            throw new ServiceUnavailableError('DAMAGE_SERVICE_BAD_RESPONSE', `The damage service returned an unknown damage type "${d.label}".`);
          }
          await repo.insertDetection(client, {
            imageId,
            label: d.label,
            confidence: d.confidence,
            bbox: d.bbox,
            polygon: d.polygon,
            areaPx: d.areaPx,
            areaRatioVehicle: d.areaRatioVehicle,
            location: d.location,
            severity: d.severity,
            severityReason: d.severityReason,
            isSuggestion: d.possible,
          });
        }
      }
      for (const [n, analysis] of heard.entries()) {
        const sound = sounds[n]!;
        const storageKey = path.posix.join('inspections', inspectionNo, `sound-${sound.situation}.${audioExtensionFor(sound.mimeType)}`);
        await writeFile(path.resolve(deps.uploadDir, storageKey), sound.buffer);
        await repo.insertSoundCheck(client, {
          inspectionId: id,
          situation: sound.situation,
          storageKey,
          durationS: analysis.quality.durationS,
          quality: analysis.quality,
          label: analysis.result!.label as SoundLabel,
          confidence: analysis.result!.confidence,
          sure: analysis.result!.sure,
          probabilities: analysis.probabilities,
          modelVersionId: await repo.modelVersionId(client, analysis.model.version, SOUND_MODEL_NAME),
          processingMs: analysis.processingMs,
          familiarity: analysis.familiarity,
        });
      }
      await audit(client, {
        table: 'damage.inspections',
        recordId: id,
        action: 'created',
        userId: input.userId,
        snapshot: {
          inspectionNo, vehicleId: target.vehicleId, jobId: target.jobId, photos: results.length, modelVersion: first.model.version,
          sounds: heard.map((h, n) => ({ situation: sounds[n]!.situation, label: h.result!.label, modelVersion: h.model.version })),
        },
      });
    });
  } catch (err) {
    await rm(path.resolve(deps.uploadDir, folder), { recursive: true, force: true }); // no photos without a saved inspection
    throw err;
  }
  return id;
}

/** A technician's decision on one damage region: confirm it, correct its type and/or severity, or reject it. */
export async function reviewDetection(
  pool: pg.Pool,
  r: { inspectionId: number; detectionId: number; decision: ReviewDecision; label?: DamageLabel; severity?: Severity; userId: number },
) {
  await withTransaction(pool, async (client) => {
    await lockForReview(client, r.inspectionId);
    const detection = (await repo.detectionsForReview(client, r.inspectionId)).find((d) => d.detection_id === r.detectionId);
    if (!detection) throw new NotFoundError('This damage region is not part of the inspection.');

    await repo.setDetectionReview(client, {
      detectionId: r.detectionId,
      decision: r.decision,
      label: r.decision === 'corrected' ? (r.label ?? null) : null,
      severity: r.decision === 'corrected' ? (r.severity ?? null) : null,
      userId: r.userId,
    });
    await audit(client, {
      table: 'damage.detections',
      recordId: r.detectionId,
      action: r.decision,
      userId: r.userId,
      snapshot: { inspectionId: r.inspectionId, from: { label: detection.label, severity: detection.severity }, to: { label: r.label, severity: r.severity } },
    });
  });
}

/**
 * A technician's decision on one sound result: confirm the fault, correct it to another fault of the same situation
 * (the recording was of that situation), or reject it. Each decision is a measured check of the sound model.
 */
export async function reviewSound(
  pool: pg.Pool,
  r: { inspectionId: number; soundCheckId: number; decision: ReviewDecision; label?: SoundLabel; userId: number },
) {
  await withTransaction(pool, async (client) => {
    await lockForReview(client, r.inspectionId);
    const sound = await repo.soundCheckForReview(client, r.inspectionId, r.soundCheckId);
    if (!sound) throw new NotFoundError('This sound result is not part of the inspection.');
    if (r.decision === 'corrected' && (!r.label || !belongsTo(r.label, sound.situation))) {
      throw new ValidationError(`Choose a ${sound.situation} fault.`, [{ field: 'label', message: `The recording is of the vehicle ${sound.situation}.` }]);
    }
    const label = r.decision === 'corrected' && r.label !== sound.label ? r.label! : null;
    // Correcting to the model's own answer is a confirmation
    const decision = r.decision === 'corrected' && !label ? 'confirmed' : r.decision;
    await repo.setSoundReview(client, { soundCheckId: r.soundCheckId, decision, label, userId: r.userId });
    await audit(client, {
      table: 'damage.sound_checks',
      recordId: r.soundCheckId,
      action: decision,
      userId: r.userId,
      snapshot: { inspectionId: r.inspectionId, situation: sound.situation, from: sound.label, to: label },
    });
  });
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The inspection, locked, and still open for review; otherwise the right error. */
async function lockForReview(client: pg.PoolClient, inspectionId: number) {
  const inspection = await repo.lockInspection(client, inspectionId);
  if (!inspection) throw new NotFoundError('Inspection not found.');
  if (inspection.status !== 'awaiting_review') {
    throw new BusinessRuleError('NOT_UNDER_REVIEW', `This inspection is ${inspection.status.replace('_', ' ')}, so it can no longer be changed.`);
  }
  return inspection;
}

/**
 * Damage the model missed, marked by a technician with a box on the photo. The technician gives the type and the
 * severity (no rule is applied: they are the expert). It counts like any confirmed region, and each one is a measured
 * miss of the model and a new labelled example for retraining.
 */
export async function addTechnicianRegion(
  pool: pg.Pool,
  r: { inspectionId: number; imageId: number; label: DamageLabel; severity: Severity; bbox: number[]; userId: number },
) {
  return withTransaction(pool, async (client) => {
    await lockForReview(client, r.inspectionId);
    const image = await repo.inspectionImage(client, r.inspectionId, r.imageId);
    if (!image) throw new NotFoundError('This photo is not part of the inspection.');
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = r.bbox;
    if ((image.width && x2 > image.width) || (image.height && y2 > image.height)) {
      throw new ValidationError('The box is outside the photo.', [{ field: 'bbox', message: 'Draw the box on the photo.' }]);
    }
    const bbox = [x1, y1, x2, y2].map(Math.round);
    const detectionId = await repo.insertTechnicianRegion(client, { ...r, bbox });
    await audit(client, {
      table: 'damage.detections',
      recordId: detectionId,
      action: 'added_by_technician',
      userId: r.userId,
      snapshot: { inspectionId: r.inspectionId, imageId: r.imageId, label: r.label, severity: r.severity, bbox },
    });
    return detectionId;
  });
}

export async function removeTechnicianRegion(pool: pg.Pool, r: { inspectionId: number; detectionId: number; userId: number }) {
  await withTransaction(pool, async (client) => {
    await lockForReview(client, r.inspectionId);
    if (!(await repo.deleteTechnicianRegion(client, r.inspectionId, r.detectionId))) {
      throw new NotFoundError('Only damage a technician added can be removed; reject the model\'s regions instead.');
    }
    await audit(client, { table: 'damage.detections', recordId: r.detectionId, action: 'removed', userId: r.userId, snapshot: { inspectionId: r.inspectionId } });
  });
}

/**
 * Confirming makes the inspection final: every region must have been reviewed first. The overall severity is worked
 * out again from the reviewed values, and an inspection.report event tells the other components.
 */
export async function confirmInspection(pool: pg.Pool, c: { inspectionId: number; notes: string | null; userId: number }) {
  await withTransaction(pool, async (client) => {
    const inspection = await repo.lockInspection(client, c.inspectionId);
    if (!inspection) throw new NotFoundError('Inspection not found.');
    if (inspection.status !== 'awaiting_review') {
      throw new BusinessRuleError('NOT_UNDER_REVIEW', `This inspection is ${inspection.status.replace('_', ' ')}, so it cannot be confirmed.`);
    }
    let detections = await repo.detectionsForReview(client, c.inspectionId);
    const pending = detections.filter((d) => d.review_status === 'pending' && !d.is_suggestion).length;
    if (pending) {
      throw new BusinessRuleError('DETECTIONS_PENDING', `Review every damage region first (${pending} still to review).`);
    }
    const soundsPending = await repo.pendingSoundChecks(client, c.inspectionId);
    if (soundsPending) {
      throw new BusinessRuleError('SOUNDS_PENDING', `Review every sound result first (${soundsPending} still to review).`);
    }
    // Possible damage nobody accepted is recorded as dismissed by the person confirming (kept for measuring suggestions)
    const dismissed = await repo.dismissOpenSuggestions(client, c.inspectionId, c.userId);
    if (dismissed) detections = await repo.detectionsForReview(client, c.inspectionId);

    const kept = detections.filter((d) => d.review_status !== 'rejected');
    const overallSeverity = worstSeverity(
      kept.map((d) => finalSeverity({ reviewStatus: d.review_status, severity: d.severity, correctedSeverity: d.corrected_severity })),
    );
    await repo.markConfirmed(client, { inspectionId: c.inspectionId, overallSeverity, notes: c.notes, userId: c.userId });
    // Sound findings do not change the damage severity; they travel in the report event for the maintenance forecast
    const heard = await repo.keptSoundFindings(client, c.inspectionId);
    const sounds = heard.map((s) => ({ ...s, normal: SOUND_FAULTS[s.label].normal }));
    const mechanical = mechanicalPlan(heard);
    // Service flow: the job's damage inspection is done (the vehicle stays in its bay until it is ready)
    if (inspection.job_id) {
      await moveStage(client, {
        jobId: inspection.job_id, from: ['in_bay', 'inspecting'], to: 'inspected', userId: c.userId,
        note: `Damage inspection ${inspection.inspection_no} confirmed`,
      });
    }
    await client.query(
      `INSERT INTO app.events (event_type, source, payload, occurred_at) VALUES ('inspection.report', 'api.inspections', $1, now())`,
      [JSON.stringify({
        inspectionId: c.inspectionId,
        inspectionNo: inspection.inspection_no,
        vehicleId: inspection.vehicle_id,
        jobId: inspection.job_id,
        overallSeverity,
        damage: kept.map((d) => ({ label: d.corrected_label ?? d.label, severity: d.corrected_severity ?? d.severity })),
        sounds,
        // Mechanical work from the sounds (sound-repair-v0): priority, services and proposed hours for the forecast
        mechanical: { method: mechanical.method, priority: mechanical.priority, services: mechanical.services, effortHours: mechanical.effortHours },
        // Everything the maintenance forecast needs, in its terms (inspection-handover-v1, docs/forecast-handover.md)
        handover: (await repo.getInspection(client, c.inspectionId))!.handover,
      })],
    );
    await audit(client, {
      table: 'damage.inspections',
      recordId: c.inspectionId,
      action: 'confirmed',
      userId: c.userId,
      snapshot: { overallSeverity, kept: kept.length, rejected: detections.length - kept.length, suggestionsDismissed: dismissed, sounds: sounds.length },
    });
  });
}
