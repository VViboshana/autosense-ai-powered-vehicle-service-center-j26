import type { Db } from '../../db/pool.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../http/pagination.js';
import { PLATE_KEY } from '../claims/claims.routes.js';
import { groupRegions } from './inspections.areas.js';
import { inspectionHandover, type Handover } from './inspections.handover.js';
import { mechanicalPlan, type MechanicalPlan } from './inspections.mechanical.js';
import { repairFor, repairPlan, type AreaRepair, type RepairPlan } from './inspections.repair.js';
import type { DamageLabel, INSPECTION_STATUSES, OverallSeverity, REVIEW_DECISIONS, Severity, VIEW_ANGLES } from './inspections.rules.js';
import { SOUND_FAULTS, type SoundLabel, type SoundSituation } from './inspections.sound.js';

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
  /** The inspection's first photo, for the list's thumbnail. */
  thumbnailUrl: string | null;
  detectionCount: number;
  pendingCount: number;
  /** Possible damage (suggestions) nobody has accepted or dismissed yet. */
  possibleCount: number;
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
  /** Possible damage: a weaker region the technician accepts (confirmed/corrected) or dismisses (rejected). */
  suggestion: boolean;
  reviewStatus: 'pending' | ReviewDecision;
  correctedLabel: DamageLabel | null;
  correctedSeverity: Severity | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Repair guide for this region from its final type and severity; null for rejected or undecided possible damage */
  repair: AreaRepair | null;
};

export type InspectionDetail = Omit<InspectionListItem, 'imageCount' | 'thumbnailUrl' | 'detectionCount' | 'pendingCount' | 'possibleCount' | 'vehicle'> & {
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
  /** Repair guide for the whole inspection, from its damaged areas (overlapping regions of one damage count once) */
  repair: RepairPlanView;
  /** Sound recordings made with the inspection (at most one per situation) and the fault the sound model named */
  sounds: SoundCheckView[];
  /** Mechanical repair guide from the sound findings (not rejected; undecided ones count with the model's answer) */
  mechanical: MechanicalPlanView;
  /** Hand-over to maintenance forecasting (inspection-handover-v1); final once the inspection is confirmed */
  handover: Handover;
};

export type MechanicalPlanView = Omit<MechanicalPlan, 'services'> & { services: (MechanicalPlan['services'][number] & { name: string })[] };

export type SoundCheckView = {
  soundCheckId: number;
  situation: SoundSituation;
  url: string;
  durationS: number | null;
  quality: { passed?: boolean; warnings?: string[] };
  label: SoundLabel;
  confidence: number;
  sure: boolean;
  /** False when the recording did not sound like the training recordings (then never "sure"); null before the check */
  familiar: boolean | null;
  probabilities: { label: SoundLabel; probability: number }[];
  reviewStatus: 'pending' | ReviewDecision;
  correctedLabel: SoundLabel | null;
  /** After review: the technician's correction, else the model's label; null when rejected */
  finalLabel: SoundLabel | null;
  name: string;
  advice: string;
  normal: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export type RepairPlanView = Omit<RepairPlan, 'services'> & { services: (RepairPlan['services'][number] & { name: string })[] };

/** A plan (damage or mechanical) with service names (workshop.service_types), for showing it. */
export async function withServiceNames<P extends { services: { code: string }[] }>(
  db: Db,
  plan: P,
): Promise<Omit<P, 'services'> & { services: (P['services'][number] & { name: string })[] }> {
  if (!plan.services.length) return { ...plan, services: [] };
  const { rows } = await db.query<{ code: string; name: string }>('SELECT code, name FROM workshop.service_types WHERE code = ANY($1)', [
    plan.services.map((s) => s.code),
  ]);
  return { ...plan, services: plan.services.map((s) => ({ ...s, name: rows.find((r) => r.code === s.code)?.name ?? s.code })) };
}

export type InspectionFilter = PageRequest & { status?: InspectionStatus; search?: string };

/** A region counts as damage when it is a finding, or a suggestion a technician accepted (alias d). */
const COUNTS_AS_FINDING = `(NOT d.is_suggestion OR d.review_status IN ('confirmed', 'corrected'))`;

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
            (SELECT im.image_id FROM damage.inspection_images im WHERE im.inspection_id = i.inspection_id ORDER BY im.image_id LIMIT 1) AS first_image_id,
            (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
              WHERE im.inspection_id = i.inspection_id AND ${COUNTS_AS_FINDING}) AS detection_count,
            (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
              WHERE im.inspection_id = i.inspection_id AND d.review_status = 'pending' AND NOT d.is_suggestion)
              + (SELECT count(*) FROM damage.sound_checks s WHERE s.inspection_id = i.inspection_id AND s.review_status = 'pending')
              AS pending_count,
            (SELECT count(*) FROM damage.detections d JOIN damage.inspection_images im USING (image_id)
              WHERE im.inspection_id = i.inspection_id AND d.review_status = 'pending' AND d.is_suggestion) AS possible_count
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
      thumbnailUrl: r.first_image_id ? `/api/inspections/${r.inspection_id}/images/${r.first_image_id}` : null,
      detectionCount: r.detection_count,
      pendingCount: r.pending_count,
      possibleCount: r.possible_count,
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

  // Counts as damage now: not rejected, and a finding or an accepted suggestion. Judged by the final type and severity.
  const counts = (d: { review_status: string; is_suggestion: boolean }) =>
    d.review_status !== 'rejected' && (!d.is_suggestion || d.review_status === 'confirmed' || d.review_status === 'corrected');
  const finalOf = (d: { label: string; corrected_label: string | null; severity: string | null; corrected_severity: string | null }) => ({
    label: d.corrected_label ?? d.label,
    severity: d.corrected_severity ?? d.severity,
  });
  const areas = images.rows.flatMap((im) =>
    groupRegions(
      detections.rows.filter((d) => d.image_id === im.image_id && counts(d)).map((d) => ({ ...finalOf(d), bbox: d.bbox, polygon: d.polygon, source: d.source })),
      im.view_angle,
      im.width ?? 1280,
      im.height ?? 960,
    ),
  );

  const repair = await withServiceNames(db, repairPlan(areas));
  const { sounds, mechanical } = await soundsAndPlan(db, id);
  const handover = inspectionHandover({
    inspectionId: h.inspection_id,
    inspectionNo: h.inspection_no,
    status: h.status,
    reviewedAt: h.reviewed_at,
    vehicle: { vehicleId: h.vehicle_id, registrationNo: h.registration_no },
    jobId: h.job_id,
    overallSeverity: h.overall_severity,
    areas,
    sounds: sounds.filter((s) => s.finalLabel !== null).map((s) => ({ situation: s.situation, label: s.finalLabel! })),
    serviceNames: Object.fromEntries([...repair.services, ...mechanical.services].map((s) => [s.code, s.name])),
    methods: { severity: h.severity_method, repair: repair.method, mechanical: mechanical.method },
  });

  return {
    repair,
    sounds,
    mechanical,
    handover,
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
          suggestion: d.is_suggestion,
          reviewStatus: d.review_status,
          correctedLabel: d.corrected_label,
          correctedSeverity: d.corrected_severity,
          reviewedBy: d.reviewed_by_name,
          reviewedAt: d.reviewed_at,
          repair: counts(d) ? repairFor(finalOf(d).label, finalOf(d).severity) : null,
        })),
    })),
  };
}

export type VehicleOption = {
  jobId: number;
  jobNo: string;
  vehicleId: number;
  registrationNo: string;
  vehicle: string;
  customer: string | null;
  stage: string;
  /** The bay the vehicle is in (in_bay, inspecting or inspected), or null. */
  bay: string | null;
  checkedInAt: string;
  inspectionCount: number;
};

/**
 * Open jobs to start an inspection for, optionally matched by plate or job number: first the vehicles the bay operator
 * sent for damage inspection, then other vehicles in a bay, then the rest (newest first).
 */
export async function vehicleOptions(db: Db, search?: string): Promise<VehicleOption[]> {
  const params: unknown[] = [];
  let filter = '';
  if (search) {
    params.push(`%${search.replace(/[\s-]/g, '').toUpperCase()}%`, `%${search}%`);
    filter = `AND (${PLATE_KEY('v.registration_no')} LIKE $1 OR j.job_no ILIKE $2)`;
  }
  const { rows } = await db.query(
    `SELECT j.job_id, j.job_no, v.vehicle_id, v.registration_no, v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle,
            c.full_name AS customer, j.stage, b.name AS bay, j.checked_in_at,
            (SELECT count(*) FROM damage.inspections i WHERE i.job_id = j.job_id) AS inspection_count
     FROM workshop.jobs j
     JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     LEFT JOIN workshop.customers c ON c.customer_id = j.customer_id
     LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id AND j.stage IN ('in_bay', 'inspecting', 'inspected')
     WHERE j.stage NOT IN ('completed', 'cancelled') ${filter}
     ORDER BY CASE j.stage WHEN 'inspecting' THEN 0 WHEN 'in_bay' THEN 1 WHEN 'inspected' THEN 2 ELSE 3 END,
              j.checked_in_at DESC, j.job_id DESC
     LIMIT 20`,
    params,
  );
  return rows.map((r) => ({
    jobId: r.job_id,
    jobNo: r.job_no,
    vehicleId: r.vehicle_id,
    registrationNo: r.registration_no,
    vehicle: r.vehicle,
    customer: r.customer,
    stage: r.stage,
    bay: r.bay,
    checkedInAt: r.checked_in_at,
    inspectionCount: r.inspection_count,
  }));
}

/** Confirmed inspections from a real model (alias i): the demo data's '…-sample' model results are not measurements. */
const MEASURED = `i.status = 'confirmed' AND NOT EXISTS (
  SELECT 1 FROM app.model_versions s WHERE s.model_version_id = i.model_version_id AND s.version LIKE '%-sample')`;

/** Every region of every confirmed inspection (final technician decisions), plus the sample's size, for the field figures. */
export async function reviewedRegions(db: Db) {
  const regions = await db.query(
    `SELECT d.label, d.corrected_label, d.severity, d.corrected_severity, d.review_status, d.source, d.is_suggestion, d.confidence
     FROM damage.detections d
     JOIN damage.inspection_images im USING (image_id)
     JOIN damage.inspections i ON i.inspection_id = im.inspection_id
     WHERE ${MEASURED}`,
  );
  const sample = await db.query(
    `SELECT count(DISTINCT i.inspection_id) AS inspections, count(im.image_id) AS photos,
            round(avg(im.processing_ms)) AS avg_processing_ms, min(i.reviewed_at) AS since,
            array_remove(array_agg(DISTINCT mv.version), NULL) AS model_versions
     FROM damage.inspections i
     LEFT JOIN damage.inspection_images im ON im.inspection_id = i.inspection_id
     LEFT JOIN app.model_versions mv ON mv.model_version_id = i.model_version_id
     WHERE ${MEASURED}`,
  );
  const s = sample.rows[0];
  return {
    regions: regions.rows.map((r) => ({
      label: r.label,
      correctedLabel: r.corrected_label,
      severity: r.severity,
      correctedSeverity: r.corrected_severity,
      reviewStatus: r.review_status,
      source: r.source,
      isSuggestion: r.is_suggestion,
      confidence: r.confidence,
    })),
    sample: {
      inspections: s.inspections as number,
      photos: s.photos as number,
      avgProcessingMs: s.avg_processing_ms as number | null,
      since: s.since as string | null,
      modelVersions: s.model_versions as string[],
    },
  };
}

export type TestSetMetrics = {
  version: string;
  split: string;
  images: number;
  regions: number;
  mask: { precision: number; recall: number; mAP50: number; mAP50_95: number };
  perClassMaskMAP50_95: Partial<Record<DamageLabel, number>>;
};

/**
 * The test-set results of the model behind the field figures (the version used most recently with metrics stored);
 * or, before any confirmed inspection, of the newest damage model with results. Null when none are stored.
 */
export async function testSetMetrics(db: Db, versions: string[]): Promise<TestSetMetrics | null> {
  const { rows } = await db.query<{ version: string; metrics: Omit<TestSetMetrics, 'version'> }>(
    `SELECT version, metrics FROM app.model_versions
     WHERE component = 'damage' AND metrics ? 'mask' AND (cardinality($1::text[]) = 0 OR version = ANY($1))
     ORDER BY registered_at DESC LIMIT 1`,
    [versions],
  );
  return rows[0] ? { version: rows[0].version, ...rows[0].metrics } : null;
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
export async function modelVersionId(db: Db, version: string, name = 'yolo11-seg-cardd'): Promise<number> {
  const { rows } = await db.query<{ model_version_id: number }>(
    `INSERT INTO app.model_versions (component, name, version, notes)
     VALUES ('damage', $2, $1, 'Registered by the first inspection that used it')
     ON CONFLICT (component, name, version) DO UPDATE SET version = EXCLUDED.version
     RETURNING model_version_id`,
    [version, name],
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
       areaRatioVehicle: number | null; location: string | null; severity: string | null; severityReason: string | null;
       isSuggestion: boolean },
) {
  await db.query(
    `INSERT INTO damage.detections (image_id, label, confidence, bbox, polygon, area_px, area_ratio_vehicle, location, severity,
                                    severity_reason, is_suggestion)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [d.imageId, d.label, d.confidence, JSON.stringify(d.bbox), JSON.stringify(d.polygon), Math.round(d.areaPx),
     d.areaRatioVehicle, d.location?.slice(0, 40) ?? null, d.severity, d.severityReason?.slice(0, 200) ?? null, d.isSuggestion],
  );
}

/** A photo of the inspection, with its size (to check that a drawn box lies on it). */
export async function inspectionImage(db: Db, inspectionId: number, imageId: number) {
  const { rows } = await db.query<{ image_id: number; width: number | null; height: number | null }>(
    'SELECT image_id, width, height FROM damage.inspection_images WHERE inspection_id = $1 AND image_id = $2',
    [inspectionId, imageId],
  );
  return rows[0] ?? null;
}

/** Damage the model missed, drawn by a technician: no confidence, confirmed by the person who drew it. */
export async function insertTechnicianRegion(
  db: Db,
  r: { imageId: number; label: DamageLabel; severity: Severity; bbox: number[]; userId: number },
): Promise<number> {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = r.bbox;
  const { rows } = await db.query<{ detection_id: number }>(
    `INSERT INTO damage.detections (image_id, label, confidence, bbox, polygon, area_px, severity, severity_reason, source,
                                    review_status, reviewed_by, reviewed_at)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, 'Added by the technician', 'technician', 'confirmed', $7, now())
     RETURNING detection_id`,
    [r.imageId, r.label, JSON.stringify(r.bbox), JSON.stringify([[x1, y1], [x2, y1], [x2, y2], [x1, y2]]),
     (x2 - x1) * (y2 - y1), r.severity, r.userId],
  );
  return rows[0]!.detection_id;
}

/** Removes a region a technician added (only those: the model's regions are kept and rejected instead). */
export async function deleteTechnicianRegion(db: Db, inspectionId: number, detectionId: number): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM damage.detections d USING damage.inspection_images im
     WHERE d.detection_id = $2 AND d.image_id = im.image_id AND im.inspection_id = $1 AND d.source = 'technician'`,
    [inspectionId, detectionId],
  );
  return (rowCount ?? 0) > 0;
}

/** Possible damage still undecided becomes dismissed by the person confirming. Returns how many. */
export async function dismissOpenSuggestions(db: Db, inspectionId: number, userId: number): Promise<number> {
  const { rowCount } = await db.query(
    `UPDATE damage.detections d SET review_status = 'rejected', reviewed_by = $2, reviewed_at = now()
     FROM damage.inspection_images im
     WHERE im.image_id = d.image_id AND im.inspection_id = $1 AND d.is_suggestion AND d.review_status = 'pending'`,
    [inspectionId, userId],
  );
  return rowCount ?? 0;
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
  const { rows } = await db.query<{ detection_id: number; label: DamageLabel; severity: string | null; review_status: string; corrected_label: DamageLabel | null; corrected_severity: string | null; is_suggestion: boolean }>(
    `SELECT d.detection_id, d.label, d.severity, d.review_status, d.corrected_label, d.corrected_severity, d.is_suggestion
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

async function soundsAndPlan(db: Db, inspectionId: number) {
  const sounds = await soundChecks(db, inspectionId);
  const found = sounds.filter((s) => s.finalLabel !== null).map((s) => ({ situation: s.situation, label: s.finalLabel! }));
  return { sounds, mechanical: await withServiceNames(db, mechanicalPlan(found)) };
}

/** The sound recordings of an inspection with their results, described for people. */
export async function soundChecks(db: Db, inspectionId: number): Promise<SoundCheckView[]> {
  const { rows } = await db.query(
    `SELECT s.*, ${USER_NAME('ru')} AS reviewed_by_name
     FROM damage.sound_checks s LEFT JOIN app.users ru ON ru.user_id = s.reviewed_by
     WHERE s.inspection_id = $1
     ORDER BY CASE s.situation WHEN 'starting' THEN 0 WHEN 'idling' THEN 1 ELSE 2 END`,
    [inspectionId],
  );
  return rows.map((s) => {
    const finalLabel: SoundLabel | null = s.review_status === 'rejected' ? null : (s.corrected_label ?? s.label);
    const fault = SOUND_FAULTS[(finalLabel ?? s.label) as SoundLabel];
    return {
      soundCheckId: s.sound_check_id,
      situation: s.situation,
      url: `/api/inspections/${inspectionId}/sounds/${s.sound_check_id}/audio`,
      durationS: s.duration_s === null ? null : Number(s.duration_s),
      quality: s.quality,
      label: s.label,
      confidence: Number(s.confidence),
      sure: s.sure,
      familiar: s.familiar,
      probabilities: s.probabilities,
      reviewStatus: s.review_status,
      correctedLabel: s.corrected_label,
      finalLabel,
      name: fault.name,
      advice: fault.advice,
      normal: fault.normal,
      reviewedBy: s.reviewed_by_name,
      reviewedAt: s.reviewed_at,
    };
  });
}

export async function insertSoundCheck(
  db: Db,
  s: { inspectionId: number; situation: SoundSituation; storageKey: string; durationS: number; quality: object; label: SoundLabel;
       confidence: number; sure: boolean; probabilities: { label: string; probability: number }[]; modelVersionId: number;
       processingMs: number; familiarity: { familiar: boolean } | null },
) {
  await db.query(
    `INSERT INTO damage.sound_checks (inspection_id, situation, storage_key, duration_s, quality, label, confidence, sure,
                                      probabilities, model_version_id, processing_ms, familiar, familiarity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [s.inspectionId, s.situation, s.storageKey, s.durationS, JSON.stringify(s.quality), s.label, s.confidence, s.sure,
     JSON.stringify(s.probabilities.map((p) => ({ label: p.label, probability: p.probability }))), s.modelVersionId,
     Math.round(s.processingMs), s.familiarity?.familiar ?? null, s.familiarity ? JSON.stringify(s.familiarity) : null],
  );
}

/** One sound result of the inspection, for a review decision. */
export async function soundCheckForReview(db: Db, inspectionId: number, soundCheckId: number) {
  const { rows } = await db.query<{ sound_check_id: number; situation: SoundSituation; label: SoundLabel; review_status: string }>(
    'SELECT sound_check_id, situation, label, review_status FROM damage.sound_checks WHERE inspection_id = $1 AND sound_check_id = $2',
    [inspectionId, soundCheckId],
  );
  return rows[0] ?? null;
}

export async function setSoundReview(db: Db, r: { soundCheckId: number; decision: ReviewDecision; label: SoundLabel | null; userId: number }) {
  await db.query(
    `UPDATE damage.sound_checks SET review_status = $2, corrected_label = $3, reviewed_by = $4, reviewed_at = now()
     WHERE sound_check_id = $1`,
    [r.soundCheckId, r.decision, r.label, r.userId],
  );
}

/** Sound results of the inspection that a technician still has to decide (they block confirming). */
export async function pendingSoundChecks(db: Db, inspectionId: number): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM damage.sound_checks WHERE inspection_id = $1 AND review_status = 'pending'`,
    [inspectionId],
  );
  return rows[0]!.n;
}

/** Final sound findings (not rejected), for the inspection.report event: the situation and the fault after review. */
export async function keptSoundFindings(db: Db, inspectionId: number) {
  const { rows } = await db.query<{ situation: SoundSituation; label: SoundLabel }>(
    `SELECT situation, COALESCE(corrected_label, label) AS label FROM damage.sound_checks
     WHERE inspection_id = $1 AND review_status <> 'rejected' ORDER BY sound_check_id`,
    [inspectionId],
  );
  return rows;
}

export async function soundStorageKey(db: Db, inspectionId: number, soundCheckId: number): Promise<string | null> {
  const { rows } = await db.query<{ storage_key: string }>(
    'SELECT storage_key FROM damage.sound_checks WHERE inspection_id = $1 AND sound_check_id = $2',
    [inspectionId, soundCheckId],
  );
  return rows[0]?.storage_key ?? null;
}
