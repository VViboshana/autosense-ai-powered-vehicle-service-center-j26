import type { Db } from '../../db/pool.js';
import { LOCAL_DAY } from '../../db/sql.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../http/pagination.js';

/** In order (migration 0012). The job keeps its bay from in_bay to inspected. */
export const JOB_STAGES = ['checked_in', 'waiting_for_bay', 'in_bay', 'inspecting', 'inspected', 'ready', 'completed', 'cancelled'] as const;
/** Stages in which the vehicle is in its bay. */
export const IN_BAY_STAGES = ['in_bay', 'inspecting', 'inspected'] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export type JobListItem = {
  jobId: number;
  jobNo: string;
  registrationNo: string;
  vehicle: string;
  customer: string | null;
  service: string;
  stage: JobStage;
  bay: string | null;
  checkedInAt: string;
  estimatedMinutes: number | null;
  estimateLkr: number | null;
  advisor: string | null;
};

export type JobFilter = PageRequest & { scope: 'today' | 'open'; search?: string; stage?: JobStage };

export async function listJobs(db: Db, f: JobFilter): Promise<Page<JobListItem>> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (f.scope === 'today') where.push(`j.checked_in_at >= day.start AND j.checked_in_at < day.start + interval '1 day'`);
  else where.push(`j.stage NOT IN ('completed', 'cancelled')`);
  if (f.stage) add('j.stage = ?', f.stage);
  if (f.search) {
    // Plates are matched without spaces and dashes, so "cab4521" finds "WP CAB-4521".
    params.push(`%${f.search.replace(/[\s-]/g, '').toUpperCase()}%`, `%${f.search}%`);
    where.push(
      `(upper(replace(replace(v.registration_no, ' ', ''), '-', '')) LIKE $${params.length - 1} OR c.full_name ILIKE $${params.length})`,
    );
  }

  const from = `
    FROM workshop.jobs j
    CROSS JOIN day
    JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
    JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
    LEFT JOIN workshop.customers c ON c.customer_id = j.customer_id
    LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
    LEFT JOIN app.users u ON u.user_id = j.advisor_user_id
    WHERE ${where.join(' AND ')}`;

  const total = await db.query(`${LOCAL_DAY} SELECT count(*) AS n ${from}`, params);
  const page = await db.query(
    `${LOCAL_DAY}
     SELECT j.job_id, j.job_no, v.registration_no,
            v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle,
            c.full_name AS customer, st.name AS service, j.stage, b.name AS bay, j.checked_in_at,
            j.estimated_minutes, j.estimate_lkr,
            u.first_name || ' ' || left(u.last_name, 1) || '.' AS advisor
     ${from}
     ORDER BY j.checked_in_at, j.job_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, offsetOf(f)],
  );

  return toPage(
    page.rows.map((r) => ({
      jobId: r.job_id,
      jobNo: r.job_no,
      registrationNo: r.registration_no,
      vehicle: r.vehicle,
      customer: r.customer,
      service: r.service,
      stage: r.stage,
      bay: r.bay,
      checkedInAt: r.checked_in_at,
      estimatedMinutes: r.estimated_minutes,
      estimateLkr: r.estimate_lkr,
      advisor: r.advisor,
    })),
    total.rows[0].n,
    f,
  );
}

// ---------------------------------------------------------------- service flow: check-in and stage changes

export type Arrival = {
  bookingId: number;
  bookingNo: string;
  status: 'pending' | 'confirmed';
  slotTime: string;
  vehicleId: number;
  registrationNo: string;
  vehicle: string;
  customer: string;
  mobile: string | null;
  serviceTypeId: number;
  service: string;
  customerNotes: string | null;
  openJobNo: string | null;
};

/** Today's bookings (pending or confirmed) that have not been checked in, by time. `today` is the centre's date. */
export async function arrivalsFor(db: Db, today: string): Promise<Arrival[]> {
  const { rows } = await db.query<Arrival>(
    `SELECT b.booking_id AS "bookingId", b.booking_no AS "bookingNo", b.status, to_char(b.slot_time, 'HH24:MI') AS "slotTime",
            v.vehicle_id AS "vehicleId", v.registration_no AS "registrationNo",
            v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle,
            c.full_name AS customer, c.mobile, st.service_type_id AS "serviceTypeId", st.name AS service,
            b.customer_notes AS "customerNotes",
            (SELECT j.job_no FROM workshop.jobs j WHERE j.vehicle_id = v.vehicle_id AND j.stage NOT IN ('completed', 'cancelled') LIMIT 1) AS "openJobNo"
     FROM workshop.bookings b
     JOIN workshop.vehicles v ON v.vehicle_id = b.vehicle_id
     JOIN workshop.customers c ON c.customer_id = b.customer_id
     JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     WHERE b.booking_date = $1::date AND b.status IN ('pending', 'confirmed')
     ORDER BY b.slot_time, b.booking_id`,
    [today],
  );
  return rows;
}

export type WalkInVehicle = { vehicleId: number; registrationNo: string; vehicle: string; customer: string | null; openJobNo: string | null };

/** Vehicles on record matching a plate (spaces and dashes ignored) or owner name, for a walk-in check-in. */
export async function findVehicles(db: Db, search: string): Promise<WalkInVehicle[]> {
  const { rows } = await db.query<WalkInVehicle>(
    `SELECT v.vehicle_id AS "vehicleId", v.registration_no AS "registrationNo",
            v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle, c.full_name AS customer,
            (SELECT j.job_no FROM workshop.jobs j WHERE j.vehicle_id = v.vehicle_id AND j.stage NOT IN ('completed', 'cancelled') LIMIT 1) AS "openJobNo"
     FROM workshop.vehicles v
     LEFT JOIN workshop.customers c ON c.customer_id = v.customer_id
     WHERE upper(replace(replace(v.registration_no, ' ', ''), '-', '')) LIKE $1 OR c.full_name ILIKE $2
     ORDER BY v.registration_no
     LIMIT 20`,
    [`%${search.replace(/[\s-]/g, '').toUpperCase()}%`, `%${search}%`],
  );
  return rows;
}

export async function serviceTypes(db: Db): Promise<{ serviceTypeId: number; name: string; defaultMinutes: number }[]> {
  const { rows } = await db.query(
    `SELECT service_type_id AS "serviceTypeId", name, default_minutes AS "defaultMinutes"
     FROM workshop.service_types WHERE is_active ORDER BY name`,
  );
  return rows;
}

/** The booking, locked until the transaction ends; null when it is not open for today. */
export async function lockBookingForCheckIn(db: Db, bookingId: number, today: string) {
  const { rows } = await db.query<{ booking_no: string; status: string; vehicle_id: number; customer_id: number; service_type_id: number; customer_notes: string | null }>(
    `SELECT booking_no, status, vehicle_id, customer_id, service_type_id, customer_notes FROM workshop.bookings
     WHERE booking_id = $1 AND booking_date = $2::date AND status IN ('pending', 'confirmed') FOR UPDATE`,
    [bookingId, today],
  );
  return rows[0] ?? null;
}

export async function vehicleOwner(db: Db, vehicleId: number): Promise<{ customerId: number | null } | null> {
  const { rows } = await db.query<{ customer_id: number | null }>('SELECT customer_id FROM workshop.vehicles WHERE vehicle_id = $1', [vehicleId]);
  return rows[0] ? { customerId: rows[0].customer_id } : null;
}

export async function openJobOf(db: Db, vehicleId: number): Promise<string | null> {
  const { rows } = await db.query<{ job_no: string }>(
    `SELECT job_no FROM workshop.jobs WHERE vehicle_id = $1 AND stage NOT IN ('completed', 'cancelled') LIMIT 1`,
    [vehicleId],
  );
  return rows[0]?.job_no ?? null;
}

/** A new job in the queue (waiting_for_bay), with both stage-history rows. Estimated minutes = the service's default. */
export async function insertJob(
  db: Db,
  j: { vehicleId: number; customerId: number | null; serviceTypeId: number; advisorId: number; customerNotes: string | null; note: string },
): Promise<{ jobId: number; jobNo: string }> {
  const { rows } = await db.query<{ job_id: number; job_no: string }>(
    `INSERT INTO workshop.jobs (vehicle_id, customer_id, service_type_id, stage, advisor_user_id, estimated_minutes, customer_notes)
     SELECT $1, $2, st.service_type_id, 'waiting_for_bay', $4, st.default_minutes, $5
     FROM workshop.service_types st WHERE st.service_type_id = $3 AND st.is_active
     RETURNING job_id, job_no`,
    [j.vehicleId, j.customerId, j.serviceTypeId, j.advisorId, j.customerNotes],
  );
  const job = rows[0];
  if (!job) throw new Error('SERVICE_TYPE_INACTIVE');
  await db.query(
    `INSERT INTO workshop.job_stage_history (job_id, stage, user_id, note) VALUES ($1, 'checked_in', $2, $3), ($1, 'waiting_for_bay', $2, 'In the queue for a bay')`,
    [job.job_id, j.advisorId, j.note],
  );
  return { jobId: job.job_id, jobNo: job.job_no };
}

export async function markBookingCheckedIn(db: Db, bookingId: number, jobId: number, userId: number): Promise<void> {
  await db.query(
    `UPDATE workshop.bookings SET status = 'checked_in', job_id = $2, checked_in_at = now(),
            reviewed_by = coalesce(reviewed_by, $3), reviewed_at = coalesce(reviewed_at, now())
     WHERE booking_id = $1`,
    [bookingId, jobId, userId],
  );
}

/**
 * Moves a job from one of `from` to `to`, with its stage history; the timestamp columns that go with the new stage are
 * set. Returns the job number, or null when the job is not in one of `from` (someone else moved it first).
 */
export async function moveStage(
  db: Db,
  m: { jobId: number; from: readonly JobStage[]; to: JobStage; userId: number; note: string | null },
): Promise<string | null> {
  // Back in the queue: no bay any more (its place in the queue is still its check-in time)
  const stamp = m.to === 'ready' ? ', ready_at = now()' : m.to === 'completed' ? ', completed_at = now()'
    : m.to === 'waiting_for_bay' ? ', bay_id = NULL, bay_entered_at = NULL' : '';
  const { rows } = await db.query<{ job_no: string }>(
    `UPDATE workshop.jobs SET stage = $2, updated_at = now()${stamp}
     WHERE job_id = $1 AND stage = ANY($3::varchar[]) RETURNING job_no`,
    [m.jobId, m.to, m.from],
  );
  if (!rows[0]) return null;
  await db.query('INSERT INTO workshop.job_stage_history (job_id, stage, user_id, note) VALUES ($1, $2, $3, $4)', [m.jobId, m.to, m.userId, m.note]);
  return rows[0].job_no;
}

/** Whether the job has a confirmed damage inspection (component 2). */
export async function hasConfirmedInspection(db: Db, jobId: number): Promise<boolean> {
  const { rows } = await db.query(`SELECT 1 FROM damage.inspections WHERE job_id = $1 AND status = 'confirmed' LIMIT 1`, [jobId]);
  return rows.length > 0;
}
