import { Router } from 'express';
import type pg from 'pg';
import { sendOk } from '../../http/envelope.js';
import { requireCustomer, signedInUser } from '../../middleware/requireScreen.js';
import { myVisits, serviceCentreBays } from './occupancy.repository.js';

/**
 * GET /api/my/service-centre (customers, MY_VEHICLE_STATUS): the service bays now, occupied or free, from the camera,
 * and where the customer's own vehicles are (from their confirmed jobs, never from the camera directly: the camera
 * cannot tell whose car it sees). For the "Service centre now" panel on the customer's home page.
 */
export function myServiceCentreRoutes(pool: pg.Pool) {
  const router = Router();
  router.get('/', requireCustomer('MY_VEHICLE_STATUS'), async (req, res) => {
    const me = signedInUser(req).customerId!;
    const [centre, mine] = await Promise.all([serviceCentreBays(pool), myVisits(pool, me)]);
    sendOk(res, { ...centre, mine, at: new Date().toISOString() });
  });
  return router;
}
