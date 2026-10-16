import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../http/errors.js';

/**
 * Allows the request when the user may use at least one of the given screen or function codes (app.screens).
 * Put it on every route that reads or changes protected data, with the same code the screen uses:
 *
 *   router.get('/inspections', requireScreen('INSPECTION_HISTORY', 'INSPECTION_REVIEW'), handler)
 */
export function requireScreen(...codes: [string, ...string[]]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) throw new UnauthenticatedError();
    if (user.isSuperAdmin || codes.some((c) => user.screens.has(c))) return next();
    throw new ForbiddenError();
  };
}
