import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { pool } from './pool.js';

// Run with: npm run db:init -w backend   (needs DATABASE_URL in backend/.env)
if (!pool) {
  console.error('DATABASE_URL is not set in backend/.env');
  process.exit(1);
}
const sql = await readFile(new URL('../../../database/schema.sql', import.meta.url), 'utf8');
await pool.query(sql);
console.log('Database schema created.');
await pool.end();
