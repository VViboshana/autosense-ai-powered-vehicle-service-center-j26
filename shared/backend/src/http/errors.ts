/**
 * Errors the API returns on purpose. Throw one of these from a route, service or repository; the error middleware
 * turns it into the standard envelope with the right HTTP status. Anything else becomes a 500 INTERNAL_ERROR
 * (details logged, never sent to the browser).
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_FAILED', message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission to do this. Ask an administrator for access.", code = 'FORBIDDEN') {
    super(403, code, message);
  }
}

/** Something with the same key already exists (e.g. a username). */
export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
  }
}

/** Too many attempts; try again later. */
export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super(429, 'TOO_MANY_ATTEMPTS', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

/** A rule of the business was broken (e.g. confirming an inspection that is still processing). */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string) {
    super(422, code, message);
  }
}

/** A dependency (database, AI service) did not answer. */
export class ServiceUnavailableError extends AppError {
  constructor(code: string, message: string) {
    super(503, code, message);
  }
}

export class GatewayTimeoutError extends AppError {
  constructor(code: string, message: string) {
    super(504, code, message);
  }
}
