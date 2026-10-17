import type { Db } from '../db/pool.js';

/**
 * Records who did what in app.audit_log. Call it in the same transaction as the change it describes.
 * Never put passwords or password hashes in the snapshot.
 */
export async function audit(
  db: Db,
  entry: { table: string; recordId: string | number; action: string; snapshot?: Record<string, unknown>; userId: number | null },
) {
  await db.query(
    'INSERT INTO app.audit_log (table_name, record_id, action, snapshot, user_id) VALUES ($1, $2, $3, $4, $5)',
    [entry.table, String(entry.recordId), entry.action, JSON.stringify(entry.snapshot ?? {}), entry.userId],
  );
}
