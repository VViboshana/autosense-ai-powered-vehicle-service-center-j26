import type { Db } from '../../db/pool.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../http/pagination.js';

export type BayState = 'free' | 'occupied' | 'uncertain';
export type Point = [number, number];

export type Camera = {
  cameraId: number;
  code: string;
  name: string;
  location: string | null;
  sourceUrl: string | null;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
  isActive: boolean;
  bayCount: number;
};

export type Bay = {
  bayId: number;
  code: string;
  name: string;
  cameraId: number | null;
  cameraCode: string | null;
  polygon: Point[] | null;
  displayOrder: number;
  isActive: boolean;
  state: BayState | null;
  since: string | null;
  overlap: number | null;
};

export type VideoJob = {
  videoJobId: number;
  cameraId: number | null;
  cameraName: string | null;
  sourcePath: string;
  sampleFps: number;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  framesProcessed: number;
  totalFrames: number | null;
  error: string | null;
  modelVersion: string | null;
  /** The general (COCO-pretrained) vehicle model ran, not the one fine-tuned on bays. */
  modelGeneral: boolean;
  /** Whether the service masked outside the bays (null = not reported, e.g. jobs from before migration 0010). */
  roiMask: boolean | null;
  /** Replaying the video as a live camera until stopped (no end, no total frames). */
  live: boolean;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  transitions: number;
};

export type BayEvent = {
  eventId: number;
  fromState: BayState | null;
  toState: BayState;
  at: string;
  trackId: number | null;
  overlap: number | null;
  evidence: string | null;
  videoJobId: number | null;
};

// ---------------------------------------------------------------- cameras

const CAMERA_SELECT = `
  SELECT c.camera_id AS "cameraId", c.code, c.name, c.location, c.source_url AS "sourceUrl", c.status,
         c.last_seen_at AS "lastSeenAt", c.is_active AS "isActive",
         (SELECT count(*) FROM occupancy.bays b WHERE b.camera_id = c.camera_id AND b.is_active)::int AS "bayCount"
  FROM occupancy.cameras c`;

export async function listCameras(db: Db): Promise<Camera[]> {
  return (await db.query<Camera>(`${CAMERA_SELECT} ORDER BY c.is_active DESC, c.code`)).rows;
}

export async function getCamera(db: Db, cameraId: number): Promise<Camera | null> {
  return (await db.query<Camera>(`${CAMERA_SELECT} WHERE c.camera_id = $1`, [cameraId])).rows[0] ?? null;
}

export type CameraInput = { code: string; name: string; location: string | null; sourceUrl: string | null; isActive: boolean };

export async function insertCamera(db: Db, c: CameraInput): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO occupancy.cameras (code, name, location, source_url, is_active) VALUES ($1, $2, $3, $4, $5)
     RETURNING camera_id AS id`,
    [c.code, c.name, c.location, c.sourceUrl, c.isActive],
  );
  return rows[0]!.id;
}

export async function updateCamera(db: Db, cameraId: number, c: Partial<CameraInput>): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE occupancy.cameras SET
       code = COALESCE($2, code), name = COALESCE($3, name),
       location = CASE WHEN $4::boolean THEN $5 ELSE location END,
       source_url = CASE WHEN $6::boolean THEN $7 ELSE source_url END,
       is_active = COALESCE($8, is_active)
     WHERE camera_id = $1`,
    [cameraId, c.code ?? null, c.name ?? null, 'location' in c, c.location ?? null, 'sourceUrl' in c, c.sourceUrl ?? null, c.isActive ?? null],
  );
  return (rowCount ?? 0) > 0;
}

/** True when another camera/bay (not `exceptId`) already uses this code. Codes are case-insensitive for people. */
export async function codeTaken(db: Db, table: 'cameras' | 'bays', code: string, exceptId?: number): Promise<boolean> {
  const idColumn = table === 'cameras' ? 'camera_id' : 'bay_id';
  const { rows } = await db.query(
    `SELECT 1 FROM occupancy.${table} WHERE lower(code) = lower($1) AND ($2::int IS NULL OR ${idColumn} <> $2)`,
    [code, exceptId ?? null],
  );
  return rows.length > 0;
}

export async function markCameraSeen(db: Db, cameraId: number, online: boolean): Promise<void> {
  await db.query(
    `UPDATE occupancy.cameras SET status = $2, last_seen_at = CASE WHEN $3::boolean THEN now() ELSE last_seen_at END WHERE camera_id = $1`,
    [cameraId, online ? 'online' : 'offline', online],
  );
}

// ---------------------------------------------------------------- bays

const BAY_SELECT = `
  SELECT b.bay_id AS "bayId", b.code, b.name, b.camera_id AS "cameraId", c.code AS "cameraCode", b.polygon,
         b.display_order AS "displayOrder", b.is_active AS "isActive", s.state, s.since, s.overlap
  FROM occupancy.bays b
  LEFT JOIN occupancy.cameras c ON c.camera_id = b.camera_id
  LEFT JOIN occupancy.bay_status s ON s.bay_id = b.bay_id`;

export async function listBays(db: Db, cameraId?: number): Promise<Bay[]> {
  const where = cameraId ? 'WHERE b.camera_id = $1' : '';
  return (await db.query<Bay>(`${BAY_SELECT} ${where} ORDER BY b.is_active DESC, b.display_order, b.code`, cameraId ? [cameraId] : [])).rows;
}

export async function getBay(db: Db, bayId: number): Promise<Bay | null> {
  return (await db.query<Bay>(`${BAY_SELECT} WHERE b.bay_id = $1`, [bayId])).rows[0] ?? null;
}

export type BayInput = { code: string; name: string; cameraId: number | null; polygon: Point[] | null; displayOrder: number; isActive: boolean };

export async function insertBay(db: Db, b: BayInput): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO occupancy.bays (code, name, camera_id, polygon, display_order, is_active) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING bay_id AS id`,
    [b.code, b.name, b.cameraId, b.polygon ? JSON.stringify(b.polygon) : null, b.displayOrder, b.isActive],
  );
  return rows[0]!.id;
}

export async function updateBay(db: Db, bayId: number, b: Partial<BayInput>): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE occupancy.bays SET
       code = COALESCE($2, code), name = COALESCE($3, name),
       camera_id = CASE WHEN $4::boolean THEN $5 ELSE camera_id END,
       polygon = CASE WHEN $6::boolean THEN $7::jsonb ELSE polygon END,
       display_order = COALESCE($8, display_order), is_active = COALESCE($9, is_active)
     WHERE bay_id = $1`,
    [
      bayId, b.code ?? null, b.name ?? null,
      'cameraId' in b, b.cameraId ?? null,
      'polygon' in b, b.polygon ? JSON.stringify(b.polygon) : null,
      b.displayOrder ?? null, b.isActive ?? null,
    ],
  );
  return (rowCount ?? 0) > 0;
}

/** Active bays of a camera that have an outline: what a video job watches. */
export async function baysToWatch(db: Db, cameraId: number): Promise<{ bayId: number; polygon: Point[] }[]> {
  const { rows } = await db.query<{ bayId: number; polygon: Point[] }>(
    `SELECT bay_id AS "bayId", polygon FROM occupancy.bays
     WHERE camera_id = $1 AND is_active AND polygon IS NOT NULL ORDER BY display_order, code`,
    [cameraId],
  );
  return rows;
}

export async function bayEvents(db: Db, bayId: number, page: PageRequest): Promise<Page<BayEvent>> {
  const { rows } = await db.query<BayEvent & { total: number }>(
    `SELECT event_id AS "eventId", from_state AS "fromState", to_state AS "toState", at, track_id AS "trackId",
            overlap, evidence, video_job_id AS "videoJobId", count(*) OVER ()::int AS total
     FROM occupancy.bay_state_events WHERE bay_id = $1
     ORDER BY at DESC, event_id DESC LIMIT $2 OFFSET $3`,
    [bayId, page.pageSize, offsetOf(page)],
  );
  return toPage(rows.map(({ total: _t, ...e }) => e), rows[0]?.total ?? 0, page);
}

// ---------------------------------------------------------------- video jobs

const JOB_SELECT = `
  SELECT j.video_job_id AS "videoJobId", j.camera_id AS "cameraId", c.name AS "cameraName", j.source_path AS "sourcePath",
         j.sample_fps AS "sampleFps", j.status, j.frames_processed AS "framesProcessed", j.total_frames AS "totalFrames",
         j.error, mv.version AS "modelVersion", COALESCE(mv.name = 'coco-pretrained', false) AS "modelGeneral", j.roi_mask AS "roiMask", j.live, u.first_name || ' ' || u.last_name AS "createdBy", j.created_at AS "createdAt",
         j.started_at AS "startedAt", j.finished_at AS "finishedAt",
         (SELECT count(*) FROM occupancy.bay_state_events e WHERE e.video_job_id = j.video_job_id)::int AS transitions
  FROM occupancy.video_jobs j
  LEFT JOIN occupancy.cameras c ON c.camera_id = j.camera_id
  LEFT JOIN app.model_versions mv ON mv.model_version_id = j.model_version_id
  LEFT JOIN app.users u ON u.user_id = j.created_by`;

export async function getVideoJob(db: Db, id: number): Promise<VideoJob | null> {
  return (await db.query<VideoJob>(`${JOB_SELECT} WHERE j.video_job_id = $1`, [id])).rows[0] ?? null;
}

export async function listVideoJobs(db: Db, page: PageRequest): Promise<Page<VideoJob>> {
  const [{ rows }, count] = await Promise.all([
    db.query<VideoJob>(`${JOB_SELECT} ORDER BY j.created_at DESC LIMIT $1 OFFSET $2`, [page.pageSize, offsetOf(page)]),
    db.query<{ n: number }>('SELECT count(*)::int AS n FROM occupancy.video_jobs'),
  ]);
  return toPage(rows, count.rows[0]!.n, page);
}

export async function insertVideoJob(
  db: Db,
  j: { cameraId: number; sourcePath: string; sampleFps: number; modelVersionId: number; userId: number; live: boolean },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO occupancy.video_jobs (camera_id, source_path, sample_fps, status, model_version_id, created_by, live)
     VALUES ($1, $2, $3, 'queued', $4, $5, $6) RETURNING video_job_id AS id`,
    [j.cameraId, j.sourcePath, j.sampleFps, j.modelVersionId, j.userId, j.live],
  );
  return rows[0]!.id;
}

export type LiveCamera = { videoJobId: number; cameraId: number; cameraCode: string; cameraName: string; startedAt: string; bayIds: number[] };

/** Cameras with a live job queued or running, and the bays it watches (active bays with an outline). */
export async function liveCameras(db: Db): Promise<LiveCamera[]> {
  const { rows } = await db.query<LiveCamera>(
    `SELECT j.video_job_id AS "videoJobId", c.camera_id AS "cameraId", c.code AS "cameraCode", c.name AS "cameraName",
            j.created_at AS "startedAt",
            coalesce(array_agg(b.bay_id ORDER BY b.display_order, b.code) FILTER (WHERE b.bay_id IS NOT NULL), '{}') AS "bayIds"
     FROM occupancy.video_jobs j
     JOIN occupancy.cameras c ON c.camera_id = j.camera_id
     LEFT JOIN occupancy.bays b ON b.camera_id = c.camera_id AND b.is_active AND b.polygon IS NOT NULL
     WHERE j.live AND j.status IN ('queued', 'running')
     GROUP BY j.video_job_id, c.camera_id
     ORDER BY j.video_job_id`,
  );
  return rows;
}

/** What the service reported when it accepted the job: whether it masks outside the bays. */
export async function setVideoJobMask(db: Db, id: number, roiMask: boolean | null): Promise<void> {
  await db.query('UPDATE occupancy.video_jobs SET roi_mask = $2 WHERE video_job_id = $1', [id, roiMask]);
}

/**
 * Jobs the sync loop still has to follow. `startedAt` is the time base for transition times (seconds into the video):
 * always created_at, the moment the video was handed to the service, so it never shifts between sync passes.
 */
export async function openVideoJobs(db: Db): Promise<{ videoJobId: number; cameraId: number | null; startedAt: string; stored: number }[]> {
  const { rows } = await db.query(
    `SELECT j.video_job_id AS "videoJobId", j.camera_id AS "cameraId", j.created_at AS "startedAt",
            (SELECT count(*) FROM occupancy.bay_state_events e WHERE e.video_job_id = j.video_job_id)::int AS stored
     FROM occupancy.video_jobs j WHERE j.status IN ('queued', 'running') ORDER BY j.video_job_id`,
  );
  return rows;
}

export async function updateVideoJob(
  db: Db,
  id: number,
  p: { status: VideoJob['status']; framesProcessed: number; totalFrames: number | null; error: string | null },
): Promise<void> {
  await db.query(
    // $2 is used three times: give it one explicit type, or PostgreSQL deduces conflicting ones and refuses the query
    `UPDATE occupancy.video_jobs SET
       status = $2::varchar, frames_processed = $3, total_frames = $4, error = $5,
       started_at = COALESCE(started_at, CASE WHEN $2::varchar <> 'queued' THEN now() END),
       finished_at = CASE WHEN $2::varchar IN ('completed', 'failed', 'cancelled') THEN COALESCE(finished_at, now()) END
     WHERE video_job_id = $1`,
    [id, p.status, p.framesProcessed, p.totalFrames, p.error],
  );
}

/** One confirmed change of a bay: history row, current state, and the shared bay.state event. */
export async function applyTransition(
  db: Db,
  t: { bayId: number; fromState: BayState; toState: BayState; at: Date; trackId: number | null; overlap: number | null; evidence: string; videoJobId: number },
): Promise<void> {
  await db.query(
    `INSERT INTO occupancy.bay_state_events (bay_id, from_state, to_state, at, track_id, overlap, evidence, video_job_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [t.bayId, t.fromState, t.toState, t.at, t.trackId, t.overlap, t.evidence, t.videoJobId],
  );
  await db.query(
    `INSERT INTO occupancy.bay_status (bay_id, state, since, track_id, overlap, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (bay_id) DO UPDATE SET state = EXCLUDED.state, since = EXCLUDED.since, track_id = EXCLUDED.track_id,
       overlap = EXCLUDED.overlap, updated_at = now(),
       -- the vehicle left: its plate no longer applies
       plate_text   = CASE WHEN EXCLUDED.state = 'free' THEN NULL  ELSE occupancy.bay_status.plate_text END,
       plate_core   = CASE WHEN EXCLUDED.state = 'free' THEN NULL  ELSE occupancy.bay_status.plate_core END,
       plate_votes  = CASE WHEN EXCLUDED.state = 'free' THEN NULL  ELSE occupancy.bay_status.plate_votes END,
       plate_reads  = CASE WHEN EXCLUDED.state = 'free' THEN NULL  ELSE occupancy.bay_status.plate_reads END,
       plate_stable = CASE WHEN EXCLUDED.state = 'free' THEN false ELSE occupancy.bay_status.plate_stable END,
       plate_done   = CASE WHEN EXCLUDED.state = 'free' THEN false ELSE occupancy.bay_status.plate_done END`,
    [t.bayId, t.toState, t.at, t.trackId, t.overlap],
  );
  await db.query(
    `INSERT INTO app.events (event_type, source, payload, occurred_at) VALUES ('bay.state', 'occupancy-service', $1, $2)`,
    [JSON.stringify({ bayId: t.bayId, from: t.fromState, to: t.toState, trackId: t.trackId, overlap: t.overlap,
                      evidence: t.evidence, videoJobId: t.videoJobId }), t.at],
  );
}

/**
 * The plate the service read on the vehicle in a bay: stored on the bay's current status and on the "occupied" event of
 * this video job it belongs to (evidence). Only writes when something changed; true when the stored plate changed.
 */
export async function recordPlate(
  db: Db,
  bayId: number,
  videoJobId: number,
  p: { text: string | null; core: string | null; votes: number; reads: number; stable: boolean; done: boolean },
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE occupancy.bay_status SET plate_text = $2, plate_core = $3, plate_votes = $4, plate_reads = $5,
            plate_stable = $6, plate_done = $7
     WHERE bay_id = $1 AND state <> 'free'
       AND (plate_core IS DISTINCT FROM $3 OR plate_votes IS DISTINCT FROM $4 OR plate_reads IS DISTINCT FROM $5
            OR plate_stable <> $6 OR plate_done <> $7)`,
    [bayId, p.text, p.core, p.votes, p.reads, p.stable, p.done],
  );
  if (!rowCount) return false;
  await db.query(
    `UPDATE occupancy.bay_state_events SET plate_text = $3, plate_votes = $4, plate_reads = $5
     WHERE event_id = (SELECT max(event_id) FROM occupancy.bay_state_events
                       WHERE bay_id = $1 AND video_job_id = $2 AND to_state = 'occupied')`,
    [bayId, videoJobId, p.text, p.votes, p.reads],
  );
  return true;
}

// ---------------------------------------------------------------- what a read plate tells about the vehicle

export type PlateVehicle = { vehicleId: number; registrationNo: string; vehicle: string; customer: string | null };
export type PlateBooking = { bookingId: number; bookingNo: string; status: 'pending' | 'confirmed'; slotTime: string; serviceTypeId: number; service: string };

/** Vehicles whose registration contains the plate core (the caller keeps those whose core is exactly equal). */
export async function vehiclesLikePlate(db: Db, core: string): Promise<PlateVehicle[]> {
  const { rows } = await db.query<PlateVehicle>(
    `SELECT v.vehicle_id AS "vehicleId", v.registration_no AS "registrationNo",
            v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle, c.full_name AS customer
     FROM workshop.vehicles v LEFT JOIN workshop.customers c ON c.customer_id = v.customer_id
     WHERE upper(regexp_replace(v.registration_no, '[^A-Za-z0-9]', '', 'g')) LIKE '%' || $1
     LIMIT 10`,
    [core],
  );
  return rows;
}

/** The vehicle's booking for `today` that is not checked in yet (pending or confirmed), if any. */
export async function openBookingToday(db: Db, vehicleId: number, today: string): Promise<PlateBooking | null> {
  const { rows } = await db.query<PlateBooking>(
    `SELECT b.booking_id AS "bookingId", b.booking_no AS "bookingNo", b.status, to_char(b.slot_time, 'HH24:MI') AS "slotTime",
            b.service_type_id AS "serviceTypeId", st.name AS service
     FROM workshop.bookings b JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     WHERE b.vehicle_id = $1 AND b.booking_date = $2::date AND b.status IN ('pending', 'confirmed')
     ORDER BY b.slot_time LIMIT 1`,
    [vehicleId, today],
  );
  return rows[0] ?? null;
}

/** The vehicle's open job, if it already has one. */
export async function openJobOfVehicle(db: Db, vehicleId: number): Promise<{ jobId: number; jobNo: string; stage: string } | null> {
  const { rows } = await db.query<{ jobId: number; jobNo: string; stage: string }>(
    `SELECT job_id AS "jobId", job_no AS "jobNo", stage FROM workshop.jobs
     WHERE vehicle_id = $1 AND stage NOT IN ('completed', 'cancelled') LIMIT 1`,
    [vehicleId],
  );
  return rows[0] ?? null;
}

export type NextStep = {
  jobId: number; jobNo: string; stage: 'in_bay' | 'inspecting' | 'inspected'; registrationNo: string; vehicle: string;
  bayId: number; bayName: string; plateLinked: boolean;
};

/** Vehicles in a bay and their next step: in the bay (send to damage inspection), waiting for inspection (start it), inspected (work done). */
export async function nextStepJobs(db: Db): Promise<NextStep[]> {
  const { rows } = await db.query<NextStep>(
    `SELECT j.job_id AS "jobId", j.job_no AS "jobNo", j.stage, v.registration_no AS "registrationNo",
            v.make || ' ' || v.model AS vehicle, b.bay_id AS "bayId", b.name AS "bayName",
            EXISTS (SELECT 1 FROM workshop.job_stage_history h WHERE h.job_id = j.job_id AND h.stage = 'in_bay'
                    AND h.note LIKE 'Linked by number plate%') AS "plateLinked"
     FROM workshop.jobs j
     JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     JOIN occupancy.bays b ON b.bay_id = j.bay_id AND b.is_active
     WHERE j.stage IN ('in_bay', 'inspecting', 'inspected')
     ORDER BY j.updated_at`,
  );
  return rows;
}

export async function saveRules(db: Db, rules: Record<string, number | boolean>, userId: number): Promise<void> {
  await db.query(
    `UPDATE app.settings SET value = $1, updated_at = now(), updated_by = $2 WHERE setting_key = 'occupancy.rules'`,
    [JSON.stringify(rules), userId],
  );
}

export async function modelVersionId(db: Db, version: string, placeholder: boolean): Promise<number> {
  const { rows } = await db.query<{ model_version_id: number }>(
    `INSERT INTO app.model_versions (component, name, version, notes)
     VALUES ('occupancy', $1, $2, $3)
     ON CONFLICT (component, name, version) DO UPDATE SET version = EXCLUDED.version
     RETURNING model_version_id`,
    [placeholder ? 'coco-pretrained' : 'yolo-vehicle-pklot', version,
     placeholder ? 'General vehicle model: COCO weights, not fine-tuned on bays' : 'Registered by the first video job that used it'],
  );
  return rows[0]!.model_version_id;
}

// ---------------------------------------------------------------- bay -> job suggestions (staff confirm)

/** Stages a job can move into a bay from, in queue order (waiting for a bay first). Inspection happens in the bay. */
export const BAY_READY_STAGES = ['waiting_for_bay', 'checked_in'] as const;
/** Stages in which a job's vehicle is in its bay (jobs.repository IN_BAY_STAGES). */
const IN_BAY = `('in_bay', 'inspecting', 'inspected')`;

export type UnlinkedBay = {
  bayId: number; code: string; name: string; since: string | null; overlap: number | null;
  /** The parked vehicle's plate as read by the camera (migration 0013); stable = the readings agree. */
  plateText: string | null; plateCore: string | null; plateVotes: number | null; plateReads: number | null;
  plateStable: boolean; plateDone: boolean;
};
export type QueuedJob = {
  jobId: number;
  jobNo: string;
  registrationNo: string;
  vehicle: string;
  service: string;
  stage: (typeof BAY_READY_STAGES)[number];
  checkedInAt: string;
};

/** A camera whose code starts with this shows test footage (e.g. TEST-PKL04, a PKLot time-lapse): never real vehicles. */
export const TEST_CAMERA_PREFIX = 'TEST-';
/** Test cameras whose bays may still hold jobs: the simulated service bays used for demos (Hashini's decision, 20/10/2026). */
export const TEST_CAMERAS_WITH_JOBS = ['TEST-SIM'];

/** Whether jobs may be linked to bays on this camera (any real camera, and the test cameras listed above). */
export const cameraTakesJobs = (code: string | null | undefined) =>
  !code || !code.startsWith(TEST_CAMERA_PREFIX) || TEST_CAMERAS_WITH_JOBS.includes(code);

/**
 * Active bays the camera reports as occupied that have no job in them, longest occupied first. Bays on a test camera
 * are left out: the vehicles in test footage are not in the service centre.
 */
export async function occupiedBaysWithoutJob(db: Db): Promise<UnlinkedBay[]> {
  const { rows } = await db.query<UnlinkedBay>(
    `SELECT b.bay_id AS "bayId", b.code, b.name, s.since, s.overlap,
            s.plate_text AS "plateText", s.plate_core AS "plateCore", s.plate_votes AS "plateVotes",
            s.plate_reads AS "plateReads", s.plate_stable AS "plateStable", s.plate_done AS "plateDone"
     FROM occupancy.bays b JOIN occupancy.bay_status s ON s.bay_id = b.bay_id
     LEFT JOIN occupancy.cameras c ON c.camera_id = b.camera_id
     WHERE b.is_active AND s.state = 'occupied'
       AND (c.code IS NULL OR c.code NOT LIKE $1 || '%' OR c.code = ANY($2::varchar[]))
       AND NOT EXISTS (SELECT 1 FROM workshop.jobs j WHERE j.bay_id = b.bay_id AND j.stage IN ${IN_BAY})
     ORDER BY s.since NULLS LAST, b.display_order, b.code`,
    [TEST_CAMERA_PREFIX, TEST_CAMERAS_WITH_JOBS],
  );
  return rows;
}

export type BayWithJob = UnlinkedBay & { jobId: number; jobNo: string; registrationNo: string; vehicle: string; bayEnteredAt: string | null };

/**
 * Bays the camera reports as free that still have a job in them: the vehicle has probably left (service finished).
 * Only bays that turned free after the vehicle went in, so a bay that was free before the job was linked is not offered.
 */
export async function freeBaysWithJob(db: Db): Promise<BayWithJob[]> {
  const { rows } = await db.query<BayWithJob>(
    `SELECT b.bay_id AS "bayId", b.code, b.name, s.since, s.overlap, j.job_id AS "jobId", j.job_no AS "jobNo",
            v.registration_no AS "registrationNo", v.make || ' ' || v.model AS vehicle, j.bay_entered_at AS "bayEnteredAt"
     FROM occupancy.bays b
     JOIN occupancy.bay_status s ON s.bay_id = b.bay_id
     JOIN workshop.jobs j ON j.bay_id = b.bay_id AND j.stage IN ${IN_BAY}
     JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     WHERE b.is_active AND s.state = 'free' AND (j.bay_entered_at IS NULL OR s.since > j.bay_entered_at)
     ORDER BY s.since, b.display_order, b.code`,
  );
  return rows;
}

/** The job's vehicle left the bay: stage ready (service done), with its stage history. False when it is not in that bay. */
export async function markJobReady(db: Db, m: { jobId: number; bayId: number; userId: number; note: string }): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE workshop.jobs SET stage = 'ready', ready_at = now(), updated_at = now()
     WHERE job_id = $1 AND bay_id = $2 AND stage IN ${IN_BAY}`,
    [m.jobId, m.bayId],
  );
  if (!rowCount) return false;
  await db.query(`INSERT INTO workshop.job_stage_history (job_id, stage, user_id, note) VALUES ($1, 'ready', $2, $3)`, [m.jobId, m.userId, m.note]);
  return true;
}

/** Open jobs not yet in a bay, in queue order: waiting for a bay first, then inspected, then checked in; oldest first. */
export async function jobsReadyForBay(db: Db, limit = 20): Promise<QueuedJob[]> {
  const { rows } = await db.query<QueuedJob>(
    `SELECT j.job_id AS "jobId", j.job_no AS "jobNo", v.registration_no AS "registrationNo",
            v.make || ' ' || v.model AS vehicle, st.name AS service, j.stage, j.checked_in_at AS "checkedInAt"
     FROM workshop.jobs j
     JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
     WHERE j.stage = ANY($1::varchar[])
     ORDER BY array_position($1::varchar[], j.stage::varchar), j.checked_in_at
     LIMIT $2`,
    [BAY_READY_STAGES, limit],
  );
  return rows;
}

/** Holds the bay row until the transaction ends (serialises confirmations for one bay). */
export async function lockBay(db: Db, bayId: number): Promise<void> {
  await db.query('SELECT 1 FROM occupancy.bays WHERE bay_id = $1 FOR UPDATE', [bayId]);
}

/** Whether a job is already in this bay (only one at a time). */
export async function bayHasJob(db: Db, bayId: number): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM workshop.jobs WHERE bay_id = $1 AND stage IN ${IN_BAY} LIMIT 1`, [bayId]);
  return rows.length > 0;
}

/**
 * Bays a waiting job can be moved into by hand (Vehicles & jobs): active, on a camera that takes jobs (real cameras and
 * the simulated demo camera, never test footage), and with no job in them. Whether a camera sees a vehicle is not asked.
 */
export async function freeBaysForJobs(db: Db): Promise<{ bayId: number; name: string }[]> {
  const { rows } = await db.query<{ bayId: number; name: string }>(
    `SELECT b.bay_id AS "bayId", b.name
     FROM occupancy.bays b LEFT JOIN occupancy.cameras c ON c.camera_id = b.camera_id
     WHERE b.is_active
       AND (c.code IS NULL OR c.code NOT LIKE $1 || '%' OR c.code = ANY($2::varchar[]))
       AND NOT EXISTS (SELECT 1 FROM workshop.jobs j WHERE j.bay_id = b.bay_id AND j.stage IN ${IN_BAY})
     ORDER BY b.display_order, b.code`,
    [TEST_CAMERA_PREFIX, TEST_CAMERAS_WITH_JOBS],
  );
  return rows;
}

/** Moves a waiting job into a bay, with its stage history. False when the job is not (or no longer) waiting. */
export async function moveJobIntoBay(db: Db, m: { jobId: number; bayId: number; userId: number | null; note: string }): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE workshop.jobs SET stage = 'in_bay', bay_id = $2, bay_entered_at = now(), updated_at = now()
     WHERE job_id = $1 AND stage = ANY($3::varchar[])`,
    [m.jobId, m.bayId, BAY_READY_STAGES],
  );
  if (!rowCount) return false;
  await db.query(`INSERT INTO workshop.job_stage_history (job_id, stage, user_id, note) VALUES ($1, 'in_bay', $2, $3)`, [m.jobId, m.userId, m.note]);
  return true;
}

// ---------------------------------------------------------------- the customer's view of the service bays

export type CentreBay = { bayId: number; name: string; state: 'occupied' | 'free' | 'updating' };
export type MyVisit = { registrationNo: string; stage: string; bayId: number | null; bayName: string | null; queuePosition: number | null };

/**
 * The service bays as customers see them: the bays that can hold jobs (real cameras and the simulated demo camera,
 * never test footage like PKLot), with their state only while their camera is running; otherwise, or while the
 * camera is still confirming, "updating". No pictures and nothing about other customers' vehicles.
 */
export async function serviceCentreBays(db: Db): Promise<{ live: boolean; bays: CentreBay[] }> {
  const { rows } = await db.query<{ bayId: number; name: string; state: string | null; live: boolean }>(
    `SELECT b.bay_id AS "bayId", b.name, s.state,
            EXISTS (SELECT 1 FROM occupancy.video_jobs j WHERE j.camera_id = c.camera_id AND j.status = 'running') AS live
     FROM occupancy.bays b
     JOIN occupancy.cameras c ON c.camera_id = b.camera_id AND c.is_active
     LEFT JOIN occupancy.bay_status s ON s.bay_id = b.bay_id
     WHERE b.is_active AND b.polygon IS NOT NULL
       AND (c.code NOT LIKE $1 || '%' OR c.code = ANY($2::varchar[]))
     ORDER BY b.display_order, b.code`,
    [TEST_CAMERA_PREFIX, TEST_CAMERAS_WITH_JOBS],
  );
  return {
    live: rows.some((r) => r.live),
    bays: rows.map((r) => ({
      bayId: r.bayId,
      name: r.name,
      state: r.live && (r.state === 'occupied' || r.state === 'free') ? r.state : 'updating',
    })),
  };
}

/** The signed-in customer's vehicles at the centre now (approved vehicles only): stage, their bay, place in the queue. */
export async function myVisits(db: Db, customerId: number): Promise<MyVisit[]> {
  const { rows } = await db.query<MyVisit>(
    `SELECT v.registration_no AS "registrationNo", j.stage,
            CASE WHEN j.stage IN ${IN_BAY} THEN j.bay_id END AS "bayId",
            CASE WHEN j.stage IN ${IN_BAY} THEN b.name END AS "bayName",
            CASE WHEN j.stage = 'waiting_for_bay' THEN
              (SELECT count(*) + 1 FROM workshop.jobs w WHERE w.stage = 'waiting_for_bay' AND w.checked_in_at < j.checked_in_at)::int
            END AS "queuePosition"
     FROM workshop.jobs j
     JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     JOIN workshop.vehicle_claims vc ON vc.vehicle_id = v.vehicle_id AND vc.customer_id = $1 AND vc.status = 'approved'
     LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
     WHERE j.stage NOT IN ('completed', 'cancelled')
     ORDER BY j.checked_in_at`,
    [customerId],
  );
  return rows;
}
