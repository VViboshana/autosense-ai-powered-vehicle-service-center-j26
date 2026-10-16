import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { UnauthenticatedError } from '../../http/errors.js';
import { buildMenu } from './menu.js';
import { listMenuScreens } from './navigation.repository.js';

/** GET /api/me (who am I, what may I use) and GET /api/navigation/menu (my sidebar). */
export function navigationRoutes(db: Db) {
  const router = Router();

  router.get('/me', (req, res) => {
    const user = req.user;
    if (!user) throw new UnauthenticatedError();
    sendOk(res, {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      designation: user.designation,
      role: { roleId: user.roleId, name: user.roleName },
      isSuperAdmin: user.isSuperAdmin,
      permissions: [...user.screens].sort(),
    });
  });

  router.get('/navigation/menu', async (req, res) => {
    const user = req.user;
    if (!user) throw new UnauthenticatedError();
    const screens = await listMenuScreens(db);
    sendOk(res, buildMenu(screens, user.screens, user.isSuperAdmin));
  });

  return router;
}
