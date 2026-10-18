import { Router } from 'express';
import type { Env } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { checkMlService } from '../../integrations/ml/mlServices.js';
import { needsSetup } from '../admin/users.repository.js';
import { APP_VERSION } from '../../version.js';

/**
 * GET /api/health      is everything running? (no sign-in needed; used by the team and by hosting)
 * GET /api/app-config  name, version and public settings for the browser (no secrets)
 */
export function systemRoutes(db: Db, env: Env) {
  const router = Router();

  router.get('/health', async (_req, res) => {
    const started = performance.now();
    const database = await db
      .query('SELECT 1')
      .then(() => ({ status: 'up' as const, latencyMs: Math.round(performance.now() - started) }))
      .catch((err: unknown) => ({ status: 'down' as const, error: err instanceof Error ? err.message : String(err) }));
    const [damageService, occupancyService] = await Promise.all([
      checkMlService(env.ML_DAMAGE_URL),
      checkMlService(env.ML_OCCUPANCY_URL),
    ]);

    const status = database.status === 'up' ? 'ok' : 'down';
    sendOk(res, {
      status,
      version: APP_VERSION,
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database, damageService, occupancyService },
    }, status === 'ok' ? 200 : 503);
  });

  router.get('/app-config', async (_req, res) => {
    const { rows } = await db.query<{ setting_key: string; value: unknown }>(
      'SELECT setting_key, value FROM app.settings WHERE is_public ORDER BY setting_key',
    );
    sendOk(res, {
      appName: 'AutoSense',
      version: APP_VERSION,
      environment: env.NODE_ENV,
      // No staff account yet: the web app shows "Create the administrator" instead of sign-in
      setup: { needed: await needsSetup(db), keyRequired: Boolean(env.SETUP_KEY) },
      settings: Object.fromEntries(rows.map((r) => [r.setting_key, r.value])),
    });
  });

  return router;
}
