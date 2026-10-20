import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { sendOk } from '../../http/envelope.js';
import { NotFoundError } from '../../http/errors.js';
import { offsetOf, pageQuery, toPage } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import { centreTimeZone, nowInZone } from './bookingRules.js';
import { BOOKING_COLUMNS, toBooking } from './myBookings.routes.js';

const STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'checked_in'] as const;
const listQuery = pageQuery.extend({ status: z.enum(STATUSES).default('pending') });
const confirmBody = z.object({ note: z.string().trim().max(300).optional().transform((s) => s || null) });
const declineBody = z.object({ note: z.string().trim().min(3, 'Tell the customer why, e.g. "Fully booked; try Thursday."').max(300) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Service floor › Service bookings (BOOKINGS). Customers book a day and time online; staff confirm it (the customer
 * is told) or decline it with a reason. Waiting and confirmed lists show coming days only, soonest first.
 */
export function bookingsRoutes(pool: pg.Pool) {
  const router = Router();
  router.use(requireScreen('BOOKINGS'));

  router.get('/', async (req, res) => {
    const f = parse(listQuery, req.query);
    const today = nowInZone(await centreTimeZone(pool)).date;
    const upcoming = f.status === 'pending' || f.status === 'confirmed';
    const where = `b.status = $1${upcoming ? ' AND b.booking_date >= $2::date' : ''}`;
    const args: unknown[] = upcoming ? [f.status, today] : [f.status];
    const [total, rows, counts] = await Promise.all([
      pool.query<{ n: string }>(`SELECT count(*) AS n FROM workshop.bookings b WHERE ${where}`, args),
      pool.query(
        `SELECT ${BOOKING_COLUMNS}, c.full_name AS customer_name, c.mobile AS customer_mobile,
                r.first_name || ' ' || r.last_name AS reviewed_by
         FROM workshop.bookings b
         JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
         JOIN workshop.vehicles v ON v.vehicle_id = b.vehicle_id
         JOIN workshop.customers c ON c.customer_id = b.customer_id
         LEFT JOIN app.users r ON r.user_id = b.reviewed_by
         WHERE ${where}
         ORDER BY b.booking_date ${upcoming ? 'ASC' : 'DESC'}, b.slot_time ${upcoming ? 'ASC' : 'DESC'}
         LIMIT ${f.pageSize} OFFSET ${offsetOf(f)}`,
        args,
      ),
      pool.query<{ status: string; n: string }>(
        `SELECT status, count(*) AS n FROM workshop.bookings
         WHERE status IN ('pending', 'confirmed') AND booking_date >= $1::date GROUP BY status`,
        [today],
      ),
    ]);
    const records = rows.rows.map((r) => ({
      ...toBooking(r),
      vehicle: { ...toBooking(r).vehicle, photoUrl: null },
      customer: { name: r.customer_name as string, mobile: r.customer_mobile as string | null },
      reviewedBy: r.reviewed_by as string | null,
    }));
    sendOk(res, {
      ...toPage(records, Number(total.rows[0]!.n), f),
      today,
      waiting: Number(counts.rows.find((c) => c.status === 'pending')?.n ?? 0),
      confirmed: Number(counts.rows.find((c) => c.status === 'confirmed')?.n ?? 0),
    });
  });

  async function decide(req: Parameters<typeof signedInUser>[0], status: 'confirmed' | 'declined', note: string | null) {
    const user = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { rows } = await pool.query(
      `UPDATE workshop.bookings SET status = $2, staff_note = $3, reviewed_by = $4, reviewed_at = now()
       WHERE booking_id = $1 AND status = 'pending' RETURNING booking_no`,
      [id, status, note, user.userId],
    );
    if (!rows[0]) throw new NotFoundError('This booking is no longer waiting. Refresh the list.');
    await audit(pool, { table: 'workshop.bookings', recordId: id, action: status, userId: user.userId, snapshot: { note } });
    return { bookingId: id, status };
  }

  router.post('/:id/confirm', async (req, res) => {
    sendOk(res, await decide(req, 'confirmed', parse(confirmBody, req.body ?? {}).note));
  });

  router.post('/:id/decline', async (req, res) => {
    sendOk(res, await decide(req, 'declined', parse(declineBody, req.body ?? {}).note));
  });

  return router;
}
