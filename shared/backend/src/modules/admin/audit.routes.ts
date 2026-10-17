import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { offsetOf, pageQuery, toPage } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { requireScreen } from '../../middleware/requireScreen.js';

const query = pageQuery.extend({
  search: z.string().trim().max(60).optional().transform((s) => s || undefined),
  userId: z.coerce.number().int().positive().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Administration › Audit log (AUDIT_LOG): who did what, newest first. Dates are days in the centre's time zone. */
export function auditRoutes(db: Db) {
  const router = Router();

  router.get('/', requireScreen('AUDIT_LOG'), async (req, res) => {
    const f = parse(query, req.query);
    const where: string[] = ['true'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (f.search) add('(a.action ILIKE ? OR a.table_name ILIKE ? OR a.record_id = ?)', f.search.includes('%') ? f.search : `%${f.search}%`);
    if (f.userId) add('a.user_id = ?', f.userId);
    const tz = `COALESCE((SELECT value #>> '{}' FROM app.settings WHERE setting_key = 'app.timezone'), 'Asia/Colombo')`;
    if (f.from) add(`a.at >= (?::date)::timestamp AT TIME ZONE ${tz}`, f.from);
    if (f.to) add(`a.at < ((?::date) + 1)::timestamp AT TIME ZONE ${tz}`, f.to);

    const total = await db.query(`SELECT count(*) AS n FROM app.audit_log a WHERE ${where.join(' AND ')}`, params);
    const rows = await db.query(
      `SELECT a.audit_id, a.at, a.table_name, a.record_id, a.action, a.snapshot, a.user_id,
              u.first_name || ' ' || u.last_name AS user_name, u.username,
              t.first_name || ' ' || t.last_name AS target_name
       FROM app.audit_log a
       LEFT JOIN app.users u ON u.user_id = a.user_id
       LEFT JOIN app.users t ON a.table_name = 'app.users' AND t.user_id::text = a.record_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.at DESC, a.audit_id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, f.pageSize, offsetOf(f)],
    );
    sendOk(
      res,
      toPage(
        rows.rows.map((r) => ({
          auditId: r.audit_id,
          at: r.at,
          table: r.table_name,
          recordId: r.record_id,
          target: r.target_name,
          action: r.action,
          snapshot: r.snapshot,
          user: r.user_id ? { userId: r.user_id, name: r.user_name, username: r.username } : null,
        })),
        total.rows[0].n,
        f,
      ),
    );
  });

  return router;
}
