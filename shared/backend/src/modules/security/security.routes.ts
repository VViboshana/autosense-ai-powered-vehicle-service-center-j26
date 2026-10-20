import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { BusinessRuleError, NotFoundError } from '../../http/errors.js';
import { pageQuery } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import {
  acknowledgeAlert,
  addAction,
  getAlert,
  listAlerts,
  listCameras,
  lockAlert,
  resolveAlert,
  securityRules,
  securitySummary,
} from './security.repository.js';
import { actionProblem, RECORDED_ACTIONS, RESOLUTIONS, SEVERITIES, THREAT_TYPES } from './security.rules.js';

const blankToUndefined = (v: unknown) => (v === '' || v == null ? undefined : v);
const listQuery = pageQuery.extend({
  view: z.enum(['active', 'resolved', 'all']).default('active'),
  severity: z.preprocess(blankToUndefined, z.enum(SEVERITIES).optional()),
  threat: z.preprocess(blankToUndefined, z.enum(THREAT_TYPES).optional()),
  cameraId: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  search: z.string().trim().max(60).optional().transform((s) => s || undefined),
});
const idParam = z.object({ id: z.coerce.number().int().positive() });
const note = z.string().trim().max(500).optional().transform((s) => s || null);
const resolveBody = z
  .object({ resolution: z.enum(RESOLUTIONS), note })
  .refine((b) => b.resolution !== 'false_alarm' || b.note, { message: 'Say why this is a false alarm.', path: ['note'] });
const actionBody = z
  .object({ action: z.enum(RECORDED_ACTIONS), note })
  .refine((b) => b.action !== 'note' || b.note, { message: 'Write the note.', path: ['note'] });

/**
 * Vehicle security and safety alerts (component 4). The security service raises alerts; a guard or supervisor
 * acknowledges each one, records what was done (emergency services called, owner informed, notes) and resolves it
 * as handled or as a false alarm. The AI flags; a person decides.
 *
 *   GET  /api/security/summary                          figures for the Alerts screen
 *   GET  /api/security/alerts?view=&severity=&threat=&cameraId=&search=&page=&pageSize=
 *   GET  /api/security/alerts/:id                       detail with detections and timeline
 *   POST /api/security/alerts/:id/acknowledge
 *   POST /api/security/alerts/:id/resolve               { resolution: handled | false_alarm, note }
 *   POST /api/security/alerts/:id/actions               { action: emergency_called | owner_informed | note, note }
 *   GET  /api/security/cameras                          security cameras with their alert counts
 *   GET  /api/security/rules                            threat catalogue, zones, thresholds, notification matrix
 */
export function securityRoutes(pool: pg.Pool) {
  const router = Router();

  router.get('/summary', requireScreen('SAFETY_ALERTS'), async (_req, res) => {
    sendOk(res, await securitySummary(pool));
  });

  router.get('/alerts', requireScreen('SAFETY_ALERTS', 'CAMERAS'), async (req, res) => {
    sendOk(res, await listAlerts(pool, parse(listQuery, req.query)));
  });

  router.get('/alerts/:id', requireScreen('SAFETY_ALERTS'), async (req, res) => {
    const { id } = parse(idParam, req.params);
    const alert = await getAlert(pool, id);
    if (!alert) throw new NotFoundError('Alert not found.');
    sendOk(res, alert);
  });

  /** Runs one change on a locked alert, checks it is allowed, and audits it. */
  async function change(id: number, action: Parameters<typeof actionProblem>[0], userId: number, fn: (client: pg.PoolClient) => Promise<void>, snapshot: Record<string, unknown> = {}) {
    await withTransaction(pool, async (client) => {
      const alert = await lockAlert(client, id);
      if (!alert) throw new NotFoundError('Alert not found.');
      const problem = actionProblem(action, alert);
      if (problem) throw new BusinessRuleError('ALERT_ACTION_NOT_ALLOWED', problem);
      await fn(client);
      await audit(client, { table: 'security.alerts', recordId: id, action, userId, snapshot: { alertNo: alert.alertNo, ...snapshot } });
    });
  }

  router.post('/alerts/:id/acknowledge', requireScreen('SAFETY_ALERT_ACK'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    await change(id, 'acknowledge', me.userId, async (client) => {
      await acknowledgeAlert(client, id, me.userId);
      await addAction(client, id, 'acknowledged', null, me.userId);
    });
    sendOk(res, await getAlert(pool, id));
  });

  router.post('/alerts/:id/resolve', requireScreen('SAFETY_ALERT_ACK'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(resolveBody, req.body);
    await change(
      id,
      'resolve',
      me.userId,
      async (client) => {
        await resolveAlert(client, id, body.resolution, body.note, me.userId);
        await addAction(client, id, body.resolution === 'false_alarm' ? 'false_alarm' : 'resolved', body.note, me.userId);
      },
      body,
    );
    sendOk(res, await getAlert(pool, id));
  });

  router.post('/alerts/:id/actions', requireScreen('SAFETY_ALERT_ACK'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const body = parse(actionBody, req.body);
    await change(id, body.action, me.userId, (client) => addAction(client, id, body.action, body.note, me.userId), body);
    sendOk(res, await getAlert(pool, id));
  });

  router.get('/cameras', requireScreen('CAMERAS'), async (_req, res) => {
    sendOk(res, await listCameras(pool));
  });

  router.get('/rules', requireScreen('ALERT_RULES', 'SAFETY_ALERTS'), async (_req, res) => {
    sendOk(res, await securityRules(pool));
  });

  return router;
}
