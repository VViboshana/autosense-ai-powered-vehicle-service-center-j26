import type { Request, RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../http/errors.js';
import type { CurrentUser } from '../modules/access/access.types.js';

/** The signed-in user, or 401. Until a required password change is done, only /api/me and /api/auth/* work. */
export function signedInUser(req: Request): CurrentUser {
  const user = req.user;
  if (!user) throw new UnauthenticatedError();
  if (user.mustChangePassword) throw new ForbiddenError('Change your password to continue.', 'PASSWORD_CHANGE_REQUIRED');
  return user;
}

/**
 * Allows the request when the user may use at least one of the given screen or function codes (app.screens).
 * Put it on every staff route that reads or changes protected data, with the same code the screen uses:
 *
 *   router.get('/inspections', requireScreen('INSPECTION_HISTORY', 'INSPECTION_REVIEW'), handler)
 */
export function requireScreen(...codes: [string, ...string[]]): RequestHandler {
  return (req, _res, next) => {
    const user = signedInUser(req);
    if (codes.some((c) => user.screens.has(c))) return next();
    throw new ForbiddenError();
  };
}

/**
 * For customer routes (/api/my/*): only signed-in customers. Handlers then filter every query by req.user.customerId.
 * Pass a code to also require that customer screen (e.g. MY_INSPECTIONS), so an administrator can switch a tab off.
 */
export function requireCustomer(code?: string): RequestHandler {
  return (req, _res, next) => {
    const user = signedInUser(req);
    if (user.userType !== 'customer' || user.customerId === null) throw new ForbiddenError();
    if (code && !user.screens.has(code)) throw new ForbiddenError();
    next();
  };
}
