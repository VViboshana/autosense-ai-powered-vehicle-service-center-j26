import { Router } from 'express';
import type { Db } from '../../db/pool.js';
import { sendOk } from '../../http/envelope.js';
import { UnauthenticatedError } from '../../http/errors.js';
import { toMe } from '../access/me.js';
import { buildMenu } from './menu.js';
import { listMenuScreens } from './navigation.repository.js';

/** GET /api/me (who am I, what may I use) and GET /api/navigation/menu (my menu: staff sidebar or customer pages). */
export function navigationRoutes(db: Db) {
  const router = Router();

  router.get('/me', (req, res) => {
    if (!req.user) throw new UnauthenticatedError();
    sendOk(res, toMe(req.user));
  });

  router.get('/navigation/menu', async (req, res) => {
    const user = req.user;
    if (!user) throw new UnauthenticatedError();
    const screens = await listMenuScreens(db, user.userType);
    sendOk(res, buildMenu(screens, user.screens, false));
  });

  return router;
}
