import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';

/**
 * Applies the SQL in shared/database:
 * - migrations/  numbered schema changes, each applied once, in order, inside a transaction; recorded in
 *                public.schema_migrations with a checksum. Never edit an applied migration: add a new one.
 * - reference/   data the app needs to work (screens, roles, settings). Re-applied on every migrate; written to be
 *                safe to re-run.
 * - seeds/       sample data for development (`db:seed`). Refused when NODE_ENV=production.
 */
export const DATABASE_DIR = path.resolve(import.meta.dirname, '../../../database');
const SCHEMAS = ['security', 'maintenance', 'occupancy', 'damage', 'workshop', 'app'];

type Log = (message: string) => void;

async function sqlFiles(folder: string) {
  const dir = path.join(DATABASE_DIR, folder);
  const names = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

async function inTransaction(client: pg.PoolClient, fn: () => Promise<void>) {
  await client.query('BEGIN');
  try {
    await fn();
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

export async function migrate(client: pg.PoolClient, log: Log) {
  await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename varchar(200) PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Map(
    (await client.query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM public.schema_migrations')).rows.map(
      (r) => [r.filename, r.checksum],
    ),
  );

  let count = 0;
  for (const file of await sqlFiles('migrations')) {
    const previous = applied.get(file.name);
    if (previous) {
      if (previous !== file.checksum) {
        throw new Error(
          `${file.name} was changed after it was applied. Put the change in a new migration file instead, ` +
            'or run `npm run db:reset` on a development database.',
        );
      }
      continue;
    }
    await inTransaction(client, async () => {
      await client.query(file.sql);
      await client.query('INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)', [file.name, file.checksum]);
    });
    log(`  applied   migrations/${file.name}`);
    count++;
  }
  if (count === 0) log('  migrations: already up to date');

  for (const file of await sqlFiles('reference')) {
    await inTransaction(client, () => client.query(file.sql).then(() => undefined));
    log(`  refreshed reference/${file.name}`);
  }
}

export async function seed(client: pg.PoolClient, log: Log) {
  for (const file of await sqlFiles('seeds')) {
    await inTransaction(client, () => client.query(file.sql).then(() => undefined));
    log(`  seeded    seeds/${file.name}`);
  }
}

export async function dropAll(client: pg.PoolClient, log: Log) {
  for (const schema of SCHEMAS) await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.query('DROP TABLE IF EXISTS public.schema_migrations');
  log(`  dropped   ${SCHEMAS.join(', ')}`);
}

export async function status(client: pg.PoolClient) {
  const files = await sqlFiles('migrations');
  const exists = (await client.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0]?.t;
  const applied = exists
    ? new Map(
        (await client.query<{ filename: string; applied_at: Date }>('SELECT filename, applied_at FROM public.schema_migrations')).rows.map(
          (r) => [r.filename, r.applied_at],
        ),
      )
    : new Map<string, Date>();
  return files.map((f) => ({ file: f.name, appliedAt: applied.get(f.name) ?? null }));
}
