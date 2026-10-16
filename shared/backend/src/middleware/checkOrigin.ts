import type { RequestHandler } from 'express';
import { ForbiddenError } from '../http/errors.js';

/**
 * Cross-site request protection. Browsers send an Origin header with every POST/PUT/PATCH/DELETE; a change is only
 * accepted from the AutoSense web app's own address (ALLOWED_ORIGINS). Together with the SameSite cookie this stops
 * another website from acting with a signed-in user's session. Requests without Origin (scripts, curl, AI services)
 * carry no browser cookie, so they are not at risk.
 */
export function checkOrigin(allowed: string[]): RequestHandler {
  const set = new Set(allowed);
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !set.has(origin.replace(/\/$/, ''))) {
      throw new ForbiddenError('This request came from a page outside AutoSense.', 'BAD_ORIGIN');
    }
    next();
  };
}
