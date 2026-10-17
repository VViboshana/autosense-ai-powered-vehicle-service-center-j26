import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { logger } from '../lib/logger.js';

/** Gives every request an id (returned in the envelope and the X-Request-Id header) and logs it when it finishes. */
export const requestContext: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const started = performance.now();
  res.on('finish', () => {
    const fields = {
      requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(performance.now() - started),
    };
    if (res.statusCode >= 500) logger.error('request failed', fields);
    else logger.info('request', fields);
  });
  next();
};
