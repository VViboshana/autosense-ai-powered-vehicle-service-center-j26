import { z } from 'zod';

/** Every environment setting the API reads. Checked once at startup; a bad value stops the process with a clear message. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is missing. Copy backend/.env.example to backend/.env and fill it in.' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  DEV_USER: z.string().trim().min(1).optional(),
  ML_DAMAGE_URL: z.url().optional(),
  ML_OCCUPANCY_URL: z.url().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid configuration in backend/.env:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.DEV_USER) {
    throw new Error('DEV_USER must not be set in production: it signs every request in as that user.');
  }
  return env;
}
