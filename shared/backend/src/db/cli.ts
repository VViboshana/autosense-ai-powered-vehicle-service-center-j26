/* eslint-disable no-console -- a command-line tool talks to the terminal */
import { loadEnv } from '../config/env.js';
import { createPool } from './pool.js';
import { dropAll, migrate, seed, status } from './runner.js';

/**
 * npm run db:migrate   apply new migrations, then refresh reference data
 * npm run db:seed      add sample data (development only)
 * npm run db:reset     drop everything, migrate and seed (development only; asks for --yes)
 * npm run db:status    list migrations and when each was applied
 */
const command = process.argv[2];
const env = loadEnv();
const log = (m: string) => console.log(m);

function refuseInProduction(what: string) {
  if (env.NODE_ENV === 'production') {
    console.error(`${what} is for development databases only (NODE_ENV=production).`);
    process.exit(1);
  }
}

const pool = createPool(env.DATABASE_URL);
let client;
try {
  client = await pool.connect();
} catch (err) {
  const host = new URL(env.DATABASE_URL).host;
  console.error(`Could not connect to the database at ${host}: ${err instanceof Error ? err.message : err}`);
  console.error('Check DATABASE_URL in backend/.env, and that the database is running (or awake, on Neon).');
  await pool.end();
  process.exit(1);
}
try {
  switch (command) {
    case 'migrate':
      log('Migrating…');
      await migrate(client, log);
      break;
    case 'seed':
      refuseInProduction('Seeding sample data');
      log('Seeding sample data…');
      await seed(client, log);
      log('Sample vehicles, jobs, bays and inspections are ready. No accounts are created:');
      log('open the web app to create the first administrator, then add your team in Administration > Users.');
      break;
    case 'reset':
      refuseInProduction('Reset');
      if (!process.argv.includes('--yes')) {
        console.error('This deletes every AutoSense table and its data. Run: npm run db:reset -- --yes');
        process.exitCode = 1;
        break;
      }
      log('Resetting…');
      await dropAll(client, log);
      await migrate(client, log);
      await seed(client, log);
      break;
    case 'status':
      for (const row of await status(client)) {
        log(`${row.appliedAt ? 'applied ' + row.appliedAt.toISOString() : 'PENDING                         '}  ${row.file}`);
      }
      break;
    default:
      console.error('Usage: tsx src/db/cli.ts <migrate|seed|reset|status>');
      process.exitCode = 1;
  }
  if (process.exitCode !== 1) log('Done.');
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
