import { logger } from '../../lib/logger.js';
import { syncOpenJobs, type OccupancyDeps } from './occupancy.service.js';

/**
 * Follows running video jobs: every `intervalMs` (2 s) the API asks the occupancy service for new bay transitions and
 * stores them. 2 s keeps a bay change on screen well within the 5-second target (NFR-02). Passes never overlap.
 * Started by server.ts (not by createApp, so tests don't start timers). Returns a function that stops it.
 */
export function startOccupancySync(deps: OccupancyDeps, intervalMs = 2000): () => void {
  if (!deps.serviceUrl) {
    logger.info('occupancy sync off: ML_OCCUPANCY_URL is not set');
    return () => {};
  }
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    syncOpenJobs(deps)
      .catch((err: unknown) => logger.error('occupancy sync failed', { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
