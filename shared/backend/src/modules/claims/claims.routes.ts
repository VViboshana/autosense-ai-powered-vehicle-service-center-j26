import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors.js';
import { offsetOf, pageQuery, toPage } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';

/** Plate numbers compared without spaces and dashes, in capitals. */
export const PLATE_KEY = (column: string) => `upper(replace(replace(${column}, ' ', ''), '-', ''))`;

const listQuery = pageQuery.extend({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).default('pending') });
const decision = z.object({ note: z.string().trim().max(300).optional().transform((s) => s || null) });
const emptyAsMissing = (v: unknown) => (v === '' || v == null ? undefined : v);
export const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'other'] as const;
/** The vehicle's details, entered by staff when the plate is not on record yet (they have the vehicle or its papers). */
const vehicleDetails = z.object({
  make: z.string().trim().min(1, 'Enter the make, e.g. Toyota.').max(40),
  model: z.string().trim().min(1, 'Enter the model, e.g. Aqua.').max(60),
  year: z.preprocess(emptyAsMissing, z.coerce.number().int().min(1950, 'Enter a year from 1950.').max(new Date().getFullYear() + 1, 'That year is in the future.').optional()),
  colour: z.string().trim().max(30).optional().transform((s) => s || null),
  fuelType: z.preprocess(emptyAsMissing, z.enum(FUEL_TYPES).optional()),
});
export const approveBody = decision.extend({ vehicle: vehicleDetails.optional() });
const rejectBody = z.object({ note: z.string().trim().min(3, 'Tell the customer why.').max(300) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Service floor › Customer vehicle requests (VEHICLE_CLAIMS). A customer asks to see a vehicle by its plate; staff
 * check it (e.g. the registration book at the counter) and approve or reject. Approving makes the customer the
 * vehicle's owner on record, and ends any other customer's link to it.
 *
 * A plate that is not on record yet can still be approved: staff then enter the vehicle's details (make, model, ...)
 * from the vehicle or its papers, and the vehicle is created and linked in the same step. A customer's request alone
 * never creates a vehicle.
 */
export function claimsRoutes(pool: pg.Pool) {
  const router = Router();
  router.use(requireScreen('VEHICLE_CLAIMS'));

  router.get('/', async (req, res) => {
    const f = parse(listQuery, req.query);
    const total = await pool.query('SELECT count(*) AS n FROM workshop.vehicle_claims WHERE status = $1', [f.status]);
    const rows = await pool.query(
      `SELECT vc.claim_id, vc.registration_no, vc.status, vc.customer_note, vc.review_note, vc.requested_at, vc.reviewed_at,
              c.customer_id, c.full_name AS customer_name, c.mobile AS customer_mobile,
              v.vehicle_id, v.registration_no AS vehicle_plate, v.make || ' ' || v.model AS vehicle, v.year,
              owner.full_name AS owner_name, v.customer_id AS owner_id,
              r.first_name || ' ' || r.last_name AS reviewed_by
       FROM workshop.vehicle_claims vc
       JOIN workshop.customers c ON c.customer_id = vc.customer_id
       LEFT JOIN workshop.vehicles v ON ${PLATE_KEY('v.registration_no')} = ${PLATE_KEY('vc.registration_no')}
       LEFT JOIN workshop.customers owner ON owner.customer_id = v.customer_id
       LEFT JOIN app.users r ON r.user_id = vc.reviewed_by
       WHERE vc.status = $1
       ORDER BY vc.requested_at ${f.status === 'pending' ? 'ASC' : 'DESC'}
       LIMIT $2 OFFSET $3`,
      [f.status, f.pageSize, offsetOf(f)],
    );
    sendOk(
      res,
      toPage(
        rows.rows.map((r) => ({
          claimId: r.claim_id,
          registrationNo: r.registration_no,
          status: r.status,
          customerNote: r.customer_note,
          reviewNote: r.review_note,
          requestedAt: r.requested_at,
          reviewedAt: r.reviewed_at,
          reviewedBy: r.reviewed_by,
          customer: { customerId: r.customer_id, name: r.customer_name, mobile: r.customer_mobile },
          vehicle: r.vehicle_id
            ? {
                vehicleId: r.vehicle_id,
                registrationNo: r.vehicle_plate,
                description: `${r.vehicle}${r.year ? ` · ${r.year}` : ''}`,
                ownerOnRecord: r.owner_name,
                ownerMatches: r.owner_id === r.customer_id,
              }
            : null,
        })),
        total.rows[0].n,
        f,
      ),
    );
  });

  /** Creates the vehicle record from the details staff entered, with the plate exactly as the customer gave it. */
  async function addVehicle(client: pg.PoolClient, plate: string, customerId: number, v: z.infer<typeof vehicleDetails>, userId: number) {
    try {
      const { rows } = await client.query<{ vehicle_id: number }>(
        `INSERT INTO workshop.vehicles (registration_no, make, model, year, colour, fuel_type, customer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING vehicle_id`,
        [plate, v.make, v.model, v.year ?? null, v.colour, v.fuelType ?? null, customerId],
      );
      const vehicleId = rows[0]!.vehicle_id;
      await audit(client, { table: 'workshop.vehicles', recordId: vehicleId, action: 'created', userId, snapshot: { registrationNo: plate, ...v, from: 'vehicle request' } });
      return vehicleId;
    } catch (err) {
      // Someone added the same plate a moment ago (unique index on the plate)
      if ((err as { code?: string }).code === '23505') throw new ConflictError('VEHICLE_EXISTS', `${plate} was just added by someone else. Refresh and approve again.`);
      throw err;
    }
  }

  async function pendingClaim(client: pg.PoolClient, id: number) {
    const { rows } = await client.query(
      `SELECT vc.claim_id, vc.customer_id, vc.registration_no, vc.status, v.vehicle_id
       FROM workshop.vehicle_claims vc
       LEFT JOIN workshop.vehicles v ON ${PLATE_KEY('v.registration_no')} = ${PLATE_KEY('vc.registration_no')}
       WHERE vc.claim_id = $1 FOR UPDATE OF vc`,
      [id],
    );
    const claim = rows[0];
    if (!claim) throw new NotFoundError('This request does not exist.');
    if (claim.status !== 'pending') throw new BusinessRuleError('ALREADY_DECIDED', `This request was already ${claim.status}.`);
    return claim;
  }

  router.post('/:id/approve', async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { note, vehicle } = parse(approveBody, req.body);
    await withTransaction(pool, async (client) => {
      const claim = await pendingClaim(client, id);
      if (!claim.vehicle_id) {
        if (!vehicle) {
          throw new BusinessRuleError(
            'VEHICLE_NOT_ON_RECORD',
            `There is no vehicle ${claim.registration_no} on record yet. Enter its make and model to add it, then approve.`,
          );
        }
        claim.vehicle_id = await addVehicle(client, claim.registration_no, claim.customer_id, vehicle, me.userId);
      }
      await client.query(
        `UPDATE workshop.vehicle_claims SET status = 'cancelled', review_note = 'Vehicle linked to another customer', reviewed_by = $2, reviewed_at = now()
         WHERE vehicle_id = $1 AND status = 'approved' AND customer_id <> $3`,
        [claim.vehicle_id, me.userId, claim.customer_id],
      );
      await client.query(
        `UPDATE workshop.vehicle_claims SET status = 'approved', vehicle_id = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
         WHERE claim_id = $1`,
        [id, claim.vehicle_id, note, me.userId],
      );
      await client.query('UPDATE workshop.vehicles SET customer_id = $2 WHERE vehicle_id = $1', [claim.vehicle_id, claim.customer_id]);
      await audit(client, { table: 'workshop.vehicle_claims', recordId: id, action: 'approved', userId: me.userId, snapshot: { vehicleId: claim.vehicle_id, customerId: claim.customer_id } });
    });
    sendOk(res, { claimId: id, status: 'approved' });
  });

  router.post('/:id/reject', async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { note } = parse(rejectBody, req.body);
    await withTransaction(pool, async (client) => {
      await pendingClaim(client, id);
      await client.query(
        `UPDATE workshop.vehicle_claims SET status = 'rejected', review_note = $2, reviewed_by = $3, reviewed_at = now() WHERE claim_id = $1`,
        [id, note, me.userId],
      );
      await audit(client, { table: 'workshop.vehicle_claims', recordId: id, action: 'rejected', userId: me.userId, snapshot: { note } });
    });
    sendOk(res, { claimId: id, status: 'rejected' });
  });

  return router;
}
