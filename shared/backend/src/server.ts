import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import { logger, setLogLevel } from './lib/logger.js';
import { APP_VERSION } from './version.js';

let env;
try {
  env = loadEnv();
} catch (err) {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
setLogLevel(env.LOG_LEVEL);

const pool = createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX);
pool.on('error', (err) => logger.error('idle database connection failed', { error: err.message }));

const server = createApp(pool, env).listen(env.PORT, '127.0.0.1', () => {
  logger.info(`AutoSense API ${APP_VERSION} listening on http://127.0.0.1:${env.PORT}`, {
    environment: env.NODE_ENV,
    allowedOrigins: env.ALLOWED_ORIGINS,
  });
});

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
