import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { withTransaction } from '../../db/pool.js';
import { BusinessRuleError, NotFoundError, ServiceUnavailableError, ValidationError } from '../../http/errors.js';
import { analysePhoto, type DamagePrediction, type PhotoUpload } from '../../integrations/ml/damageService.js';
import { audit } from '../../lib/audit.js';
import * as repo from './inspections.repository.js';
import type { ReviewDecision, ViewAngle } from './inspections.repository.js';
import { extensionFor, finalSeverity, formatInspectionNo, isDamageLabel, worstSeverity, type DamageLabel, type Severity } from './inspections.rules.js';

export type InspectionDeps = { pool: pg.Pool; damageServiceUrl?: string; uploadDir: string };

/**
 * New inspection: every photo goes to the damage service first. Only when all of them have a result are the
 * inspection, photos and detections saved, in one transaction, as 'awaiting_review'. If the service fails, nothing
 * is saved and staff try again (503). Damage the service found outside the inspected vehicle (onVehicle: false) is
 * not stored: it belongs to another car in the photo.
 */
export async function createInspection(
  deps: InspectionDeps,
  input: { jobId?: number; vehicleId?: number; viewAngles: ViewAngle[]; photos: PhotoUpload[]; userId: number },
) {
  const target = await repo.findJobOrVehicle(deps.pool, input);
  if (!target) throw new NotFoundError(input.jobId ? 'That job does not exist.' : 'That vehicle does not exist.');
  if (input.jobId && input.vehicleId && input.vehicleId !== target.vehicleId) {
    throw new ValidationError('The vehicle does not match the job.', [{ field: 'vehicleId', message: 'This job is for another vehicle.' }]);
  }
  if (target.jobStage === 'cancelled') throw new BusinessRuleError('JOB_CANCELLED', 'This job was cancelled.');

  // One photo at a time: the service runs one prediction at a time anyway.
  const results: DamagePrediction[] = [];
  for (const photo of input.photos) results.push(await analysePhoto(deps.damageServiceUrl, photo));

  if (results.some((r) => r.model.placeholder)) {
    throw new ServiceUnavailableError(
      'DAMAGE_MODEL_NOT_READY',
      'The damage model is not installed on the damage service yet, so photos cannot be assessed.',
    );
  }
  const versions = new Set(results.map((r) => `${r.model.version}|${r.severity.method}`));
  if (versions.size > 1) throw new ServiceUnavailableError('DAMAGE_MODEL_CHANGED', 'The damage model changed while the photos were assessed. Try again.');
  const first = results[0]!;

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
          quality: result.quality,
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
          });
        }
      }
      await audit(client, {
        table: 'damage.inspections',
        recordId: id,
        action: 'created',
        userId: input.userId,
        snapshot: { inspectionNo, vehicleId: target.vehicleId, jobId: target.jobId, photos: results.length, modelVersion: first.model.version },
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
    const inspection = await repo.lockInspection(client, r.inspectionId);
    if (!inspection) throw new NotFoundError('Inspection not found.');
    if (inspection.status !== 'awaiting_review') {
      throw new BusinessRuleError('NOT_UNDER_REVIEW', `This inspection is ${inspection.status.replace('_', ' ')}, so it can no longer be changed.`);
    }
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
    const detections = await repo.detectionsForReview(client, c.inspectionId);
    const pending = detections.filter((d) => d.review_status === 'pending').length;
    if (pending) {
      throw new BusinessRuleError('DETECTIONS_PENDING', `Review every damage region first (${pending} still to review).`);
    }

    const kept = detections.filter((d) => d.review_status !== 'rejected');
    const overallSeverity = worstSeverity(
      kept.map((d) => finalSeverity({ reviewStatus: d.review_status, severity: d.severity, correctedSeverity: d.corrected_severity })),
    );
    await repo.markConfirmed(client, { inspectionId: c.inspectionId, overallSeverity, notes: c.notes, userId: c.userId });
    await client.query(
      `INSERT INTO app.events (event_type, source, payload, occurred_at) VALUES ('inspection.report', 'api.inspections', $1, now())`,
      [JSON.stringify({
        inspectionId: c.inspectionId,
        inspectionNo: inspection.inspection_no,
        vehicleId: inspection.vehicle_id,
        jobId: inspection.job_id,
        overallSeverity,
        damage: kept.map((d) => ({ label: d.corrected_label ?? d.label, severity: d.corrected_severity ?? d.severity })),
      })],
    );
    await audit(client, {
      table: 'damage.inspections',
      recordId: c.inspectionId,
      action: 'confirmed',
      userId: c.userId,
      snapshot: { overallSeverity, kept: kept.length, rejected: detections.length - kept.length },
    });
  });
}
