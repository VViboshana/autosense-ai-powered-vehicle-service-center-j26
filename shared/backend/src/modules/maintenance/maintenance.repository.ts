import type { Db } from '../../db/pool.js';
import { NotFoundError } from '../../http/errors.js';

const PLATE = "upper(replace(replace(v.registration_no, ' ', ''), '-', ''))";

export async function searchVehicles(db: Db, search: string) {
  const q = `%${search.replace(/[\s-]/g, '').toUpperCase()}%`;
  const { rows } = await db.query(
    `SELECT v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.odometer_km,
            c.customer_id, c.full_name AS customer_name,
            (SELECT max(j.odometer_km) FROM workshop.jobs j WHERE j.vehicle_id = v.vehicle_id) AS latest_job_mileage
     FROM workshop.vehicles v LEFT JOIN workshop.customers c ON c.customer_id = v.customer_id
     WHERE ${PLATE} LIKE $1 OR v.make ILIKE $2 OR v.model ILIKE $2 OR c.full_name ILIKE $2
     ORDER BY v.registration_no LIMIT 20`, [q, `%${search}%`],
  );
  return rows.map((r) => ({ vehicleId: r.vehicle_id, registrationNo: r.registration_no, make: r.make, model: r.model, year: r.year, latestMileage: r.latest_job_mileage ?? r.odometer_km, customer: r.customer_id ? { customerId: r.customer_id, name: r.customer_name } : null }));
}

export async function vehicleBootstrap(db: Db, vehicleId: number, bookingId?: number) {
  const vehicle = await db.query(
    `SELECT v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.odometer_km, c.customer_id, c.full_name AS customer_name
     FROM workshop.vehicles v LEFT JOIN workshop.customers c ON c.customer_id = v.customer_id WHERE v.vehicle_id = $1`, [vehicleId],
  );
  if (!vehicle.rows[0]) throw new NotFoundError('Vehicle not found.');
  const v = vehicle.rows[0];
  const bookings = await db.query(
    `SELECT b.booking_id, b.booking_no, b.booking_date, b.slot_time, b.status, b.customer_notes, st.name AS service
     FROM workshop.bookings b JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     WHERE b.vehicle_id = $1 AND ($2::int IS NULL OR b.booking_id = $2) AND b.status IN ('pending','confirmed')
     ORDER BY b.booking_date DESC, b.slot_time DESC LIMIT 10`, [vehicleId, bookingId ?? null],
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
    `SELECT i.inspection_id, i.inspection_no, i.status, i.overall_severity, i.review_notes, i.reviewed_at
     FROM damage.inspections i WHERE i.vehicle_id = $1 AND i.status = 'confirmed' ORDER BY i.reviewed_at DESC NULLS LAST LIMIT 10`, [vehicleId],
  );
  return {
    vehicle: { vehicleId: v.vehicle_id, registrationNo: v.registration_no, make: v.make, model: v.model, year: v.year, latestMileage: v.odometer_km, customer: v.customer_id ? { customerId: v.customer_id, name: v.customer_name } : null },
    bookings: bookings.rows.map((r) => ({ bookingId: r.booking_id, bookingNo: r.booking_no, date: r.booking_date, time: r.slot_time, status: r.status, service: r.service, notes: r.customer_notes })),
    serviceHistory: history.rows.map((r) => ({ id: `JOB-${r.job_id}`, date: r.date, registrationNo: r.registration_no, customer: r.customer, mileage: r.mileage ?? 0, service: r.service, category: r.category, durationMinutes: r.estimated_minutes, advisor: r.advisor ?? 'Not recorded', notes: r.notes ?? '' })),
    inspections: inspections.rows.map((r) => ({ inspectionId: r.inspection_id, inspectionNo: r.inspection_no, status: r.status, severity: r.overall_severity, notes: r.review_notes, reviewedAt: r.reviewed_at })),
  };
}

export async function listBookingsAwaitingForecast(db: Db) {
  const { rows } = await db.query(
    `SELECT b.booking_id, b.booking_no, b.vehicle_id, v.registration_no, v.make, v.model,
            c.full_name AS customer_name, st.name AS service, b.booking_date, b.slot_time,
            b.status, b.customer_notes
     FROM workshop.bookings b
     JOIN workshop.vehicles v ON v.vehicle_id = b.vehicle_id
     JOIN workshop.customers c ON c.customer_id = b.customer_id
     JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     LEFT JOIN maintenance.forecasts f ON f.booking_id = b.booking_id
     WHERE b.status IN ('pending', 'confirmed') AND f.forecast_id IS NULL
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
            f.estimated_hours, f.selected_fix_title, v.registration_no, v.make, v.model, v.year, c.full_name AS customer_name
     FROM maintenance.forecasts f JOIN workshop.vehicles v ON v.vehicle_id = f.vehicle_id
     LEFT JOIN workshop.customers c ON c.customer_id = f.customer_id ORDER BY f.created_at DESC LIMIT 100`,
  );
  return rows.map((r) => ({ id: String(r.forecast_id), registrationNo: r.registration_no, vehicle: `${r.make} ${r.model}${r.year ? ` · ${r.year}` : ''}`, customer: r.customer_name ?? 'Not recorded', mileage: 0, maintenanceRequired: false, maintenanceRequiredStatus: 'not_evaluated', category: r.predicted_category, modelScore: Number(r.model_score), status: r.status === 'confirmed' ? 'Confirmed' : 'Preliminary', updatedAt: r.created_at, categoryScores: [], durationMinutes: r.estimated_minutes, durationHours: r.estimated_hours, durationStatus: r.estimated_minutes == null ? 'awaiting_task_selection' : 'evaluated', serviceHistory: [], sourceAvailability: {} }));
}

export async function getForecast(db: Db, id: number) {
  const { rows } = await db.query(`SELECT f.*, v.registration_no, v.make, v.model, v.year, c.full_name AS customer_name,
          b.booking_no, b.status AS booking_status, b.customer_notes AS booking_notes, st.name AS booking_service,
          i.inspection_no, i.status AS inspection_status, i.overall_severity AS inspection_severity, i.review_notes AS inspection_notes
     FROM maintenance.forecasts f JOIN workshop.vehicles v ON v.vehicle_id = f.vehicle_id
     LEFT JOIN workshop.customers c ON c.customer_id = f.customer_id
     LEFT JOIN workshop.bookings b ON b.booking_id = f.booking_id
     LEFT JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
     LEFT JOIN damage.inspections i ON i.inspection_id = f.inspection_id
     WHERE f.forecast_id = $1`, [id]);
  return rows[0] ?? null;
}
