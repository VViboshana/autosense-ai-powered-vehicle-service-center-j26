import type pg from 'pg';
import type { Db } from '../../db/pool.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';

export type LoginRow = {
  user_id: number;
  username: string;
  password_hash: string;
  status: number; // 1 active, 2 locked, 3 inactive
  failed_attempts: number;
  usable: boolean; // role active and of the user's audience
};

export async function findLogin(db: Db, username: string): Promise<LoginRow | null> {
  const { rows } = await db.query<LoginRow>(
    `SELECT u.user_id, u.username, u.password_hash, u.status, u.failed_attempts,
            (r.status = 1 AND r.audience = u.user_type) AS usable
     FROM app.users u JOIN app.roles r ON r.role_id = u.role_id
     WHERE lower(u.username) = lower($1)`,
    [username],
  );
  return rows[0] ?? null;
}

/** Counts a wrong password; locks the account when it reaches the limit. Returns true if it is now locked. */
export async function recordFailedLogin(db: Db, userId: number, maxAttempts: number): Promise<boolean> {
  const { rows } = await db.query<{ status: number }>(
    `UPDATE app.users
     SET failed_attempts = failed_attempts + 1,
         status = CASE WHEN status = 1 AND failed_attempts + 1 >= $2 THEN 2 ELSE status END,
         updated_at = now()
     WHERE user_id = $1
     RETURNING status`,
    [userId, maxAttempts],
  );
  return rows[0]?.status === 2;
}

export async function recordSuccessfulLogin(db: Db, userId: number) {
  await db.query('UPDATE app.users SET failed_attempts = 0, last_login_at = now() WHERE user_id = $1', [userId]);
}

export async function getPasswordHash(db: Db, userId: number): Promise<string | null> {
  const { rows } = await db.query<{ password_hash: string }>('SELECT password_hash FROM app.users WHERE user_id = $1', [userId]);
  return rows[0]?.password_hash ?? null;
}

/** True if the password equals the current one or one of the last `rememberLast` passwords. */
export async function isRecentPassword(db: Db, userId: number, password: string, rememberLast: number): Promise<boolean> {
  const current = await getPasswordHash(db, userId);
  const { rows } = await db.query<{ password_hash: string }>(
    'SELECT password_hash FROM app.password_history WHERE user_id = $1 ORDER BY changed_at DESC LIMIT $2',
    [userId, Math.max(0, rememberLast)],
  );
  for (const hash of [current, ...rows.map((r) => r.password_hash)]) {
    if (hash && (await verifyPassword(password, hash))) return true;
  }
  return false;
}

/** Sets a new password and keeps the old hash in the history (for the "can't reuse" rule). */
export async function setPassword(client: pg.PoolClient, userId: number, password: string, mustChange: boolean) {
  const old = await getPasswordHash(client, userId);
  if (old) await client.query('INSERT INTO app.password_history (user_id, password_hash) VALUES ($1, $2)', [userId, old]);
  await client.query(
    `UPDATE app.users SET password_hash = $2, password_changed_at = now(), must_change_password = $3, updated_at = now()
     WHERE user_id = $1`,
    [userId, await hashPassword(password), mustChange],
  );
}

/**
 * Creates a customer account. If the service centre already has a customer record with this mobile number and no
 * account, the account is attached to it. Vehicles are never visible through that record alone: a customer sees a
 * vehicle only after staff approve their request for it.
 */
export async function createCustomerAccount(
  client: pg.PoolClient,
  input: { firstName: string; lastName: string; mobile: string; email: string | null; password: string },
): Promise<{ userId: number; customerId: number } | 'ACCOUNT_EXISTS'> {
  const taken = await client.query('SELECT 1 FROM app.users WHERE lower(username) = lower($1)', [input.mobile]);
  if (taken.rowCount) return 'ACCOUNT_EXISTS';

  const existing = await client.query<{ customer_id: number; has_account: boolean }>(
    `SELECT c.customer_id, EXISTS (SELECT 1 FROM app.users u WHERE u.customer_id = c.customer_id) AS has_account
     FROM workshop.customers c WHERE c.mobile = $1`,
    [input.mobile],
  );
  let customerId: number;
  if (existing.rows[0]) {
    if (existing.rows[0].has_account) return 'ACCOUNT_EXISTS';
    customerId = existing.rows[0].customer_id;
    await client.query('UPDATE workshop.customers SET email = COALESCE(email, $2) WHERE customer_id = $1', [customerId, input.email]);
  } else {
    const inserted = await client.query<{ customer_id: number }>(
      'INSERT INTO workshop.customers (full_name, mobile, email) VALUES ($1, $2, $3) RETURNING customer_id',
      [`${input.firstName} ${input.lastName}`.trim(), input.mobile, input.email],
    );
    customerId = inserted.rows[0]!.customer_id;
  }

  const user = await client.query<{ user_id: number }>(
    `INSERT INTO app.users (username, password_hash, first_name, last_name, email, mobile, role_id, user_type, customer_id,
                            must_change_password)
     SELECT $1, $2, $3, $4, $5, $1, r.role_id, 'customer', $6, false
     FROM app.roles r WHERE lower(r.name) = 'customer' AND r.audience = 'customer'
     RETURNING user_id`,
    [input.mobile, await hashPassword(input.password), input.firstName, input.lastName, input.email, customerId],
  );
  if (!user.rows[0]) throw new Error('The Customer role is missing. Run npm run db:migrate.');
  return { userId: user.rows[0].user_id, customerId };
}
