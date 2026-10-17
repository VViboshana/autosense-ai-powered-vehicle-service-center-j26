import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { clearSessionCookie, setSessionCookie } from '../../http/cookies.js';
import { sendOk } from '../../http/envelope.js';
import { AppError, ConflictError, TooManyRequestsError, UnauthenticatedError, ValidationError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { audit } from '../../lib/audit.js';
import { normalizeMobile } from '../../lib/mobile.js';
import { verifyPassword } from '../../lib/password.js';
import { DEFAULT_PASSWORD_POLICY, passwordProblems } from '../../lib/passwordPolicy.js';
import { getSetting } from '../../lib/settings.js';
import { loadUser } from '../access/access.repository.js';
import { createStaffUser, needsSetup } from '../admin/users.repository.js';
import { toMe } from '../access/me.js';
import {
  createCustomerAccount,
  findLogin,
  getPasswordHash,
  isRecentPassword,
  recordFailedLogin,
  recordSuccessfulLogin,
  setPassword,
} from './auth.repository.js';
import { createRateLimiter } from './rateLimit.js';
import { createSession, endSession, endUserSessions } from './sessions.js';

const WRONG_LOGIN = 'The username or password is not correct.';
// A real hash, so checking an unknown username takes as long as checking a known one (no timing hint).
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

const loginBody = z.object({ username: z.string().trim().min(1).max(100), password: z.string().min(1).max(200) });
const registerBody = z.object({
  fullName: z.string().trim().min(2, 'Enter your name.').max(100),
  mobile: z.string().trim().min(9).max(20),
  email: z.email('Enter a valid email address, or leave it empty.').max(100).optional().or(z.literal('').transform(() => undefined)),
  password: z.string().min(1).max(200),
});
const changeBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });
const setupBody = z.object({
  setupKey: z.string().max(200).optional(),
  username: z.string().trim().min(3, 'Use at least 3 characters.').max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores.'),
  firstName: z.string().trim().min(1, 'Enter your first name.').max(50),
  lastName: z.string().trim().max(50).default(''),
  email: z.email('Enter a valid email address.').max(100).optional().or(z.literal('').transform(() => undefined)),
  password: z.string().min(1).max(200),
});

function passwordRules(problems: string[], message = 'Choose a stronger password.') {
  if (problems.length) throw new ValidationError(message, problems.map((m) => ({ field: 'password', message: m })));
}

/**
 * /api/auth/*: sign in, sign out, customer sign-up, change password. Open routes (no screen permission):
 * protection comes from the password check, the lockout, the rate limit and the Origin check.
 */
export function authRoutes(pool: pg.Pool, secureCookies: boolean, setupKey?: string) {
  const router = Router();
  const limiter = createRateLimiter(10, 15 * 60_000);

  async function startSession(req: Request, res: Response, userId: number) {
    const limits = await getSetting(pool, 'auth.sessions', { maxHours: 12, idleMinutes: 120 });
    const session = await createSession(pool, userId, limits.maxHours, req.ip, req.get('user-agent'));
    setSessionCookie(res, session.token, session.expiresAt, secureCookies);
    const user = await loadUser(pool, userId, session.sessionId);
    if (!user) throw new UnauthenticatedError(WRONG_LOGIN);
    return user;
  }

  router.post('/login', async (req, res) => {
    const body = parse(loginBody, req.body);
    const username = normalizeMobile(body.username) ?? body.username;
    const wait = limiter.hit(`${req.ip}|${username.toLowerCase()}`);
    if (wait) throw new TooManyRequestsError(`Too many sign-in attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);

    const login = await findLogin(pool, username);
    const passwordOk = await verifyPassword(body.password, login?.password_hash ?? DUMMY_HASH);

    if (!login) throw new UnauthenticatedError(WRONG_LOGIN);
    if (login.status === 2) {
      throw new AppError(423, 'ACCOUNT_LOCKED', 'This account is locked after too many wrong passwords. Ask an administrator to unlock it.');
    }
    if (!passwordOk) {
      const { maxFailedAttempts } = await getSetting(pool, 'auth.lockout', { maxFailedAttempts: 5 });
      const locked = await recordFailedLogin(pool, login.user_id, maxFailedAttempts);
      await audit(pool, { table: 'app.users', recordId: login.user_id, action: locked ? 'locked' : 'sign_in_failed', userId: null, snapshot: { ip: req.ip } });
      if (locked) {
        throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many wrong passwords: this account is now locked. Ask an administrator to unlock it.');
      }
      throw new UnauthenticatedError(WRONG_LOGIN);
    }
    if (login.status !== 1 || !login.usable) throw new UnauthenticatedError(WRONG_LOGIN);

    limiter.reset(`${req.ip}|${username.toLowerCase()}`);
    await recordSuccessfulLogin(pool, login.user_id);
    const user = await startSession(req, res, login.user_id);
    await audit(pool, { table: 'app.users', recordId: login.user_id, action: 'signed_in', userId: login.user_id, snapshot: { ip: req.ip } });
    sendOk(res, toMe(user));
  });

  router.post('/logout', async (req, res) => {
    if (req.user) {
      await endSession(pool, req.user.sessionId, 'signed_out');
      await audit(pool, { table: 'app.users', recordId: req.user.userId, action: 'signed_out', userId: req.user.userId });
    }
    clearSessionCookie(res, secureCookies);
    sendOk(res, { signedOut: true });
  });

  /** Customer self sign-up. Staff accounts are only created by an administrator. */
  router.post('/register', async (req, res) => {
    const body = parse(registerBody, req.body);
    const wait = limiter.hit(`register|${req.ip}`);
    if (wait) throw new TooManyRequestsError(`Too many sign-ups from this connection. Try again in ${Math.ceil(wait / 60)} minutes.`);

    const mobile = normalizeMobile(body.mobile);
    if (!mobile) throw new ValidationError('Check the mobile number.', [{ field: 'mobile', message: 'Enter a 10-digit mobile number, e.g. 0771234567.' }]);
    const policy = await getSetting(pool, 'auth.password_policy', DEFAULT_PASSWORD_POLICY);
    passwordRules(passwordProblems(body.password, policy, mobile));

    const [firstName = '', ...rest] = body.fullName.split(/\s+/);
    const created = await withTransaction(pool, async (client) => {
      const result = await createCustomerAccount(client, {
        firstName,
        lastName: rest.join(' '),
        mobile,
        email: body.email ?? null,
        password: body.password,
      });
      if (result !== 'ACCOUNT_EXISTS') {
        await audit(client, { table: 'app.users', recordId: result.userId, action: 'registered', userId: result.userId, snapshot: { customerId: result.customerId } });
      }
      return result;
    });
    if (created === 'ACCOUNT_EXISTS') {
      throw new ConflictError('ACCOUNT_EXISTS', 'An account with this mobile number already exists. Sign in, or ask the service centre to reset your password.');
    }

    const user = await startSession(req, res, created.userId);
    sendOk(res, toMe(user), 201);
  });

  /**
   * First-run setup: creates the first System administrator (a super admin) and signs them in. Works only while the
   * database has no staff account at all; after that it always answers SETUP_DONE. If SETUP_KEY is set in .env, the
   * key must be given too (use it on any server others can reach).
   */
  router.post('/setup', async (req, res) => {
    const body = parse(setupBody, req.body);
    const wait = limiter.hit(`setup|${req.ip}`);
    if (wait) throw new TooManyRequestsError(`Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.`);
    if (setupKey) {
      const given = Buffer.from(body.setupKey ?? '');
      const expected = Buffer.from(setupKey);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw new ValidationError('The setup key is not correct.', [{ field: 'setupKey', message: 'Not correct. It is SETUP_KEY in backend/.env.local.' }]);
      }
    }
    const policy = await getSetting(pool, 'auth.password_policy', DEFAULT_PASSWORD_POLICY);
    passwordRules(passwordProblems(body.password, policy, body.username));

    const userId = await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(724001)'); // one setup at a time
      if (!(await needsSetup(client))) {
        throw new ConflictError('SETUP_DONE', 'AutoSense is already set up. Sign in, or ask your administrator for an account.');
      }
      const role = await client.query<{ role_id: number }>("SELECT role_id FROM app.roles WHERE lower(name) = 'system administrator'");
      if (!role.rows[0]) throw new Error('The System administrator role is missing. Run npm run db:migrate.');
      const id = await createStaffUser(
        client,
        {
          username: body.username, firstName: body.firstName, lastName: body.lastName, email: body.email ?? null,
          mobile: null, employeeNo: null, designation: 'System administrator', roleId: role.rows[0].role_id,
        },
        body.password,
        true,
      );
      await audit(client, { table: 'app.users', recordId: id, action: 'first_admin_created', userId: id, snapshot: { username: body.username, ip: req.ip } });
      return id;
    });

    const user = await startSession(req, res, userId);
    sendOk(res, toMe(user), 201);
  });

  router.post('/change-password', async (req, res) => {
    const user = req.user;
    if (!user) throw new UnauthenticatedError();
    const body = parse(changeBody, req.body);

    const hash = await getPasswordHash(pool, user.userId);
    if (!hash || !(await verifyPassword(body.currentPassword, hash))) {
      throw new ValidationError('Your current password is not correct.', [{ field: 'currentPassword', message: 'Not correct.' }]);
    }
    const policy = await getSetting(pool, 'auth.password_policy', DEFAULT_PASSWORD_POLICY);
    passwordRules(passwordProblems(body.newPassword, policy, user.username));
    if (await isRecentPassword(pool, user.userId, body.newPassword, policy.rememberLast)) {
      passwordRules([`Choose a password you haven't used in your last ${policy.rememberLast + 1} passwords.`], 'You used this password recently.');
    }

    await withTransaction(pool, async (client) => {
      await setPassword(client, user.userId, body.newPassword, false);
      await endUserSessions(client, user.userId, 'password_changed', user.sessionId);
      await audit(client, { table: 'app.users', recordId: user.userId, action: 'password_changed', userId: user.userId });
    });
    const fresh = await loadUser(pool, user.userId, user.sessionId);
    sendOk(res, fresh ? toMe(fresh) : { changed: true });
  });

  return router;
}
