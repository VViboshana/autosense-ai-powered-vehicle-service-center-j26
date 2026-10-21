import { Router } from 'express';
import type { Env } from '../../config/env.js';
import { sendOk } from '../../http/envelope.js';
import { maintenanceDuration, maintenanceHealth, maintenanceModel, maintenanceTasks, predictMaintenance } from '../../integrations/ml/maintenanceService.js';
import { requireScreen } from '../../middleware/requireScreen.js';

export function maintenanceRoutes(env: Env) {
  const router = Router();
  router.use(requireScreen('MAINTENANCE_FORECASTS'));

  router.get('/health', async (_req, res) => {
    const health = await maintenanceHealth(env.MAINTENANCE_ML_SERVICE_URL);
    sendOk(res, { status: health.status, mlService: health }, health.status === 'ok' && health.modelsLoaded ? 200 : 503);
  });

  router.get('/model', async (_req, res) => sendOk(res, await maintenanceModel(env.MAINTENANCE_ML_SERVICE_URL)));
  router.post('/forecasts', async (req, res) => sendOk(res, await predictMaintenance(env.MAINTENANCE_ML_SERVICE_URL, req.body), 201));
  router.get('/tasks/:category', async (req, res) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 8 : Number(rawLimit);
    sendOk(res, await maintenanceTasks(env.MAINTENANCE_ML_SERVICE_URL, req.params.category, limit));
  });
  router.post('/duration', async (req, res) => sendOk(res, await maintenanceDuration(env.MAINTENANCE_ML_SERVICE_URL, req.body)));
  return router;
}
