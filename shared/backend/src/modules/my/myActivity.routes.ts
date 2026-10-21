import { Router } from 'express';
import type pg from 'pg';
import { sendOk } from '../../http/envelope.js';
import { photoUrl } from '../../lib/vehiclePhotos.js';
import { requireCustomer, signedInUser } from '../../middleware/requireScreen.js';

const STAGE_NEWS: Record<string, { title: string; tone: string; icon: string }> = {
  checked_in: { title: 'was checked in', tone: 'info', icon: 'bi-box-arrow-in-right' },
  waiting_for_bay: { title: 'is waiting for a bay', tone: 'warning', icon: 'bi-hourglass-split' },
  in_bay: { title: 'is in a service bay', tone: 'brand', icon: 'bi-tools' },
  inspecting: { title: 'is being inspected for damage', tone: 'info', icon: 'bi-clipboard-check' },
  ready: { title: 'is ready for pickup', tone: 'success', icon: 'bi-check2-circle' },
  completed: { title: 'was collected', tone: 'muted', icon: 'bi-flag' },
};

/**
 * The customer's activity across all their vehicles (/api/my): every visit (service history), and notifications
 * built from what already happened (requests reviewed, visits moving on, reports confirmed, bookings answered).
 * Vehicles count only through an APPROVED request; news about a vehicle starts from the day it was approved.
 */
export function myActivityRoutes(pool: pg.Pool) {
  const router = Router();

  /** Every visit of my vehicles, newest first, with its confirmed inspection report if there is one. */
  router.get('/history', requireCustomer('MY_HISTORY'), async (req, res) => {
    const user = signedInUser(req);
    const { rows } = await pool.query(
      `SELECT j.job_id, j.job_no, j.stage, j.checked_in_at, j.ready_at, j.completed_at, j.estimate_lkr, j.estimated_minutes,
              st.name AS service, b.name AS bay,
              v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.photo_key,
              i.inspection_id, i.inspection_no, i.overall_severity
       FROM workshop.vehicle_claims vc
       JOIN workshop.vehicles v ON v.vehicle_id = vc.vehicle_id
       JOIN workshop.jobs j ON j.vehicle_id = v.vehicle_id
       JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
       LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
       LEFT JOIN LATERAL (
         SELECT ii.inspection_id, ii.inspection_no, ii.overall_severity FROM damage.inspections ii
         WHERE ii.job_id = j.job_id AND ii.status = 'confirmed' ORDER BY ii.reviewed_at DESC LIMIT 1
       ) i ON true
       WHERE vc.customer_id = $1 AND vc.status = 'approved'
       ORDER BY j.checked_in_at DESC LIMIT 200`,
      [user.customerId],
    );
    const visits = rows.map((r) => ({
      jobId: r.job_id,
      jobNo: r.job_no,
      stage: r.stage,
      service: r.service,
      bay: r.bay,
      checkedInAt: r.checked_in_at,
      readyAt: r.ready_at,
      completedAt: r.completed_at,
      estimateLkr: r.estimate_lkr === null ? null : Number(r.estimate_lkr),
      estimatedMinutes: r.estimated_minutes,
      vehicle: {
        vehicleId: r.vehicle_id,
        registrationNo: r.registration_no,
        description: `${r.make} ${r.model}${r.year ? ` · ${r.year}` : ''}`,
        photoUrl: photoUrl(`/api/my/vehicles/${r.vehicle_id}/photo`, r.photo_key),
      },
      inspection: r.inspection_id ? { inspectionId: r.inspection_id, inspectionNo: r.inspection_no, overallSeverity: r.overall_severity } : null,
    }));
    sendOk(res, {
      visits,
      totals: {
        visits: visits.length,
        completed: visits.filter((v) => v.stage === 'completed').length,
        vehicles: new Set(visits.map((v) => v.vehicle.vehicleId)).size,
        reports: visits.filter((v) => v.inspection).length,
      },
    });
  });

  /** My notifications from the last 60 days (newest first) and how many arrived since I last opened them. */
  router.get('/notifications', requireCustomer(), async (req, res) => {
    const user = signedInUser(req);
    const me = user.customerId!;
    const canReports = user.screens.has('MY_INSPECTIONS');
    const canPlans = user.screens.has('MY_MAINTENANCE');
    const [claims, stages, reports, bookings, seen, plans] = await Promise.all([
      pool.query(
        `SELECT claim_id, registration_no, status, review_note, reviewed_at FROM workshop.vehicle_claims
         WHERE customer_id = $1 AND status IN ('approved', 'rejected') AND reviewed_at > now() - interval '60 days'`,
        [me],
      ),
      pool.query(
        `SELECT h.history_id, h.stage, h.at, v.vehicle_id, v.registration_no, b.name AS bay
         FROM workshop.vehicle_claims vc
         JOIN workshop.vehicles v ON v.vehicle_id = vc.vehicle_id
         JOIN workshop.jobs j ON j.vehicle_id = v.vehicle_id
         JOIN workshop.job_stage_history h ON h.job_id = j.job_id
         LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
         WHERE vc.customer_id = $1 AND vc.status = 'approved' AND h.at >= vc.reviewed_at
           AND h.at > now() - interval '60 days' AND h.stage IN ('checked_in', 'waiting_for_bay', 'in_bay', 'inspecting', 'ready', 'completed')`,
        [me],
      ),
      canReports
        ? pool.query(
            `SELECT i.inspection_id, i.inspection_no, i.reviewed_at, v.vehicle_id, v.registration_no
             FROM workshop.vehicle_claims vc
             JOIN workshop.vehicles v ON v.vehicle_id = vc.vehicle_id
             JOIN damage.inspections i ON i.vehicle_id = v.vehicle_id AND i.status = 'confirmed'
             WHERE vc.customer_id = $1 AND vc.status = 'approved' AND i.reviewed_at >= vc.reviewed_at
               AND i.reviewed_at > now() - interval '60 days'`,
            [me],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      pool.query(
        `SELECT b.booking_id, b.booking_no, b.status, b.staff_note, b.reviewed_at, to_char(b.booking_date, 'YYYY-MM-DD') AS day,
                to_char(b.slot_time, 'HH24:MI') AS time, v.registration_no
         FROM workshop.bookings b JOIN workshop.vehicles v ON v.vehicle_id = b.vehicle_id
         WHERE b.customer_id = $1 AND b.status IN ('confirmed', 'declined') AND b.reviewed_at > now() - interval '60 days'`,
        [me],
      ),
      pool.query<{ seen: Date | null }>('SELECT notifications_seen_at AS seen FROM app.users WHERE user_id = $1', [user.userId]),
      canPlans
        ? pool.query(
            `SELECT f.forecast_id, f.confirmed_at, f.selected_fix_title, f.estimated_minutes, v.vehicle_id, v.registration_no
             FROM workshop.vehicle_claims vc
             JOIN workshop.vehicles v ON v.vehicle_id = vc.vehicle_id
             JOIN maintenance.forecasts f ON f.vehicle_id = v.vehicle_id AND f.status = 'confirmed'
             WHERE vc.customer_id = $1 AND vc.status = 'approved' AND f.confirmed_at >= vc.reviewed_at
               AND f.confirmed_at > now() - interval '60 days'`,
            [me],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);

    type Item = { id: string; title: string; body: string | null; at: Date; tone: string; icon: string; link: string | null };
    const items: Item[] = [
      ...claims.rows.map((c) => ({
        id: `claim-${c.claim_id}`,
        title: c.status === 'approved' ? `${c.registration_no} was added to your vehicles` : `${c.registration_no} could not be confirmed`,
        body: c.review_note,
        at: c.reviewed_at,
        tone: c.status === 'approved' ? 'success' : 'danger',
        icon: c.status === 'approved' ? 'bi-car-front' : 'bi-x-circle',
        link: c.status === 'approved' ? '/my/vehicles' : null,
      })),
      ...stages.rows.map((s) => {
        const news = STAGE_NEWS[s.stage]!;
        return {
          id: `stage-${s.history_id}`,
          title: `${s.registration_no} ${news.title}`,
          body: s.stage === 'in_bay' && s.bay ? `Now in ${s.bay}.` : s.stage === 'ready' ? 'Collect it from the service centre.' : null,
          at: s.at,
          tone: news.tone,
          icon: news.icon,
          link: `/my/vehicles/${s.vehicle_id}`,
        };
      }),
      ...reports.rows.map((r) => ({
        id: `report-${r.inspection_id}`,
        title: `Inspection report ready for ${r.registration_no}`,
        body: `Report ${r.inspection_no}, checked by a technician.`,
        at: r.reviewed_at as Date,
        tone: 'info',
        icon: 'bi-clipboard-check',
        link: `/my/vehicles/${r.vehicle_id}#report`,
      })),
      ...plans.rows.map((f) => ({
        id: `plan-${f.forecast_id}`,
        title: `Maintenance plan ready for ${f.registration_no}`,
        body: f.selected_fix_title ? `${f.selected_fix_title}${f.estimated_minutes != null ? `, about ${f.estimated_minutes} min of work` : ''}.` : null,
        at: f.confirmed_at as Date,
        tone: 'info',
        icon: 'bi-wrench-adjustable',
        link: `/my/vehicles/${f.vehicle_id}#plan`,
      })),
      ...bookings.rows.map((b) => ({
        id: `booking-${b.booking_id}`,
        title: b.status === 'confirmed' ? `Booking ${b.booking_no} confirmed` : `Booking ${b.booking_no} declined`,
        body: b.staff_note ?? (b.status === 'confirmed' ? `${b.registration_no} on ${b.day} at ${b.time}. See you then.` : null),
        at: b.reviewed_at,
        tone: b.status === 'confirmed' ? 'success' : 'danger',
        icon: b.status === 'confirmed' ? 'bi-calendar-check' : 'bi-calendar-x',
        link: '/my/bookings',
      })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 40);

    const seenAt = seen.rows[0]?.seen ? new Date(seen.rows[0].seen).getTime() : 0;
    sendOk(res, {
      unread: items.filter((i) => new Date(i.at).getTime() > seenAt).length,
      items: items.map((i) => ({ ...i, unread: new Date(i.at).getTime() > seenAt })),
    });
  });

  /** I opened my notifications: the ones so far are no longer new. */
  router.post('/notifications/seen', requireCustomer(), async (req, res) => {
    const user = signedInUser(req);
    await pool.query('UPDATE app.users SET notifications_seen_at = now() WHERE user_id = $1', [user.userId]);
    sendOk(res, { seen: true });
  });

  return router;
}
