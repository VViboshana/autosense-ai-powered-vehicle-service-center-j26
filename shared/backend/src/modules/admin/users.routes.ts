import { Router } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.js';
import { pageQuery } from '../../http/pagination.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { DEFAULT_PASSWORD_POLICY, passwordProblems } from '../../lib/passwordPolicy.js';
import { getSetting } from '../../lib/settings.js';
import { requireScreen, signedInUser } from '../../middleware/requireScreen.js';
import { setPassword } from '../auth/auth.repository.js';
import { endUserSessions } from '../auth/sessions.js';
import {
  createStaffUser,
  findAssignableRole,
  getUser,
  listUsers,
  setUserStatus,
  updateUser,
  usernameTaken,
} from './users.repository.js';

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().transform((s) => (s ? s : null));

const listQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional().transform((s) => s || undefined),
  userType: z.enum(['staff', 'customer']).optional(),
  status: z.enum(['active', 'locked', 'inactive']).optional(),
  roleId: z.coerce.number().int().positive().optional(),
});
const profile = z.object({
  firstName: z.string().trim().min(1, 'Enter the first name.').max(50),
  lastName: z.string().trim().max(50).default(''),
  email: z.email('Enter a valid email address.').max(100).optional().nullable().or(z.literal('').transform(() => null)).transform((s) => s ?? null),
  mobile: optionalText(20),
  employeeNo: optionalText(20),
  designation: optionalText(60),
  roleId: z.coerce.number().int().positive('Choose a role.'),
});
const createBody = profile.extend({
  username: z.string().trim().min(3, 'Use at least 3 characters.').max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores.'),
  password: z.string().min(1).max(200),
});
const statusBody = z.object({ action: z.enum(['activate', 'deactivate', 'unlock']) });
const resetBody = z.object({ password: z.string().min(1).max(200) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Administration › Users (screen USERS). Staff accounts are created here; customers sign up themselves. */
export function usersRoutes(pool: pg.Pool) {
  const router = Router();
  router.use(requireScreen('USERS'));

  async function checkPassword(password: string, username: string) {
    const policy = await getSetting(pool, 'auth.password_policy', DEFAULT_PASSWORD_POLICY);
    const problems = passwordProblems(password, policy, username);
    if (problems.length) throw new ValidationError('Choose a stronger password.', problems.map((message) => ({ field: 'password', message })));
  }

  async function existing(id: number) {
    const user = await getUser(pool, id);
    if (!user) throw new NotFoundError('This user does not exist.');
    return user;
  }

  router.get('/', async (req, res) => {
    sendOk(res, await listUsers(pool, parse(listQuery, req.query)));
  });

  router.get('/:id', async (req, res) => {
    sendOk(res, await existing(parse(idParam, req.params).id));
  });

  router.post('/', async (req, res) => {
    const me = signedInUser(req);
    const body = parse(createBody, req.body);
    if (!(await findAssignableRole(pool, body.roleId, 'staff'))) throw new ValidationError('Choose an active staff role.', [{ field: 'roleId', message: 'Not a staff role.' }]);
    if (await usernameTaken(pool, body.username)) throw new ConflictError('USERNAME_TAKEN', `The username "${body.username}" is already in use.`);
    await checkPassword(body.password, body.username);

    const userId = await withTransaction(pool, async (client) => {
      const id = await createStaffUser(client, body, body.password);
      const { password: _omit, ...snapshot } = body;
      await audit(client, { table: 'app.users', recordId: id, action: 'created', userId: me.userId, snapshot });
      return id;
    });
    sendOk(res, await getUser(pool, userId), 201);
  });

  router.put('/:id', async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const user = await existing(id);
    const body = parse(profile, req.body);
    if (!(await findAssignableRole(pool, body.roleId, user.userType))) {
      throw new ValidationError(`Choose an active ${user.userType} role.`, [{ field: 'roleId', message: `Not a ${user.userType} role.` }]);
    }
    await updateUser(pool, id, body);
    await audit(pool, { table: 'app.users', recordId: id, action: 'updated', userId: me.userId, snapshot: body });
    sendOk(res, await getUser(pool, id));
  });

  router.post('/:id/status', async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const { action } = parse(statusBody, req.body);
    const user = await existing(id);
    if (id === me.userId && action === 'deactivate') throw new BusinessRuleError('OWN_ACCOUNT', "You can't deactivate your own account.");

    await withTransaction(pool, async (client) => {
      await setUserStatus(client, id, action === 'deactivate' ? 'inactive' : 'active');
      if (action === 'deactivate') await endUserSessions(client, id, 'deactivated');
      await audit(client, { table: 'app.users', recordId: id, action: action === 'unlock' ? 'unlocked' : `${action}d`, userId: me.userId, snapshot: { from: user.status } });
    });
    sendOk(res, await getUser(pool, id));
  });

  router.post('/:id/reset-password', async (req, res) => {
    const me = signedInUser(req);
    const { id } = parse(idParam, req.params);
    const user = await existing(id);
    const { password } = parse(resetBody, req.body);
    await checkPassword(password, user.username);

    await withTransaction(pool, async (client) => {
      await setPassword(client, id, password, false);
      await client.query('UPDATE app.users SET failed_attempts = 0, status = CASE WHEN status = 2 THEN 1 ELSE status END WHERE user_id = $1', [id]);
      await endUserSessions(client, id, 'password_changed');
      await audit(client, { table: 'app.users', recordId: id, action: 'password_reset', userId: me.userId });
    });
    sendOk(res, await getUser(pool, id));
  });

  return router;
}
