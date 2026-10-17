import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Db } from '../../db/pool.js';

/**
 * Server-side sign-in sessions. The browser keeps a random 256-bit token in an HttpOnly cookie; the database keeps
 * only its SHA-256 hash, so a stolen database copy can't be used to sign in, and any session can be ended at once.
 */
export type SessionRow = { session_id: string; user_id: number; expires_at: Date; last_seen_at: Date };

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Db, userId: number, maxHours: number, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + maxHours * 3_600_000);
  await db.query(
    `INSERT INTO app.user_sessions (session_id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, userId, hashToken(token), expiresAt, ip?.slice(0, 45) ?? null, userAgent?.slice(0, 300) ?? null],
  );
  return { sessionId, token, expiresAt };
}

export async function findOpenSession(db: Db, token: string): Promise<SessionRow | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT session_id, user_id, expires_at, last_seen_at FROM app.user_sessions
     WHERE token_hash = $1 AND ended_at IS NULL`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

export async function touchSession(db: Db, sessionId: string) {
  await db.query('UPDATE app.user_sessions SET last_seen_at = now() WHERE session_id = $1', [sessionId]);
}

export async function endSession(db: Db, sessionId: string, reason: string) {
  await db.query(
    'UPDATE app.user_sessions SET ended_at = now(), end_reason = $2 WHERE session_id = $1 AND ended_at IS NULL',
    [sessionId, reason],
  );
}

/** Signs a user out everywhere (e.g. password changed, account deactivated), optionally keeping one session. */
export async function endUserSessions(db: Db, userId: number, reason: string, keepSessionId?: string) {
  await db.query(
    `UPDATE app.user_sessions SET ended_at = now(), end_reason = $2
     WHERE user_id = $1 AND ended_at IS NULL AND ($3::uuid IS NULL OR session_id <> $3::uuid)`,
    [userId, reason, keepSessionId ?? null],
  );
}
