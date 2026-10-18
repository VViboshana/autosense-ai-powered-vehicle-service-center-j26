/**
 * The only way the app talks to the server. Every response is the API envelope:
 *   { success: true, data, requestId } or { success: false, error: { code, message, details? }, requestId }
 * apiGet/apiSend return `data` or throw ApiError, so screens never parse envelopes themselves.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Envelope<T> =
  | { success: true; data: T; requestId: string }
  | { success: false; error: { code: string; message: string; details?: unknown }; requestId: string };

export type Query = Record<string, string | number | boolean | null | undefined>;

export function withQuery(path: string, query?: Query) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  // A FormData body (file uploads) is sent as multipart: the browser sets its Content-Type with the boundary.
  const form = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      headers: body === undefined || form ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', "Can't reach the AutoSense server. Check your connection, or that the API is running.");
  }

  let envelope: Envelope<T>;
  try {
    envelope = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(res.status, 'BAD_RESPONSE', `The server answered with something unexpected (HTTP ${res.status}).`);
  }
  if (!envelope.success) {
    // The session ended (signed out elsewhere, expired, account deactivated): send the user back to sign-in.
    if (res.status === 401 && !path.startsWith('/auth/') && path !== '/me') window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiError(res.status, envelope.error.code, envelope.error.message, envelope.requestId, envelope.error.details);
  }
  return envelope.data;
}

/** Fired when the server says the user is no longer signed in. */
export const SIGNED_OUT_EVENT = 'autosense:signed-out';

/** Field messages from a 400 VALIDATION_FAILED, keyed by field name (first message per field). */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const d of error.details as { field?: string; message?: string }[]) {
    if (d.field && d.message && !out[d.field]) out[d.field] = d.message;
  }
  return out;
}

/** All messages for one field (e.g. every password rule that failed). */
export function fieldMessages(error: unknown, field: string): string[] {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return [];
  return (error.details as { field?: string; message?: string }[]).filter((d) => d.field === field && d.message).map((d) => d.message!);
}

export const apiGet = <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', withQuery(path, query), undefined, signal);
export const apiSend = <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => request<T>(method, path, body);
/** Uploads files: build a FormData with the files and fields, e.g. form.append('images', file). */
export const apiUpload = <T>(path: string, form: FormData) => request<T>('POST', path, form);
