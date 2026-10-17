import type { Db } from '../../db/pool.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../http/pagination.js';
import { PLATE_KEY } from '../claims/claims.routes.js';
import type { DamageLabel, INSPECTION_STATUSES, OverallSeverity, REVIEW_DECISIONS, Severity, VIEW_ANGLES } from './inspections.rules.js';

export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];
export type ViewAngle = (typeof VIEW_ANGLES)[number];
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export type InspectionListItem = {
  inspectionId: number;
  inspectionNo: string;
  status: InspectionStatus;
  overallSeverity: OverallSeverity;
  registrationNo: string;
  vehicle: string;
  jobNo: string | null;
  imageCount: number;
  detectionCount: number;
  pendingCount: number;
  createdBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export type DetectionView = {
  detectionId: number;
  label: DamageLabel;
  confidence: number | null;
  bbox: number[];
  polygon: number[][] | null;
  areaPx: number | null;
  areaRatioVehicle: number | null;
  location: string | null;
  severity: OverallSeverity;
  severityReason: string | null;
  source: 'model' | 'technician';
  reviewStatus: 'pending' | ReviewDecision;
  correctedLabel: DamageLabel | null;
  correctedSeverity: Severity | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type InspectionDetail = Omit<InspectionListItem, 'imageCount' | 'detectionCount' | 'pendingCount' | 'vehicle'> & {
  vehicle: { vehicleId: number; registrationNo: string; description: string };
  job: { jobId: number; jobNo: string } | null;
  severityMethod: string | null;
  severityValidated: boolean;
  model: { name: string; version: string } | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  images: {
    imageId: number;
    viewAngle: ViewAngle;
    width: number | null;
    height: number | null;
    quality: { passed?: boolean; blurVar?: number; brightness?: number; warnings?: string[] };
    processingMs: number | null;
    url: string;
    detections: DetectionView[];
  }[];
};

export type InspectionFilter = PageRequest & { status?: InspectionStatus; search?: string };

const USER_NAME = (alias: string) => `nullif(trim(${alias}.first_name || ' ' || ${alias}.last_name), '')`;

export async function listInspections(db: Db, f: InspectionFilter): Promise<Page<InspectionListItem>> {
  const where: string[] = ['true'];
  const params: unknown[] = [];
  if (f.status) {
    params.push(f.status);
    where.push(`i.status = $${params.length}`);
  }
  if (f.search) {
    // Plates are matched without spaces and dashes, so "cab4521" finds "WP CAB-4521"; or by inspection number.
    params.push(`%${f.search.replace(/[\s-]/g, '').toUpperCase()}%`, `%${f.search}%`);
    where.push(`(${PLATE_KEY('v.registration_no')} LIKE $${params.length - 1} OR i.inspection_no ILIKE $${params.length})`);
  }
  const from = `
    FROM damage.inspections i
    JOIN workshop.vehicles v ON v.vehicle_id = i.vehicle_id
    LEFT JOIN workshop.jobs j ON j.job_id = i.job_id
    LEFT JOIN app.users cu ON cu.user_id = i.created_by
    WHERE ${where.join(' AND ')}`;

  const total = await db.query(`SELECT count(*) AS n ${from}`, params);
  // The review queue is worked oldest first; every other list shows the newest first.
  const order = f.status === 'awaiting_review' ? 'ASC' : 'DESC';
  const rows = await db.query(
    `SELECT i.inspection_id, i.inspection_no, i.status, i.overall_severity, i.created_at, i.reviewed_at,
            v.registration_no, v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle, j.job_no,
            ${USER_NAME('cu')} AS created_by,
            (SELECT count(*) FROM damage.inspection_images im WHERE im.inspection_id = i.inspection_id) AS image_count,
            (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
              WHERE im.inspection_id = i.inspection_id) AS detection_count,
            (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
              WHERE im.inspection_id = i.inspection_id AND d.review_status = 'pending') AS pending_count
     ${from}
     ORDER BY i.created_at ${order}, i.inspection_id ${order}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, offsetOf(f)],
  );
  return toPage(
    rows.rows.map((r) => ({
      inspectionId: r.inspection_id,
      inspectionNo: r.inspection_no,
      status: r.status,
      overallSeverity: r.overall_severity,
      registrationNo: r.registration_no,
      vehicle: r.vehicle,
      jobNo: r.job_no,
      imageCount: r.image_count,
      detectionCount: r.detection_count,
      pendingCount: r.pending_count,
      createdBy: r.created_by,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
    })),
    total.rows[0].n,
    f,
  );
}

export async function getInspection(db: Db, id: number): Promise<InspectionDetail | null> {
  const head = await db.query(
    `SELECT i.*, v.registration_no, v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle, j.job_no,
            ${USER_NAME('cu')} AS created_by_name, ${USER_NAME('ru')} AS reviewed_by_name, mv.name AS model_name, mv.version AS model_version
     FROM damage.inspections i
     JOIN workshop.vehicles v ON v.vehicle_id = i.vehicle_id
     LEFT JOIN workshop.jobs j ON j.job_id = i.job_id
     LEFT JOIN app.users cu ON cu.user_id = i.created_by
     LEFT JOIN app.users ru ON ru.user_id = i.reviewed_by
     LEFT JOIN app.model_versions mv ON mv.model_version_id = i.model_version_id
     WHERE i.inspection_id = $1`,
    [id],
  );
  const h = head.rows[0];
  if (!h) return null;

  const images = await db.query(
    `SELECT image_id, view_angle, width, height, quality, processing_ms FROM damage.inspection_images
     WHERE inspection_id = $1 ORDER BY image_id`,
    [id],
  );
  const detections = await db.query(
    `SELECT d.*, ${USER_NAME('ru')} AS reviewed_by_name
     FROM damage.detections d
     JOIN damage.inspection_images im USING (image_id)
     LEFT JOIN app.users ru ON ru.user_id = d.reviewed_by
     WHERE im.inspection_id = $1 ORDER BY d.detection_id`,
    [id],
  );

  return {
    inspectionId: h.inspection_id,
    inspectionNo: h.inspection_no,
    status: h.status,
    overallSeverity: h.overall_severity,
    severityMethod: h.severity_method,
    severityValidated: h.severity_validated,
    registrationNo: h.registration_no,
    vehicle: { vehicleId: h.vehicle_id, registrationNo: h.registration_no, description: h.vehicle },
    job: h.job_id ? { jobId: h.job_id, jobNo: h.job_no } : null,
    jobNo: h.job_no,
    model: h.model_name ? { name: h.model_name, version: h.model_version } : null,
    createdBy: h.created_by_name,
    createdAt: h.created_at,
    reviewedBy: h.reviewed_by_name,
    reviewedAt: h.reviewed_at,
    reviewNotes: h.review_notes,
    images: images.rows.map((im) => ({
      imageId: im.image_id,
      viewAngle: im.view_angle,
      width: im.width,
      height: im.height,
      quality: im.quality,
      processingMs: im.processing_ms,
      url: `/api/inspections/${id}/images/${im.image_id}`,
      detections: detections.rows
        .filter((d) => d.image_id === im.image_id)
        .map((d) => ({
          detectionId: d.detection_id,
          label: d.label,
          confidence: d.confidence,
          bbox: d.bbox,
          polygon: d.polygon,
          areaPx: d.area_px,
          areaRatioVehicle: d.area_ratio_vehicle,
          location: d.location,
          severity: d.severity,
          severityReason: d.severity_reason,
          source: d.source,
          reviewStatus: d.review_status,
          correctedLabel: d.corrected_label,
          correctedSeverity: d.corrected_severity,
          reviewedBy: d.reviewed_by_name,
          reviewedAt: d.reviewed_at,
        })),
    })),
  };
}

/** The vehicle an inspection is for: from the job when one is given (and it must match vehicleId if both are). */
export async function findJobOrVehicle(db: Db, input: { jobId?: number; vehicleId?: number }) {
  if (input.jobId) {
    const { rows } = await db.query<{ job_id: number; vehicle_id: number; stage: string }>(
      'SELECT job_id, vehicle_id, stage FROM workshop.jobs WHERE job_id = $1',
      [input.jobId],
    );
    return rows[0] ? { jobId: rows[0].job_id, vehicleId: rows[0].vehicle_id, jobStage: rows[0].stage } : null;
  }
  const { rows } = await db.query<{ vehicle_id: number }>('SELECT vehicle_id FROM workshop.vehicles WHERE vehicle_id = $1', [input.vehicleId]);
  return rows[0] ? { jobId: null, vehicleId: rows[0].vehicle_id, jobStage: null } : null;
}

/** The model version that produced a result, registered the first time it is seen (app.model_versions). */
export async function modelVersionId(db: Db, version: string): Promise<number> {
  const { rows } = await db.query<{ model_version_id: number }>(
    `INSERT INTO app.model_versions (component, name, version, notes)
     VALUES ('damage', 'yolo11-seg-cardd', $1, 'Registered by the first inspection that used it')
     ON CONFLICT (component, name, version) DO UPDATE SET version = EXCLUDED.version
     RETURNING model_version_id`,
    [version],
  );
  return rows[0]!.model_version_id;
}

export async function nextInspectionId(db: Db): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `SELECT nextval(pg_get_serial_sequence('damage.inspections', 'inspection_id'))::int AS id`,
  );
  return rows[0]!.id;
}

export async function insertInspection(
  db: Db,
  i: { inspectionId: number; inspectionNo: string; jobId: number | null; vehicleId: number; overallSeverity: OverallSeverity; severityMethod: string; modelVersionId: number; userId: number },
) {
  await db.query(
    `INSERT INTO damage.inspections (inspection_id, inspection_no, job_id, vehicle_id, status, overall_severity, severity_method,
                                     severity_validated, model_version_id, created_by)
     VALUES ($1, $2, $3, $4, 'awaiting_review', $5, $6, false, $7, $8)`,
    [i.inspectionId, i.inspectionNo, i.jobId, i.vehicleId, i.overallSeverity, i.severityMethod, i.modelVersionId, i.userId],
  );
}

export async function insertImage(
  db: Db,
  im: { inspectionId: number; viewAngle: ViewAngle; storageKey: string; width: number; height: number; quality: object; processingMs: number },
): Promise<number> {
  const { rows } = await db.query<{ image_id: number }>(
    `INSERT INTO damage.inspection_images (inspection_id, view_angle, storage_key, width, height, quality, processing_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING image_id`,
    [im.inspectionId, im.viewAngle, im.storageKey, im.width, im.height, JSON.stringify(im.quality), Math.round(im.processingMs)],
  );
  return rows[0]!.image_id;
}

export async function insertDetection(
  db: Db,
  d: { imageId: number; label: DamageLabel; confidence: number; bbox: number[]; polygon: number[][]; areaPx: number;
       areaRatioVehicle: number | null; location: string | null; severity: string | null; severityReason: string | null },
) {
  await db.query(
    `INSERT INTO damage.detections (image_id, label, confidence, bbox, polygon, area_px, area_ratio_vehicle, location, severity, severity_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [d.imageId, d.label, d.confidence, JSON.stringify(d.bbox), JSON.stringify(d.polygon), Math.round(d.areaPx),
     d.areaRatioVehicle, d.location?.slice(0, 40) ?? null, d.severity, d.severityReason?.slice(0, 200) ?? null],
  );
}

/** The inspection, locked for the rest of the transaction (so two people cannot confirm or review it at once). */
export async function lockInspection(db: Db, id: number) {
  const { rows } = await db.query<{ inspection_id: number; inspection_no: string; status: InspectionStatus; vehicle_id: number; job_id: number | null }>(
    'SELECT inspection_id, inspection_no, status, vehicle_id, job_id FROM damage.inspections WHERE inspection_id = $1 FOR UPDATE',
    [id],
  );
  return rows[0] ?? null;
}

export async function detectionsForReview(db: Db, inspectionId: number) {
  const { rows } = await db.query<{ detection_id: number; label: DamageLabel; severity: string | null; review_status: string; corrected_label: DamageLabel | null; corrected_severity: string | null }>(
    `SELECT d.detection_id, d.label, d.severity, d.review_status, d.corrected_label, d.corrected_severity
     FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
     WHERE im.inspection_id = $1 ORDER BY d.detection_id`,
    [inspectionId],
  );
  return rows;
}

export async function setDetectionReview(
  db: Db,
  r: { detectionId: number; decision: ReviewDecision; label: DamageLabel | null; severity: Severity | null; userId: number },
) {
  await db.query(
    `UPDATE damage.detections
     SET review_status = $2, corrected_label = $3, corrected_severity = $4, reviewed_by = $5, reviewed_at = now()
     WHERE detection_id = $1`,
    [r.detectionId, r.decision, r.label, r.severity, r.userId],
  );
}

export async function markConfirmed(db: Db, c: { inspectionId: number; overallSeverity: OverallSeverity; notes: string | null; userId: number }) {
  await db.query(
    `UPDATE damage.inspections
     SET status = 'confirmed', overall_severity = $2, review_notes = $3, reviewed_by = $4, reviewed_at = now()
     WHERE inspection_id = $1`,
    [c.inspectionId, c.overallSeverity, c.notes, c.userId],
  );
}

export async function imageStorageKey(db: Db, inspectionId: number, imageId: number): Promise<string | null> {
  const { rows } = await db.query<{ storage_key: string }>(
    'SELECT storage_key FROM damage.inspection_images WHERE inspection_id = $1 AND image_id = $2',
    [inspectionId, imageId],
  );
  return rows[0]?.storage_key ?? null;
}
