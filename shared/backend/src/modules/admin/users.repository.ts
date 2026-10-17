import type pg from 'pg';
import type { Db } from '../../db/pool.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../http/pagination.js';
import { hashPassword } from '../../lib/password.js';

export type UserStatus = 'active' | 'locked' | 'inactive';
const STATUS: Record<number, UserStatus> = { 1: 'active', 2: 'locked', 3: 'inactive' };
export const STATUS_CODE: Record<UserStatus, number> = { active: 1, locked: 2, inactive: 3 };

export type UserListItem = {
  userId: number;
  username: string;
  displayName: string;
  userType: 'staff' | 'customer';
  designation: string | null;
  roleId: number;
  roleName: string;
  status: UserStatus;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
};

export type UserDetail = UserListItem & {
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
  employeeNo: string | null;
  failedAttempts: number;
  createdAt: string;
};

const SELECT = `
  SELECT u.user_id, u.username, u.first_name, u.last_name, u.user_type, u.designation, u.email, u.mobile, u.employee_no,
         u.role_id, r.name AS role_name, u.status, u.is_super_admin, u.last_login_at, u.failed_attempts, u.created_at
  FROM app.users u JOIN app.roles r ON r.role_id = u.role_id`;

function toDetail(r: pg.QueryResultRow): UserDetail {
  return {
    userId: r.user_id,
    username: r.username,
    displayName: `${r.first_name} ${r.last_name}`.trim(),
    firstName: r.first_name,
    lastName: r.last_name,
    userType: r.user_type,
    designation: r.designation,
    email: r.email,
    mobile: r.mobile,
    employeeNo: r.employee_no,
    roleId: r.role_id,
    roleName: r.role_name,
    status: STATUS[r.status] ?? 'inactive',
    isSuperAdmin: r.is_super_admin,
    lastLoginAt: r.last_login_at,
    failedAttempts: r.failed_attempts,
    createdAt: r.created_at,
  };
}

export async function listUsers(
  db: Db,
  f: PageRequest & { search?: string; userType?: 'staff' | 'customer'; status?: UserStatus; roleId?: number },
): Promise<Page<UserListItem>> {
  const where: string[] = ['true'];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (f.search) add(`(u.username ILIKE ? OR (u.first_name || ' ' || u.last_name) ILIKE ? OR u.email ILIKE ?)`, `%${f.search}%`);
  if (f.userType) add('u.user_type = ?', f.userType);
  if (f.status) add('u.status = ?', STATUS_CODE[f.status]);
  if (f.roleId) add('u.role_id = ?', f.roleId);

  const total = await db.query(`SELECT count(*) AS n FROM app.users u WHERE ${where.join(' AND ')}`, params);
  const rows = await db.query(
    `${SELECT} WHERE ${where.join(' AND ')}
     ORDER BY u.user_type DESC, lower(u.first_name), lower(u.last_name), u.user_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, offsetOf(f)],
  );
  return toPage(
    rows.rows.map((r) => {
      const d = toDetail(r);
      return {
        userId: d.userId, username: d.username, displayName: d.displayName, userType: d.userType, designation: d.designation,
        roleId: d.roleId, roleName: d.roleName, status: d.status, isSuperAdmin: d.isSuperAdmin, lastLoginAt: d.lastLoginAt,
      };
    }),
    total.rows[0].n,
    f,
  );
}

export async function getUser(db: Db, userId: number): Promise<UserDetail | null> {
  const { rows } = await db.query(`${SELECT} WHERE u.user_id = $1`, [userId]);
  return rows[0] ? toDetail(rows[0]) : null;
}

/** The role, if it is active and meant for this kind of user. */
export async function findAssignableRole(db: Db, roleId: number, audience: 'staff' | 'customer') {
  const { rows } = await db.query<{ role_id: number; name: string }>(
    'SELECT role_id, name FROM app.roles WHERE role_id = $1 AND status = 1 AND audience = $2',
    [roleId, audience],
  );
  return rows[0] ?? null;
}

export async function usernameTaken(db: Db, username: string, exceptUserId?: number) {
  const { rowCount } = await db.query('SELECT 1 FROM app.users WHERE lower(username) = lower($1) AND user_id <> $2', [
    username,
    exceptUserId ?? 0,
  ]);
  return (rowCount ?? 0) > 0;
}

export type StaffInput = {
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
  employeeNo: string | null;
  designation: string | null;
  roleId: number;
};

export async function createStaffUser(client: pg.PoolClient, input: StaffInput, password: string, superAdmin = false): Promise<number> {
  const { rows } = await client.query<{ user_id: number }>(
    `INSERT INTO app.users (username, password_hash, first_name, last_name, email, mobile, employee_no, designation, role_id,
                            user_type, is_super_admin, must_change_password)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'staff', $10, false)
     RETURNING user_id`,
    [input.username, await hashPassword(password), input.firstName, input.lastName, input.email, input.mobile,
     input.employeeNo, input.designation, input.roleId, superAdmin],
  );
  return rows[0]!.user_id;
}

/** True until the first staff account exists: the web app then shows the first-run setup page instead of sign-in. */
export async function needsSetup(db: Db): Promise<boolean> {
  const { rows } = await db.query<{ needs: boolean }>("SELECT NOT EXISTS (SELECT 1 FROM app.users WHERE user_type = 'staff') AS needs");
  return rows[0]?.needs ?? false;
}

export async function updateUser(db: Db, userId: number, input: Omit<StaffInput, 'username'>) {
  await db.query(
    `UPDATE app.users SET first_name = $2, last_name = $3, email = $4, mobile = $5, employee_no = $6, designation = $7,
                          role_id = $8, updated_at = now()
     WHERE user_id = $1`,
    [userId, input.firstName, input.lastName, input.email, input.mobile, input.employeeNo, input.designation, input.roleId],
  );
}

export async function setUserStatus(db: Db, userId: number, status: UserStatus) {
  await db.query('UPDATE app.users SET status = $2, failed_attempts = 0, updated_at = now() WHERE user_id = $1', [
    userId,
    STATUS_CODE[status],
  ]);
}
