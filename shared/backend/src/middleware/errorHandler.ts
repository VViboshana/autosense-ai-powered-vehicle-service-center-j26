import type { ErrorRequestHandler, RequestHandler } from 'express';
import { sendError } from '../http/envelope.js';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';

/** Unknown /api routes: the same envelope as every other error. */
export const notFound: RequestHandler = (req, res) => {
  sendError(res, 404, 'NOT_FOUND', `There is no API at ${req.method} ${req.originalUrl.split('?')[0]}.`);
};

/** Turns any thrown error into the envelope. Expected errors keep their message; anything else becomes a generic 500. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }
  // Body that is not valid JSON
  if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
    sendError(res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
    return;
  }
  // Postgres could not be reached
  if (err && typeof err === 'object' && 'code' in err && ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '53300'].includes(String(err.code))) {
    logger.error('database unavailable', { requestId: res.locals.requestId, error: String(err) });
    sendError(res, 503, 'DATABASE_UNAVAILABLE', 'The database is not responding. Try again in a moment.');
    return;
  }
  logger.error('unhandled error', {
    requestId: res.locals.requestId,
    error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
  });
  sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our side. Quote the reference if you report it.');
};
