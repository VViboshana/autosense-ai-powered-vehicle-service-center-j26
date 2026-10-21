import express from 'express';
import type pg from 'pg';
import type { Env } from './config/env.js';
import { authenticate } from './middleware/authenticate.js';
import { checkOrigin } from './middleware/checkOrigin.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { auditRoutes } from './modules/admin/audit.routes.js';
import { rolesRoutes } from './modules/admin/roles.routes.js';
import { usersRoutes } from './modules/admin/users.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { bookingsRoutes } from './modules/bookings/bookings.routes.js';
import { myBookingsRoutes } from './modules/bookings/myBookings.routes.js';
import { claimsRoutes } from './modules/claims/claims.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { inspectionsRoutes } from './modules/inspections/inspections.routes.js';
import { jobsRoutes } from './modules/jobs/jobs.routes.js';
import { myServiceCentreRoutes } from './modules/occupancy/occupancy.my.routes.js';
import { myActivityRoutes } from './modules/my/myActivity.routes.js';
import { myRoutes } from './modules/my/my.routes.js';
import { navigationRoutes } from './modules/navigation/navigation.routes.js';
import { maintenanceRoutes } from './modules/maintenance/maintenance.routes.js';
import { securityRoutes } from './modules/security/security.routes.js';
import { occupancyRoutes } from './modules/occupancy/occupancy.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';

/**
 * Builds the API. Every route lives under /api. `authenticate` sets req.user from the sign-in cookie for every
 * request; each route then decides who may use it (requireScreen for staff, requireCustomer for customers).
 * To add a module: create modules/<name>/<name>.routes.ts and mount it below — see docs/DEVELOPING.md.
 */
export function createApp(pool: pg.Pool, env: Env) {
  const secureCookies = env.NODE_ENV === 'production';
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', checkOrigin(env.ALLOWED_ORIGINS));

  app.use('/api', systemRoutes(pool, env)); // health and public config: no user needed
  app.use('/api', authenticate(pool, secureCookies));
  app.use('/api/auth', authRoutes(pool, secureCookies, env.SETUP_KEY));
  app.use('/api', navigationRoutes(pool));
  // Staff
  app.use('/api/dashboard', dashboardRoutes(pool));
  app.use('/api/jobs', jobsRoutes(pool));
  app.use('/api/vehicle-requests', claimsRoutes(pool, env.UPLOAD_DIR));
  app.use('/api/bookings', bookingsRoutes(pool));
  app.use('/api/inspections', inspectionsRoutes({ pool, damageServiceUrl: env.ML_DAMAGE_URL, uploadDir: env.UPLOAD_DIR }));
  app.use('/api/maintenance', maintenanceRoutes(env));
  app.use('/api/security', securityRoutes({ pool, uploadDir: env.UPLOAD_DIR, serviceUrl: process.env.ML_SECURITY_URL || 'http://localhost:8004' }));
  app.use('/api/occupancy', occupancyRoutes({ pool, serviceUrl: env.ML_OCCUPANCY_URL }));
  app.use('/api/admin/users', usersRoutes(pool));
  app.use('/api/admin/roles', rolesRoutes(pool));
  app.use('/api/admin/audit', auditRoutes(pool));
  // Customers
  app.use('/api/my/bookings', myBookingsRoutes(pool));
  app.use('/api/my/service-centre', myServiceCentreRoutes(pool));
  app.use('/api/my', myActivityRoutes(pool));
  app.use('/api/my', myRoutes(pool, env.UPLOAD_DIR));

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
