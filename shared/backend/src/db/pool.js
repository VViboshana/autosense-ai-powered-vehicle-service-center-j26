import pg from 'pg';

// One shared connection pool. Only created when DATABASE_URL is set,
// so the server still runs before PostgreSQL is installed.
export const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : null;

export async function checkDatabase() {
  if (!pool) return 'not configured';
  try {
    await pool.query('SELECT 1');
    return 'connected';
  } catch {
    return 'unreachable';
  }
}
