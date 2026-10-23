import { z } from 'zod';

/** Every environment setting the API reads. Checked once at startup; a bad value stops the process with a clear message. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is missing. Copy backend/.env.local.example to backend/.env.local and put the connection string in it.' })
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must start with postgres:// or postgresql://'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  /** Web addresses allowed to send changes (protects signed-in users from other sites posting on their behalf). */
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean)),
  /** Optional. When set, the first-run setup page asks for it before creating the first administrator. */
  SETUP_KEY: z.string().min(8, 'SETUP_KEY must be at least 8 characters').optional(),
  ML_DAMAGE_URL: z.url().optional(),
  /** Folder for uploaded photos (relative to backend/, or absolute). Never committed. */
  UPLOAD_DIR: z.string().min(1).default('uploads'),
  ML_OCCUPANCY_URL: z.url().optional(),
  /** Internal Component 3 FastAPI service; never exposed to the browser. */
  MAINTENANCE_ML_SERVICE_URL: z.url().optional(),
  /** Component 4 security service (member-4-anomaly-detection/service). */
  ML_SECURITY_URL: z.url().default('http://localhost:8004'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Invalid configuration in backend/.env or backend/.env.local:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
