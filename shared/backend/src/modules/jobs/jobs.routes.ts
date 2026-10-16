import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { pageQuery } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { requireScreen } from '../../middleware/requireScreen.js';
import { JOB_STAGES, listJobs } from './jobs.repository.js';

const listQuery = pageQuery.extend({
  scope: z.enum(['today', 'open']).default('today'),
  search: z.string().trim().max(60).optional().transform((s) => s || undefined),
  stage: z.enum(JOB_STAGES).optional(),
});

/** GET /api/jobs?scope=today|open&search=&stage=&page=&pageSize= */
export function jobsRoutes(db: Db) {
  const router = Router();

  router.get('/', requireScreen('JOBS', 'DASHBOARD'), async (req, res) => {
    const filter = parse(listQuery, req.query);
    sendOk(res, await listJobs(db, filter));
  });

  return router;
}
