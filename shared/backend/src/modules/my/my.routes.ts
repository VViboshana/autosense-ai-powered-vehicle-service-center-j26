import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { sendOk } from '../../http/envelope.js';
import { ConflictError, NotFoundError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { requireCustomer, signedInUser } from '../../middleware/requireScreen.js';
import { PLATE_KEY } from '../claims/claims.routes.js';

const claimBody = z.object({
  registrationNo: z
    .string()
    .trim()
    .min(4, 'Enter the number plate, e.g. WP CAB-4521.')
    .max(20)
    .regex(/^[A-Za-z0-9 -]+$/, 'Use letters, numbers, spaces and dashes only.')
    .transform((s) => s.toUpperCase().replace(/\s+/g, ' ')),
  note: z.string().trim().max(300).optional().transform((s) => s || null),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * The customer side (/api/my/*). Rule for every query here: filter by the signed-in customer's id
 * (req.user.customerId), and show a vehicle only through an APPROVED request. Never accept a customer id from the
 * request. Customers see confirmed inspections only, never the unreviewed AI result.
 */
export function myRoutes(pool: pg.Pool) {
  const router = Router();
  router.use(requireCustomer());

  const customerId = (req: Parameters<typeof signedInUser>[0]) => signedInUser(req).customerId!;

  /** My vehicles, with where each one is today, plus my requests that are waiting or were turned down. */
  router.get('/vehicles', async (req, res) => {
    const me = customerId(req);
    const vehicles = await pool.query(
      `SELECT v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.colour,
              j.stage, j.checked_in_at, b.name AS bay
       FROM workshop.vehicle_claims vc
       JOIN workshop.vehicles v ON v.vehicle_id = vc.vehicle_id
       LEFT JOIN LATERAL (
         SELECT * FROM workshop.jobs jj WHERE jj.vehicle_id = v.vehicle_id AND jj.stage NOT IN ('completed', 'cancelled')
         ORDER BY jj.checked_in_at DESC LIMIT 1
       ) j ON true
       LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
       WHERE vc.customer_id = $1 AND vc.status = 'approved'
       ORDER BY v.registration_no`,
      [me],
    );
    const requests = await pool.query(
      `SELECT claim_id, registration_no, status, customer_note, review_note, requested_at, reviewed_at
       FROM workshop.vehicle_claims
       WHERE customer_id = $1 AND status IN ('pending', 'rejected')
       ORDER BY requested_at DESC LIMIT 20`,
      [me],
    );
    sendOk(res, {
      vehicles: vehicles.rows.map((r) => ({
        vehicleId: r.vehicle_id,
        registrationNo: r.registration_no,
        description: `${r.make} ${r.model}${r.year ? ` · ${r.year}` : ''}${r.colour ? ` · ${r.colour}` : ''}`,
        visit: r.stage ? { stage: r.stage, checkedInAt: r.checked_in_at, bay: r.bay } : null,
      })),
      requests: requests.rows.map((r) => ({
        claimId: r.claim_id,
        registrationNo: r.registration_no,
        status: r.status,
        note: r.customer_note,
        reviewNote: r.review_note,
        requestedAt: r.requested_at,
        reviewedAt: r.reviewed_at,
      })),
    });
  });

  /** Ask to link a vehicle; staff approve it after checking. */
  router.post('/vehicle-requests', async (req, res) => {
    const user = signedInUser(req);
    const body = parse(claimBody, req.body);
    const dup = await pool.query(
      `SELECT status FROM workshop.vehicle_claims
       WHERE customer_id = $1 AND status IN ('pending', 'approved') AND ${PLATE_KEY('registration_no')} = ${PLATE_KEY('$2')}`,
      [user.customerId, body.registrationNo],
    );
    if (dup.rows[0]) {
      throw new ConflictError(
        'ALREADY_REQUESTED',
        dup.rows[0].status === 'approved' ? 'This vehicle is already in your list.' : 'You have already asked for this vehicle. The service centre will check it soon.',
      );
    }
    const { rows } = await pool.query<{ claim_id: number }>(
      'INSERT INTO workshop.vehicle_claims (customer_id, registration_no, customer_note) VALUES ($1, $2, $3) RETURNING claim_id',
      [user.customerId, body.registrationNo, body.note],
    );
    await audit(pool, { table: 'workshop.vehicle_claims', recordId: rows[0]!.claim_id, action: 'requested', userId: user.userId, snapshot: { registrationNo: body.registrationNo } });
    sendOk(res, { claimId: rows[0]!.claim_id, status: 'pending' }, 201);
  });

  router.delete('/vehicle-requests/:id', async (req, res) => {
    const user = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { rows } = await pool.query(
      `UPDATE workshop.vehicle_claims SET status = 'cancelled' WHERE claim_id = $1 AND customer_id = $2 AND status = 'pending' RETURNING claim_id`,
      [id, user.customerId],
    );
    if (!rows[0]) throw new NotFoundError('There is no waiting request with this number.');
    sendOk(res, { claimId: id, status: 'cancelled' });
  });

  /**
   * One of my vehicles: each section is filled only if the Customer role allows that tab (admin can switch tabs off),
   * and only with information meant for customers.
   */
  router.get('/vehicles/:id', async (req, res) => {
    const user = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const owned = await pool.query(
      `SELECT v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.colour, v.fuel_type
       FROM workshop.vehicle_claims vc JOIN workshop.vehicles v ON v.vehicle_id = vc.vehicle_id
       WHERE vc.customer_id = $1 AND vc.status = 'approved' AND v.vehicle_id = $2`,
      [user.customerId, id],
    );
    const v = owned.rows[0];
    if (!v) throw new NotFoundError('This vehicle is not in your list.');
    const can = (code: string) => user.screens.has(code);

    let status = null;
    if (can('MY_VEHICLE_STATUS')) {
      const job = await pool.query(
        `SELECT j.job_no, j.stage, j.checked_in_at, j.bay_entered_at, j.ready_at, st.name AS service, b.name AS bay,
                CASE WHEN j.stage = 'waiting_for_bay' THEN
                  (SELECT count(*) + 1 FROM workshop.jobs w WHERE w.stage = 'waiting_for_bay' AND w.checked_in_at < j.checked_in_at)
                END AS queue_position
         FROM workshop.jobs j
         JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
         LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
         WHERE j.vehicle_id = $1 AND j.stage NOT IN ('completed', 'cancelled')
         ORDER BY j.checked_in_at DESC LIMIT 1`,
        [id],
      );
      const j = job.rows[0];
      status = j
        ? {
            jobNo: j.job_no,
            stage: j.stage,
            service: j.service,
            bay: j.bay,
            checkedInAt: j.checked_in_at,
            bayEnteredAt: j.bay_entered_at,
            readyAt: j.ready_at,
            queuePosition: j.queue_position,
            estimatedReadyAt: null, // shown once waiting-time estimates are validated
          }
        : null;
    }

    let inspections = null;
    if (can('MY_INSPECTIONS')) {
      const rows = await pool.query(
        `SELECT i.inspection_id, i.inspection_no, i.reviewed_at, i.overall_severity,
                COALESCE(json_agg(json_build_object(
                  'label', COALESCE(d.corrected_label, d.label),
                  'location', d.location,
                  'severity', COALESCE(d.corrected_severity, d.severity)
                ) ORDER BY d.detection_id) FILTER (WHERE d.detection_id IS NOT NULL), '[]') AS findings
         FROM damage.inspections i
         LEFT JOIN damage.inspection_images im ON im.inspection_id = i.inspection_id
         LEFT JOIN damage.detections d ON d.image_id = im.image_id AND d.review_status <> 'rejected'
                                       AND (NOT d.is_suggestion OR d.review_status IN ('confirmed', 'corrected'))
         WHERE i.vehicle_id = $1 AND i.status = 'confirmed'
         GROUP BY i.inspection_id
         ORDER BY i.reviewed_at DESC`,
        [id],
      );
      inspections = rows.rows.map((r) => ({
        inspectionNo: r.inspection_no,
        confirmedAt: r.reviewed_at,
        overallSeverity: r.overall_severity,
        findings: r.findings,
      }));
    }

    sendOk(res, {
      vehicle: {
        vehicleId: v.vehicle_id,
        registrationNo: v.registration_no,
        description: `${v.make} ${v.model}${v.year ? ` · ${v.year}` : ''}`,
        colour: v.colour,
        fuelType: v.fuel_type,
      },
      sections: {
        status: can('MY_VEHICLE_STATUS') ? { available: true, data: status } : { available: false },
        inspections: can('MY_INSPECTIONS') ? { available: true, data: inspections } : { available: false },
        // Filled when the maintenance and security components publish customer-safe results
        maintenance: can('MY_MAINTENANCE') ? { available: true, connected: false, data: null } : { available: false },
        safety: can('MY_SAFETY_NOTICES') ? { available: true, connected: false, data: null } : { available: false },
      },
    });
  });

  return router;
}
