import type { Db } from '../../db/pool.js';
import { NotFoundError } from '../../http/errors.js';

const PLATE = "upper(replace(replace(v.registration_no, ' ', ''), '-', ''))";

export async function searchVehicles(db: Db, search: string) {
  const q = `%${search.replace(/[\s-]/g, '').toUpperCase()}%`;
  const { rows } = await db.query(
    `SELECT v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.odometer_km,
            c.customer_id, c.full_name AS customer_name
     FROM workshop.vehicles v LEFT JOIN workshop.customers c ON c.customer_id = v.customer_id
     WHERE ${PLATE} LIKE $1 OR v.make ILIKE $2 OR v.model ILIKE $2 OR c.full_name ILIKE $2
     ORDER BY v.registration_no LIMIT 20`, [q, `%${search}%`],
  );
  return rows.map((r) => ({ vehicleId: r.vehicle_id, registrationNo: r.registration_no, make: r.make, model: r.model, year: r.year, latestMileage: r.odometer_km, customer: r.customer_id ? { customerId: r.customer_id, name: r.customer_name } : null }));
}

/**
 * Everything the forecast wizard pre-fills for a vehicle. With `jobId` (a vehicle at the centre) the context is that
 * visit: its booking and, first in the list, the damage inspection confirmed for that job.
 */
export async function vehicleBootstrap(db: Db, vehicleId: number, bookingId?: number, jobId?: number) {
  let job: { jobId: number; jobNo: string; stage: string; service: string; bookingId: number | null } | null = null;
  if (jobId) {
    const j = await db.query(
      `SELECT j.job_id, j.job_no, j.stage, st.name AS service,
              (SELECT b.booking_id FROM workshop.bookings b WHERE b.job_id = j.job_id LIMIT 1) AS booking_id
       FROM workshop.jobs j JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
       WHERE j.job_id = $1 AND j.vehicle_id = $2`, [jobId, vehicleId],
    );
    if (!j.rows[0]) throw new NotFoundError('That job is not for this vehicle.');
    const r = j.rows[0];
    job = { jobId: r.job_id, jobNo: r.job_no, stage: r.stage, service: r.service, bookingId: r.booking_id };
    bookingId = bookingId ?? r.booking_id ?? undefined;
  }
  const vehicle = await db.query(
    `SELECT v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.odometer_km, c.customer_id, c.full_name AS customer_name
     FROM workshop.vehicles v LEFT JOIN workshop.customers c ON c.customer_id = v.customer_id WHERE v.vehicle_id = $1`, [vehicleId],
  );
  if (!vehicle.rows[0]) throw new NotFoundError('Vehicle not found.');
  const v = vehicle.rows[0];
  const bookings = await db.query(
    `SELECT b.booking_id, b.booking_no, to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date, to_char(b.slot_time, 'HH24:MI') AS slot_time,
            b.status, b.customer_notes, st.name AS service
     FROM workshop.bookings b JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     WHERE b.vehicle_id = $1 AND (($2::int IS NULL AND NOT $3 AND b.status IN ('pending','confirmed')) OR b.booking_id = $2)
     ORDER BY b.booking_date DESC, b.slot_time DESC LIMIT 10`, [vehicleId, bookingId ?? null, Boolean(job)],
  );
  const history = await db.query(
    `SELECT j.job_id, j.job_no, j.completed_at AS date, j.estimated_minutes, st.name AS service,
            j.customer_notes AS notes, v.odometer_km AS mileage, v.registration_no,
            c.full_name AS customer, st.name AS category, u.first_name || ' ' || u.last_name AS advisor
     FROM workshop.jobs j JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
     JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     LEFT JOIN workshop.customers c ON c.customer_id = j.customer_id
     LEFT JOIN app.users u ON u.user_id = j.advisor_user_id
     WHERE j.vehicle_id = $1 AND j.stage = 'completed' ORDER BY j.completed_at DESC NULLS LAST, j.job_id DESC LIMIT 20`, [vehicleId],
  );
  const inspections = await db.query(
    `SELECT i.inspection_id, i.job_id, i.inspection_no, i.status, i.overall_severity, i.review_notes, i.reviewed_at
     FROM damage.inspections i WHERE i.vehicle_id = $1 AND i.status = 'confirmed'
     ORDER BY (i.job_id IS NOT DISTINCT FROM $2::int) DESC, i.reviewed_at DESC NULLS LAST LIMIT 10`, [vehicleId, jobId ?? null],
  );
  return {
    job,
    vehicle: { vehicleId: v.vehicle_id, registrationNo: v.registration_no, make: v.make, model: v.model, year: v.year, latestMileage: v.odometer_km, customer: v.customer_id ? { customerId: v.customer_id, name: v.customer_name } : null },
    bookings: bookings.rows.map((r) => ({ bookingId: r.booking_id, bookingNo: r.booking_no, date: r.booking_date, time: r.slot_time, status: r.status, service: r.service, notes: r.customer_notes })),
    serviceHistory: history.rows.map((r) => ({ id: `JOB-${r.job_id}`, date: r.date, registrationNo: r.registration_no, customer: r.customer, mileage: r.mileage ?? 0, service: r.service, category: r.category, durationMinutes: r.estimated_minutes, advisor: r.advisor ?? 'Not recorded', notes: r.notes ?? '' })),
    inspections: inspections.rows.map((r) => ({ jobId: r.job_id, inspectionId: r.inspection_id, inspectionNo: r.inspection_no, status: r.status, severity: r.overall_severity, notes: r.review_notes, reviewedAt: r.reviewed_at })),
  };
}

/**
 * Vehicles at the centre whose damage inspection is confirmed (job stage 'inspected') and whose visit has no
 * maintenance forecast yet: the next step of the service flow, booked or walk-in alike.
 */
export async function listJobsAwaitingForecast(db: Db) {
  const { rows } = await db.query(
    `SELECT j.job_id, j.job_no, j.vehicle_id, v.registration_no, v.make, v.model, c.full_name AS customer_name,
            st.name AS service, b.name AS bay, i.inspection_id, i.inspection_no, i.overall_severity, i.reviewed_at
     FROM workshop.jobs j
     JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
     LEFT JOIN workshop.customers c ON c.customer_id = j.customer_id
     LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
     LEFT JOIN LATERAL (SELECT inspection_id, inspection_no, overall_severity, reviewed_at FROM damage.inspections
                        WHERE job_id = j.job_id AND status = 'confirmed' ORDER BY reviewed_at DESC LIMIT 1) i ON true
     WHERE j.stage = 'inspected'
       AND NOT EXISTS (SELECT 1 FROM maintenance.forecasts f WHERE f.job_id = j.job_id)
     ORDER BY i.reviewed_at NULLS LAST, j.checked_in_at`,
  );
  return rows.map((r) => ({
    jobId: r.job_id,
    jobNo: r.job_no,
    vehicleId: r.vehicle_id,
    registrationNo: r.registration_no,
    make: r.make,
    model: r.model,
    customer: r.customer_name,
    service: r.service,
    bay: r.bay,
    inspectionId: r.inspection_id,
    inspectionNo: r.inspection_no,
    severity: r.overall_severity,
    inspectedAt: r.reviewed_at,
  }));
}

export async function listBookingsAwaitingForecast(db: Db) {
  const { rows } = await db.query(
    `SELECT b.booking_id, b.booking_no, b.vehicle_id, v.registration_no, v.make, v.model,
            c.full_name AS customer_name, st.name AS service, to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
            to_char(b.slot_time, 'HH24:MI') AS slot_time,
            b.status, b.customer_notes
     FROM workshop.bookings b
     JOIN workshop.vehicles v ON v.vehicle_id = b.vehicle_id
     JOIN workshop.customers c ON c.customer_id = b.customer_id
     JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     LEFT JOIN maintenance.forecasts f ON f.booking_id = b.booking_id
     WHERE b.status IN ('pending', 'confirmed') AND b.booking_date >= current_date AND f.forecast_id IS NULL
     ORDER BY b.booking_date ASC, b.slot_time ASC, b.booking_id ASC`,
  );
  return rows.map((r) => ({
    bookingId: r.booking_id,
    bookingNo: r.booking_no,
    vehicleId: r.vehicle_id,
    registrationNo: r.registration_no,
    make: r.make,
    model: r.model,
    customer: r.customer_name,
    service: r.service,
    date: r.booking_date,
    time: r.slot_time,
    status: r.status,
    notes: r.customer_notes,
  }));
}

export async function listForecasts(db: Db) {
  const { rows } = await db.query(
    `SELECT f.forecast_id, f.status, f.created_at, f.predicted_category, f.model_score, f.estimated_minutes,
            f.estimated_hours, f.selected_fix_title, v.registration_no, v.make, v.model, v.year, v.odometer_km, c.full_name AS customer_name,
            j.job_no
     FROM maintenance.forecasts f JOIN workshop.vehicles v ON v.vehicle_id = f.vehicle_id
     LEFT JOIN workshop.jobs j ON j.job_id = f.job_id
     LEFT JOIN workshop.customers c ON c.customer_id = f.customer_id ORDER BY f.created_at DESC LIMIT 100`,
  );
  return rows.map((r) => ({ id: String(r.forecast_id), registrationNo: r.registration_no, vehicle: `${r.make} ${r.model}${r.year ? ` · ${r.year}` : ''}`, customer: r.customer_name ?? 'Not recorded', mileage: r.odometer_km ?? 0, jobNo: r.job_no ?? null, maintenanceRequired: false, maintenanceRequiredStatus: 'not_evaluated', category: r.predicted_category, modelScore: Number(r.model_score), status: r.status === 'confirmed' ? 'Confirmed' : 'Preliminary', updatedAt: r.created_at, categoryScores: [], durationMinutes: r.estimated_minutes, durationHours: r.estimated_hours, durationStatus: r.estimated_minutes == null ? 'awaiting_task_selection' : 'evaluated', serviceHistory: [], sourceAvailability: {} }));
}

export async function getForecast(db: Db, id: number) {
  const { rows } = await db.query(`SELECT f.*, v.registration_no, v.make, v.model, v.year, c.full_name AS customer_name,
          b.booking_no, b.status AS booking_status, b.customer_notes AS booking_notes, st.name AS booking_service,
          j.job_no, j.stage AS job_stage, i.inspection_no, i.status AS inspection_status, i.overall_severity AS inspection_severity, i.review_notes AS inspection_notes
     FROM maintenance.forecasts f JOIN workshop.vehicles v ON v.vehicle_id = f.vehicle_id
     LEFT JOIN workshop.customers c ON c.customer_id = f.customer_id
     LEFT JOIN workshop.bookings b ON b.booking_id = f.booking_id
     LEFT JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     LEFT JOIN damage.inspections i ON i.inspection_id = f.inspection_id
     LEFT JOIN workshop.jobs j ON j.job_id = f.job_id
     WHERE f.forecast_id = $1`, [id]);
  return rows[0] ?? null;
}
