import type { Db } from '../../db/pool.js';
import type { CurrentUser } from './access.types.js';

type UserRow = {
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
  designation: string | null;
  user_type: 'staff' | 'customer';
  customer_id: number | null;
  role_id: number;
  role_name: string;
  is_super_admin: boolean;
  must_change_password: boolean;
};

/**
 * Loads an active user (status active, role active) with the screens they may use. Returns null otherwise.
 * A user only ever gets screens of their own audience: staff screens for staff, customer screens for customers.
 * Super admins get every staff screen.
 */
export async function loadUser(db: Db, userId: number, sessionId: string): Promise<CurrentUser | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT u.user_id, u.username, u.first_name, u.last_name, u.designation, u.user_type, u.customer_id,
            u.is_super_admin, u.must_change_password, r.role_id, r.name AS role_name
     FROM app.users u
     JOIN app.roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND u.status = 1 AND r.status = 1 AND r.audience = u.user_type`,
    [userId],
  );
  const user = rows[0];
  if (!user) return null;

  const screens = await db.query<{ screen_code: string }>(
    `SELECT s.screen_code
     FROM app.screens s
     WHERE s.is_active AND s.audience = $3
       AND (s.is_public OR $2::boolean OR EXISTS (
             SELECT 1 FROM app.role_screens rs
             WHERE rs.role_id = $1 AND rs.screen_code = s.screen_code AND rs.is_active))`,
    [user.role_id, user.is_super_admin, user.user_type],
  );

  return {
    userId: user.user_id,
    username: user.username,
    displayName: `${user.first_name} ${user.last_name}`.trim(),
    designation: user.designation,
    userType: user.user_type,
    customerId: user.customer_id,
    roleId: user.role_id,
    roleName: user.role_name,
    isSuperAdmin: user.is_super_admin,
    mustChangePassword: user.must_change_password,
    screens: new Set(screens.rows.map((r) => r.screen_code)),
    sessionId,
  };
}
