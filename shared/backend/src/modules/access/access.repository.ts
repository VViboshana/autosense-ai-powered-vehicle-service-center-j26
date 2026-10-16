import type { Db } from '../../db/pool.js';
import type { CurrentUser } from './access.types.js';

type UserRow = {
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
  designation: string | null;
  role_id: number;
  role_name: string;
  is_super_admin: boolean;
  status: number;
  role_status: number;
};

/** Loads an active user with the screens their role grants. Returns null for unknown, locked or inactive users. */
export async function findActiveUser(db: Db, username: string): Promise<CurrentUser | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.user_id, u.username, u.first_name, u.last_name, u.designation, u.is_super_admin, u.status,
            r.role_id, r.name AS role_name, r.status AS role_status
     FROM app.users u
     JOIN app.roles r ON r.role_id = u.role_id
     WHERE lower(u.username) = lower($1)`,
    [username],
  );
  const user = rows[0];
  if (!user || user.status !== 1 || user.role_status !== 1) return null;

  const screens = await db.query<{ screen_code: string }>(
    `SELECT s.screen_code
     FROM app.screens s
     WHERE s.is_active
       AND (s.is_public OR $2::boolean OR EXISTS (
             SELECT 1 FROM app.role_screens rs
             WHERE rs.role_id = $1 AND rs.screen_code = s.screen_code AND rs.is_active))`,
    [user.role_id, user.is_super_admin],
  );

  return {
    userId: user.user_id,
    username: user.username,
    displayName: `${user.first_name} ${user.last_name}`,
    designation: user.designation,
    roleId: user.role_id,
    roleName: user.role_name,
    isSuperAdmin: user.is_super_admin,
    screens: new Set(screens.rows.map((r) => r.screen_code)),
  };
}
