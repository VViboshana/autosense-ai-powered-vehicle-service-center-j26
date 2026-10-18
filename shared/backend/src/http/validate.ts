import type { z } from 'zod';
import { ValidationError } from './errors.js';

/** Parses request input with a zod schema; a failure becomes a 400 VALIDATION_FAILED listing each bad field. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw new ValidationError('Some values are not valid.', fields);
  }
  return result.data;
}
