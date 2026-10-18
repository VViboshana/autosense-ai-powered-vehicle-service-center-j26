import type { Response } from 'express';

/**
 * Every API response uses this envelope. The frontend (src/lib/api.ts) depends on it: never send a bare object.
 *   success: { success: true,  data,  requestId }
 *   failure: { success: false, error: { code, message, details? }, requestId }
 */
export type ApiSuccess<T> = { success: true; data: T; requestId: string };
export type ApiFailure = { success: false; error: { code: string; message: string; details?: unknown }; requestId: string };

export function sendOk<T>(res: Response, data: T, status = 200) {
  const body: ApiSuccess<T> = { success: true, data, requestId: res.locals.requestId as string };
  res.status(status).json(body);
}

export function sendError(res: Response, status: number, code: string, message: string, details?: unknown) {
  const body: ApiFailure = {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
    requestId: res.locals.requestId as string,
  };
  res.status(status).json(body);
}
