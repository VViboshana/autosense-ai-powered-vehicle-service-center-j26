import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { requireScreen } from '../../middleware/requireScreen.js';
import { getActions, getBayBoard, getSummary } from './dashboard.repository.js';

/**
 * The home dashboard: key figures, the bay board and the "needs your action" queues.
 * Safety alerts and maintenance suggestions report connected: false until those components are plugged in.
 */
export function dashboardRoutes(db: Db) {
  const router = Router();
  router.use(requireScreen('DASHBOARD'));

  router.get('/summary', async (_req, res) => {
    sendOk(res, { ...(await getSummary(db)), safety: { connected: false, openAlerts: 0 } });
  });

  router.get('/bays', async (_req, res) => {
    sendOk(res, await getBayBoard(db));
  });

  router.get('/actions', async (_req, res) => {
    sendOk(res, await getActions(db));
  });

  return router;
}
