import express from 'express';
import type { Env } from './config/env.js';
import type { Db } from './db/pool.js';
import { currentUser } from './middleware/currentUser.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { jobsRoutes } from './modules/jobs/jobs.routes.js';
import { navigationRoutes } from './modules/navigation/navigation.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';

/**
 * Builds the API. Every route lives under /api. To add a module: create modules/<name>/<name>.routes.ts and mount it
 * below, after currentUser (so req.user is set) — see docs/DEVELOPING.md.
 */
export function createApp(db: Db, env: Env) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(express.json({ limit: '1mb' }));

  // Open: no user needed
  app.use('/api', systemRoutes(db, env));

  // Everything below knows who is calling (req.user)
  app.use('/api', currentUser(db, env.DEV_USER));
  app.use('/api', navigationRoutes(db));
  app.use('/api/dashboard', dashboardRoutes(db));
  app.use('/api/jobs', jobsRoutes(db));

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
