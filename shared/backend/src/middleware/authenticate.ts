import type { RequestHandler } from 'express';
import type { Db } from '../db/pool.js';
import { clearSessionCookie, readCookie, SESSION_COOKIE } from '../http/cookies.js';
import { getSetting } from '../lib/settings.js';
import { loadUser } from '../modules/access/access.repository.js';
import { endSession, findOpenSession, touchSession } from '../modules/auth/sessions.js';

const SESSION_DEFAULTS = { maxHours: 12, idleMinutes: 120 };

/**
 * Works out who is calling from the sign-in cookie and puts it on req.user. Never rejects a request by itself:
 * routes decide with requireScreen() / requireCustomer(). Ends sessions that are past their limit or idle too long,
 * and sessions whose user was deactivated or locked.
 */
export function authenticate(db: Db, secureCookies: boolean): RequestHandler {
  return async (req, res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return next();

    const session = await findOpenSession(db, token);
    if (!session) {
      clearSessionCookie(res, secureCookies);
      return next();
    }

    const limits = await getSetting(db, 'auth.sessions', SESSION_DEFAULTS);
    const now = Date.now();
    const reason =
      session.expires_at.getTime() <= now
        ? 'expired'
        : now - session.last_seen_at.getTime() > limits.idleMinutes * 60_000
          ? 'idle'
          : null;
    if (reason) {
      await endSession(db, session.session_id, reason);
      clearSessionCookie(res, secureCookies);
      return next();
    }

    const user = await loadUser(db, session.user_id, session.session_id);
    if (!user) {
      await endSession(db, session.session_id, 'deactivated');
      clearSessionCookie(res, secureCookies);
      return next();
    }

    if (now - session.last_seen_at.getTime() > 60_000) await touchSession(db, session.session_id);
    req.user = user;
    next();
  };
}
