import type { RequestHandler } from 'express';
import type { Db } from '../db/pool.js';
import { UnauthenticatedError } from '../http/errors.js';
import { findActiveUser } from '../modules/access/access.repository.js';
import type { CurrentUser } from '../modules/access/access.types.js';

/**
 * Works out who is calling and puts it on req.user.
 *
 * TEMPORARY: sign-in is the next feature. Until then every request acts as DEV_USER from backend/.env (never allowed
 * in production). When sign-in lands, only this middleware changes: it will read the user from the access token,
 * and every route keeps using req.user and requireScreen() as it does now.
 */
export function currentUser(db: Db, devUser: string | undefined): RequestHandler {
  let cached: { user: CurrentUser; at: number } | null = null;
  const ttlMs = 10_000; // pick up role changes within seconds without a database round trip per request

  return async (req, _res, next) => {
    if (!devUser) throw new UnauthenticatedError();
    if (!cached || Date.now() - cached.at > ttlMs) {
      const user = await findActiveUser(db, devUser);
      if (!user) throw new UnauthenticatedError(`DEV_USER "${devUser}" is not an active user. Run npm run db:seed, or pick another user.`);
      cached = { user, at: Date.now() };
    }
    req.user = cached.user;
    next();
  };
}
