import type pg from 'pg';
import type { Db } from '../../db/pool.js';

export type RoleItem = {
  roleId: number;
  name: string;
  description: string;
  audience: 'staff' | 'customer';
  isSystem: boolean;
  active: boolean;
  userCount: number;
  grantCount: number;
};

export async function listRoles(db: Db): Promise<RoleItem[]> {
  const { rows } = await db.query(
    `SELECT r.role_id, r.name, r.description, r.audience, r.is_system, r.status,
            (SELECT count(*) FROM app.users u WHERE u.role_id = r.role_id AND u.status <> 3) AS user_count,
            (SELECT count(*) FROM app.role_screens rs JOIN app.screens s USING (screen_code)
              WHERE rs.role_id = r.role_id AND rs.is_active AND s.is_active) AS grant_count
     FROM app.roles r
     ORDER BY r.audience DESC, r.is_system DESC, lower(r.name)`,
  );
  return rows.map((r) => ({
    roleId: r.role_id,
    name: r.name,
    description: r.description,
    audience: r.audience,
    isSystem: r.is_system,
    active: r.status === 1,
    userCount: r.user_count,
    grantCount: r.grant_count,
  }));
}

export async function getRole(db: Db, roleId: number): Promise<RoleItem | null> {
  return (await listRoles(db)).find((r) => r.roleId === roleId) ?? null;
}

export async function roleNameTaken(db: Db, name: string, exceptRoleId = 0) {
  const { rowCount } = await db.query('SELECT 1 FROM app.roles WHERE lower(name) = lower($1) AND role_id <> $2', [name, exceptRoleId]);
  return (rowCount ?? 0) > 0;
}

export async function createRole(db: Db, name: string, description: string): Promise<number> {
  const { rows } = await db.query<{ role_id: number }>(
    "INSERT INTO app.roles (name, description, audience) VALUES ($1, $2, 'staff') RETURNING role_id",
    [name, description],
  );
  return rows[0]!.role_id;
}

export async function updateRole(db: Db, roleId: number, name: string, description: string) {
  await db.query('UPDATE app.roles SET name = $2, description = $3, updated_at = now() WHERE role_id = $1', [roleId, name, description]);
}

export async function setRoleActive(db: Db, roleId: number, active: boolean) {
  await db.query('UPDATE app.roles SET status = $2, updated_at = now() WHERE role_id = $1', [roleId, active ? 1 : 2]);
}

export type PermissionItem = {
  code: string;
  name: string;
  feature: 'shared' | 'occupancy' | 'damage' | 'maintenance' | 'security';
  accessLevel: 'use' | 'manage' | 'admin';
  /** screen: has its own page · function: an action inside a screen (e.g. confirm), or a customer tab */
  kind: 'screen' | 'function';
  /** The screen this function belongs with (its menu parent's name), for display. */
  group: string | null;
  granted: boolean;
};

/** Everything a role of this audience can be granted (headers, groups and public screens are not grantable). */
export async function listPermissions(db: Db, roleId: number, audience: 'staff' | 'customer'): Promise<PermissionItem[]> {
  const { rows } = await db.query(
    `SELECT s.screen_code, s.name, s.feature, s.access_level, s.url, p.name AS parent_name,
            COALESCE(rs.is_active, false) AS granted
     FROM app.screens s
     LEFT JOIN app.screens p ON p.screen_code = s.parent_code
     LEFT JOIN app.role_screens rs ON rs.screen_code = s.screen_code AND rs.role_id = $1
     WHERE s.is_active AND s.audience = $2 AND NOT s.is_public AND (s.url IS NOT NULL OR s.show_on_menu = false)
     ORDER BY s.display_order`,
    [roleId, audience],
  );
  return rows.map((r) => ({
    code: r.screen_code,
    name: r.name,
    feature: r.feature,
    accessLevel: r.access_level,
    kind: r.url ? 'screen' : 'function',
    group: r.parent_name,
    granted: r.granted,
  }));
}

/** Makes the role's grants exactly `codes` (others switched off, never deleted). Only codes of the role's audience. */
export async function setPermissions(client: pg.PoolClient, roleId: number, audience: string, codes: string[]) {
  await client.query(
    `INSERT INTO app.role_screens (role_id, screen_code, is_active)
     SELECT $1, s.screen_code, s.screen_code = ANY($3::text[])
     FROM app.screens s
     WHERE s.is_active AND s.audience = $2 AND NOT s.is_public AND (s.url IS NOT NULL OR s.show_on_menu = false)
     ON CONFLICT (role_id, screen_code) DO UPDATE SET is_active = EXCLUDED.is_active`,
    [roleId, audience, codes],
  );
}
