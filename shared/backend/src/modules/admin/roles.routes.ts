import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import {
  createRole,
  getRole,
  listPermissions,
  listRoles,
  roleNameTaken,
  setPermissions,
  setRoleActive,
  updateRole,
} from './roles.repository.js';

const roleBody = z.object({
  name: z.string().trim().min(2, 'Enter a role name.').max(100),
  description: z.string().trim().max(500).default(''),
});
const statusBody = z.object({ active: z.boolean() });
const permissionsBody = z.object({ codes: z.array(z.string().max(50)).max(200) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Administration › Roles (ROLES) and Role permissions (ROLE_PERMISSIONS).
 * New roles are staff roles; the shipped Customer role is the only customer role.
 */
export function rolesRoutes(pool: pg.Pool) {
  const router = Router();

  async function existing(id: number) {
    const role = await getRole(pool, id);
    if (!role) throw new NotFoundError('This role does not exist.');
    return role;
  }

  router.get('/', requireScreen('ROLES', 'ROLE_PERMISSIONS', 'USERS'), async (_req, res) => {
    sendOk(res, await listRoles(pool));
  });

  router.post('/', requireScreen('ROLES'), async (req, res) => {
    const me = signedInUser(req);
    const body = parse(roleBody, req.body);
    if (await roleNameTaken(pool, body.name)) throw new ConflictError('ROLE_NAME_TAKEN', `A role called "${body.name}" already exists.`);
    const id = await createRole(pool, body.name, body.description);
    await audit(pool, { table: 'app.roles', recordId: id, action: 'created', userId: me.userId, snapshot: body });
    sendOk(res, await getRole(pool, id), 201);
  });

  router.put('/:id', requireScreen('ROLES'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const role = await existing(id);
    const body = parse(roleBody, req.body);
    if (role.isSystem && body.name !== role.name) throw new BusinessRuleError('SYSTEM_ROLE', 'Shipped roles keep their name; you can change the description.');
    if (await roleNameTaken(pool, body.name, id)) throw new ConflictError('ROLE_NAME_TAKEN', `A role called "${body.name}" already exists.`);
    await updateRole(pool, id, body.name, body.description);
    await audit(pool, { table: 'app.roles', recordId: id, action: 'updated', userId: me.userId, snapshot: body });
    sendOk(res, await getRole(pool, id));
  });

  router.post('/:id/status', requireScreen('ROLES'), async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { active } = parse(statusBody, req.body);
    const role = await existing(id);
    if (!active && role.isSystem) throw new BusinessRuleError('SYSTEM_ROLE', 'Shipped roles cannot be switched off.');
    if (!active && role.userCount > 0) {
      throw new BusinessRuleError('ROLE_IN_USE', `${role.userCount} user(s) have this role. Move them to another role first.`);
    }
    await setRoleActive(pool, id, active);
    await audit(pool, { table: 'app.roles', recordId: id, action: active ? 'activated' : 'deactivated', userId: me.userId });
    sendOk(res, await getRole(pool, id));
  });

  router.get('/:id/permissions', requireScreen('ROLE_PERMISSIONS'), async (req, res) => {
    const role = await existing(parse(idParam, req.params).id);
    sendOk(res, { role, permissions: await listPermissions(pool, role.roleId, role.audience) });
  });

  router.put('/:id/permissions', requireScreen('ROLE_PERMISSIONS'), async (req, res) => {
    const me = signedInUser(req);
    const role = await existing(parse(idParam, req.params).id);
    const { codes } = parse(permissionsBody, req.body);

    const allowed = new Set((await listPermissions(pool, role.roleId, role.audience)).map((p) => p.code));
    const unknown = codes.filter((c) => !allowed.has(c));
    if (unknown.length) throw new ValidationError(`These can't be given to a ${role.audience} role: ${unknown.join(', ')}.`);
    if (role.roleId === me.roleId && !me.isSuperAdmin && !codes.includes('ROLE_PERMISSIONS')) {
      throw new BusinessRuleError('OWN_ROLE', "You can't remove Role permissions from your own role: you would lock yourself out.");
    }

    await withTransaction(pool, async (client) => {
      await setPermissions(client, role.roleId, role.audience, codes);
      await audit(client, { table: 'app.role_screens', recordId: role.roleId, action: 'permissions_changed', userId: me.userId, snapshot: { role: role.name, granted: [...codes].sort() } });
    });
    sendOk(res, { role: await getRole(pool, role.roleId), permissions: await listPermissions(pool, role.roleId, role.audience) });
  });

  return router;
}
