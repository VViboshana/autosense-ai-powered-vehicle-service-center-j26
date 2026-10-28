import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { sendOk } from '../../http/envelope.js';
import { pageQuery } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import { arrivalsFor, findVehicles, JOB_STAGES, listJobs, serviceTypes } from './jobs.repository.js';
import { centreToday, changeStage, checkIn, type JobAction } from './jobs.service.js';
import { freeBaysForJobs } from '../occupancy/occupancy.repository.js';
import { confirmJobInBay } from '../occupancy/occupancy.service.js';

const listQuery = pageQuery.extend({
  scope: z.enum(['today', 'open']).default('today'),
  search: z.string().trim().max(60).optional().transform((s) => s || undefined),
  stage: z.enum(JOB_STAGES).optional(),
});
const notes = z.string().trim().max(500).optional().transform((s) => s || null);
export const checkInBody = z.union([
  z.object({ bookingId: z.number().int().positive(), serviceTypeId: z.number().int().positive().optional(), customerNotes: notes }),
  z.object({
    vehicleId: z.number({ error: 'Pick the vehicle.' }).int().positive(),
    serviceTypeId: z.number({ error: 'Pick the service.' }).int().positive(),
    customerNotes: notes,
  }),
]);
const vehicleQuery = z.object({ search: z.string().trim().min(2, 'Type at least 2 characters.').max(60) });
const idParam = z.object({ id: z.coerce.number().int().positive() });
const intoBayBody = z.object({ bayId: z.number({ error: 'Pick the bay.' }).int().positive() });
export const actionBody = z.object({
  note: z.string().trim().max(200).optional().transform((s) => s || null),
  anyway: z.boolean().optional(),
});

/**
 * Service floor › Vehicles & jobs: today's arrivals, check-in (from a booking or as a walk-in) and the stage actions.
 *
 *   GET  /api/jobs?scope=today|open&search=&stage=&page=&pageSize=   job list
 *   GET  /api/jobs/arrivals                     today's bookings not checked in yet          (JOB_CHECK_IN)
 *   GET  /api/jobs/vehicles?search=             vehicles on record, for a walk-in            (JOB_CHECK_IN)
 *   GET  /api/jobs/service-types                                                             (JOB_CHECK_IN)
 *   POST /api/jobs/check-in                     { bookingId } or { vehicleId, serviceTypeId }  (JOB_CHECK_IN)
 *   GET  /api/jobs/free-bays                    bays a waiting job can be moved into by hand (BAY_JOB_CONFIRM)
 *   POST /api/jobs/:id/move-into-bay            { bayId } waiting -> in a bay, without a camera (BAY_JOB_CONFIRM)
 *   POST /api/jobs/:id/send-to-inspection       in a bay -> damage inspection                (BAY_JOB_CONFIRM)
 *   POST /api/jobs/:id/back-to-queue            in a bay -> waiting again (wrong vehicle)    (BAY_JOB_CONFIRM)
 *   POST /api/jobs/:id/work-done                in a bay -> ready ({ anyway } skips the inspection warning)
 *                                                                              (BAY_JOB_CONFIRM or INSPECTION_CONFIRM)
 *   POST /api/jobs/:id/collected                ready -> completed                           (JOB_CHECK_IN)
 *   POST /api/jobs/:id/cancel                   { note } any open stage -> cancelled         (JOB_CHECK_IN)
 */
export function jobsRoutes(pool: pg.Pool) {
  const router = Router();

  router.get('/', requireScreen('JOBS', 'DASHBOARD'), async (req, res) => {
    sendOk(res, await listJobs(pool, parse(listQuery, req.query)));
  });

  router.get('/arrivals', requireScreen('JOB_CHECK_IN'), async (_req, res) => {
    const today = await centreToday(pool);
    sendOk(res, { today, arrivals: await arrivalsFor(pool, today) });
  });

  router.get('/vehicles', requireScreen('JOB_CHECK_IN'), async (req, res) => {
    sendOk(res, await findVehicles(pool, parse(vehicleQuery, req.query).search));
  });

  router.get('/service-types', requireScreen('JOB_CHECK_IN'), async (_req, res) => {
    sendOk(res, await serviceTypes(pool));
  });

  router.post('/check-in', requireScreen('JOB_CHECK_IN'), async (req, res) => {
    const me = signedInUser(req);
    sendOk(res, await checkIn(pool, parse(checkInBody, req.body), me.userId), 201);
  });

  // Without a camera (switched off, or no occupancy service running): staff put the vehicle in a bay themselves
  router.get('/free-bays', requireScreen('BAY_JOB_CONFIRM'), async (_req, res) => {
    sendOk(res, await freeBaysForJobs(pool));
  });

  router.post('/:id/move-into-bay', requireScreen('BAY_JOB_CONFIRM'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { bayId } = parse(intoBayBody, req.body ?? {});
    await confirmJobInBay(pool, { jobId: id, bayId, userId: me.userId, manual: true });
    sendOk(res, { jobId: id, stage: 'in_bay' });
  });

  const action = (name: JobAction, ...codes: [string, ...string[]]) =>
    router.post(`/:id/${name.replace(/_/g, '-')}`, requireScreen(...codes), async (req, res) => {
      const me = signedInUser(req);
      const { id } = parse(idParam, req.params);
      const body = parse(actionBody, req.body ?? {});
      sendOk(res, await changeStage(pool, { jobId: id, action: name, note: body.note, anyway: body.anyway, userId: me.userId }));
    });
  action('send_to_inspection', 'BAY_JOB_CONFIRM');
  action('back_to_queue', 'BAY_JOB_CONFIRM');
  action('work_done', 'BAY_JOB_CONFIRM', 'INSPECTION_CONFIRM');
  action('collected', 'JOB_CHECK_IN');
  action('cancel', 'JOB_CHECK_IN');

  return router;
}
