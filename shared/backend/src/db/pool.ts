import pg from 'pg';

/** Anything that can run a query: the pool, or one client inside a transaction. Repositories accept this. */
export type Db = Pick<pg.Pool, 'query'>;

// NUMERIC and BIGINT arrive as strings by default (to avoid precision loss). Every NUMERIC column here fits a JS number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000, // Neon can take a few seconds to wake a sleeping database
    application_name: 'autosense-api',
  });
}

/** Runs fn inside one transaction; rolls back if it throws. */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
