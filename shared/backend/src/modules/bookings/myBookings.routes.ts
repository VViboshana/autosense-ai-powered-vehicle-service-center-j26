import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { photoUrl } from '../../lib/vehiclePhotos.js';
import { requireCustomer, signedInUser } from '../../middleware/requireScreen.js';
import { bookableDays, bookingProblem, centreTimeZone, getBookingRules, nowInZone } from './bookingRules.js';

const newBooking = z.object({
  vehicleId: z.coerce.number().int().positive('Choose a vehicle.'),
  serviceTypeId: z.coerce.number().int().positive('Choose a service.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day.'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Choose a time.'),
  notes: z.string().trim().max(500, 'Keep the note under 500 characters.').optional().transform((s) => s || null),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** One booking as the customer and staff see it. Dates and times as text, so no time zone can shift them. */
export const BOOKING_COLUMNS = `b.booking_id, b.booking_no, b.status, to_char(b.booking_date, 'YYYY-MM-DD') AS booking_date,
  to_char(b.slot_time, 'HH24:MI') AS slot_time, b.customer_notes, b.staff_note, b.created_at, b.reviewed_at,
  st.name AS service, st.default_minutes, v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.photo_key`;

type BookingRow = Record<string, unknown> & { vehicle_id: number; photo_key: string | null };

export const toBooking = (r: BookingRow, photoBase = '/api/my/vehicles') => ({
  bookingId: r.booking_id as number,
  bookingNo: r.booking_no as string,
  status: r.status as string,
  date: r.booking_date as string,
  time: r.slot_time as string,
  service: r.service as string,
  minutes: r.default_minutes as number,
  notes: r.customer_notes as string | null,
  staffNote: r.staff_note as string | null,
  createdAt: r.created_at,
  reviewedAt: r.reviewed_at,
  vehicle: {
    vehicleId: r.vehicle_id,
    registrationNo: r.registration_no as string,
    description: `${r.make} ${r.model}${r.year ? ` · ${r.year}` : ''}`,
    photoUrl: photoUrl(`${photoBase}/${r.vehicle_id}/photo`, r.photo_key),
  },
});

/**
 * Customer bookings (/api/my/bookings). A customer books one of their approved vehicles for a service on a day and
 * time from bookings.rules; staff then confirm or decline it (bookings.routes.ts). Every query is filtered by the
 * signed-in customer's id.
 */
export function myBookingsRoutes(pool: pg.Pool) {
  const router = Router();
  router.use(requireCustomer('MY_BOOKINGS'));

  /** Bookings still to come, and earlier or closed ones. */
  router.get('/', async (req, res) => {
    const me = signedInUser(req).customerId!;
    const today = nowInZone(await centreTimeZone(pool)).date;
    const { rows } = await pool.query(
      `SELECT ${BOOKING_COLUMNS}
       FROM workshop.bookings b
       JOIN workshop.service_types st ON st.service_type_id = b.service_type_id
       JOIN workshop.vehicles v ON v.vehicle_id = b.vehicle_id
       WHERE b.customer_id = $1
       ORDER BY b.booking_date DESC, b.slot_time DESC LIMIT 60`,
      [me],
    );
    const all = rows.map((r) => toBooking(r));
    const open = (b: (typeof all)[number]) => (b.status === 'pending' || b.status === 'confirmed') && b.date >= today;
    sendOk(res, { upcoming: all.filter(open).reverse(), past: all.filter((b) => !open(b)) });
  });

  /** What the booking form offers: my vehicles, the services, and each day's times with the places left. */
  router.get('/options', async (req, res) => {
    const me = signedInUser(req).customerId!;
    const rules = await getBookingRules(pool);
    const now = nowInZone(await centreTimeZone(pool));
    const [vehicles, services, taken] = await Promise.all([
      pool.query(
        `SELECT v.vehicle_id, v.registration_no, v.make, v.model, v.year, v.photo_key
         FROM workshop.vehicle_claims vc JOIN workshop.vehicles v ON v.vehicle_id = vc.vehicle_id
         WHERE vc.customer_id = $1 AND vc.status = 'approved' ORDER BY v.registration_no`,
        [me],
      ),
      pool.query('SELECT service_type_id, code, name, default_minutes FROM workshop.service_types WHERE is_active ORDER BY name'),
      pool.query<{ day: string; time: string; n: string }>(
        `SELECT to_char(booking_date, 'YYYY-MM-DD') AS day, to_char(slot_time, 'HH24:MI') AS time, count(*) AS n
         FROM workshop.bookings WHERE status IN ('pending', 'confirmed') AND booking_date >= $1::date
         GROUP BY booking_date, slot_time`,
        [now.date],
      ),
    ]);
    sendOk(res, {
      vehicles: vehicles.rows.map((v) => ({
        vehicleId: v.vehicle_id,
        registrationNo: v.registration_no,
        description: `${v.make} ${v.model}${v.year ? ` · ${v.year}` : ''}`,
        photoUrl: photoUrl(`/api/my/vehicles/${v.vehicle_id}/photo`, v.photo_key),
      })),
      services: services.rows.map((s) => ({ serviceTypeId: s.service_type_id, code: s.code, name: s.name, minutes: s.default_minutes })),
      days: bookableDays(rules, now, new Map(taken.rows.map((t) => [`${t.day} ${t.time}`, Number(t.n)]))),
      minHoursAhead: rules.minHoursAhead,
    });
  });

  router.post('/', async (req, res) => {
    const user = signedInUser(req);
    const body = parse(newBooking, req.body);
    const rules = await getBookingRules(pool);
    const now = nowInZone(await centreTimeZone(pool));
    const problem = bookingProblem(rules, now, body.date, body.time);
    if (problem) throw new ValidationError(problem, [{ field: 'time', message: problem }]);

    const created = await withTransaction(pool, async (client) => {
      const vehicle = await client.query(
        `SELECT 1 FROM workshop.vehicle_claims WHERE customer_id = $1 AND vehicle_id = $2 AND status = 'approved'`,
        [user.customerId, body.vehicleId],
      );
      if (!vehicle.rows[0]) throw new NotFoundError('This vehicle is not in your list.');
      const service = await client.query('SELECT 1 FROM workshop.service_types WHERE service_type_id = $1 AND is_active', [body.serviceTypeId]);
      if (!service.rows[0]) throw new ValidationError('Choose one of the services shown.', [{ field: 'serviceTypeId', message: 'Choose one of the services shown.' }]);

      // One booking at a time per day and time, so two customers can't both take the last place
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`booking ${body.date} ${body.time}`]);
      const taken = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM workshop.bookings WHERE booking_date = $1 AND slot_time = $2 AND status IN ('pending', 'confirmed')`,
        [body.date, body.time],
      );
      if (Number(taken.rows[0]!.n) >= rules.perSlot) {
        throw new BusinessRuleError('SLOT_FULL', 'That time has just been taken. Choose another time.');
      }
      try {
        const { rows } = await client.query<{ booking_id: number; booking_no: string }>(
          `INSERT INTO workshop.bookings (customer_id, vehicle_id, service_type_id, booking_date, slot_time, customer_notes)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING booking_id, booking_no`,
          [user.customerId, body.vehicleId, body.serviceTypeId, body.date, body.time, body.notes],
        );
        const b = rows[0]!;
        await audit(client, { table: 'workshop.bookings', recordId: b.booking_id, action: 'booked', userId: user.userId, snapshot: { ...body } });
        return b;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('ALREADY_BOOKED', 'This vehicle is already booked that day. Change or cancel that booking first.');
        }
        throw err;
      }
    });
    sendOk(res, { bookingId: created.booking_id, bookingNo: created.booking_no, status: 'pending' }, 201);
  });

  /** Cancel one of my bookings that is still to come. */
  router.post('/:id/cancel', async (req, res) => {
    const user = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const today = nowInZone(await centreTimeZone(pool)).date;
    const { rows } = await pool.query(
      `UPDATE workshop.bookings SET status = 'cancelled', cancelled_at = now()
       WHERE booking_id = $1 AND customer_id = $2 AND status IN ('pending', 'confirmed') AND booking_date >= $3::date
       RETURNING booking_no`,
      [id, user.customerId, today],
    );
    if (!rows[0]) throw new NotFoundError('There is no upcoming booking with this number.');
    await audit(pool, { table: 'workshop.bookings', recordId: id, action: 'cancelled', userId: user.userId });
    sendOk(res, { bookingId: id, status: 'cancelled' });
  });

  return router;
}
