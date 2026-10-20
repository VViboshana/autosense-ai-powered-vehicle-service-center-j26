/**
 * Member 1's test data on the shared database: camera TEST-PKL04 (PKLot UFPR04 time-lapse) and its bays (T06, T13, ...).
 * Nothing is ever deleted: their bay history is evaluation evidence. Every change is written to app.audit_log.
 *
 *   status   list the test camera and bays
 *   label    name them "[TEST] ..." so nobody mistakes them for real bays (kept on, e.g. for the PP1 demo)
 *   off      switch them off (is_active = false): gone from the dashboard, Bay monitor and suggestions
 *   on       switch them back on
 *   sim      add (or update) camera TEST-SIM "[TEST] Simulated service bays (AI-generated)" with bays SIM1..SIM6 from
 *            the .bays.json written by eval/simulate_bays.py compose:  sim videos/sim-service-bays.bays.json
 *            (then use status / off / on with --camera TEST-SIM)
 *
 * Run from the repo root (uses shared/node_modules and DATABASE_URL from shared/backend/.env.local):
 *   node member-1-occupancy/scripts/test_data.mjs status [--camera TEST-PKL04]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pg = createRequire(path.join(root, 'shared/backend/package.json'))('pg');

const [action = 'status', ...rest] = process.argv.slice(2);
const cameraArg = rest.includes('--camera') ? (rest[rest.indexOf('--camera') + 1] ?? '') : 'TEST-PKL04';
const simFile = action === 'sim' ? rest[0] : null;
const camera = action === 'sim' ? 'TEST-SIM' : cameraArg;
if (!['status', 'label', 'off', 'on', 'sim'].includes(action) || (action === 'sim' && !simFile)) {
  console.error('Usage: node member-1-occupancy/scripts/test_data.mjs <status|label|off|on> [--camera TEST-PKL04]');
  console.error('       node member-1-occupancy/scripts/test_data.mjs sim <videos/....bays.json>');
  process.exit(2);
}
if (!camera.startsWith('TEST-')) {
  console.error('Only cameras whose code starts with TEST- can be changed by this script.');
  process.exit(2);
}

const env = Object.fromEntries(
  readFileSync(path.join(root, 'shared/backend/.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const db = new pg.Client({ connectionString: env.DATABASE_URL });
await db.connect();

const audit = (table, id, act, snapshot) =>
  db.query('INSERT INTO app.audit_log (table_name, record_id, action, snapshot, user_id) VALUES ($1, $2, $3, $4, NULL)', [
    table, String(id), act, JSON.stringify({ ...snapshot, by: 'member-1-occupancy/scripts/test_data.mjs' }),
  ]);

try {
  await db.query('BEGIN');
  if (action === 'sim') {
    const meta = JSON.parse(readFileSync(path.resolve(simFile), 'utf8'));
    if (!meta.simulated) throw new Error('That file is not from eval/simulate_bays.py compose (no "simulated": true).');
    const source = path.basename(simFile).replace(/\.bays\.json$/, '.mp4');
    const name = '[TEST] Simulated service bays (AI-generated)';
    const c = (await db.query(
      `INSERT INTO occupancy.cameras (code, name, location, source_url, is_active) VALUES ($1, $2, 'Simulated footage', $3, true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, source_url = EXCLUDED.source_url RETURNING camera_id`,
      [camera, name, source],
    )).rows[0];
    await audit('occupancy.cameras', c.camera_id, 'create', { code: camera, name, sourceUrl: source });
    const entries = Object.entries(meta.bays);
    for (const [i, [k, polygon]] of entries.entries()) {
      const code = `SIM${k.replace(/\D/g, '')}`;
      const bayName = `[TEST] Simulated bay ${k.replace(/\D/g, '')}`;
      const b = (await db.query(
        `INSERT INTO occupancy.bays (code, name, camera_id, polygon, display_order, is_active) VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, camera_id = EXCLUDED.camera_id, polygon = EXCLUDED.polygon,
           display_order = EXCLUDED.display_order RETURNING bay_id`,
        [code, bayName, c.camera_id, JSON.stringify(polygon), 60 + i],
      )).rows[0];
      await audit('occupancy.bays', b.bay_id, 'create', { code, name: bayName, polygon });
    }
  }
  const cam = (await db.query('SELECT camera_id, code, name, is_active FROM occupancy.cameras WHERE code = $1', [camera])).rows[0];
  if (!cam) throw new Error(`No camera with code ${camera}.`);
  const bays = (await db.query('SELECT bay_id, code, name, is_active FROM occupancy.bays WHERE camera_id = $1 ORDER BY code', [cam.camera_id])).rows;

  if (action === 'label') {
    if (camera !== 'TEST-PKL04') throw new Error('label names the PKLot test camera only (TEST-PKL04).');
    const camName = '[TEST] PKLot UFPR04 time-lapse (sample footage)';
    await db.query('UPDATE occupancy.cameras SET name = $2 WHERE camera_id = $1', [cam.camera_id, camName]);
    await audit('occupancy.cameras', cam.camera_id, 'update', { name: camName, previous: cam.name });
    for (const b of bays) {
      const name = `[TEST] PKLot space ${Number(b.code.replace(/\D/g, ''))}`;
      await db.query('UPDATE occupancy.bays SET name = $2 WHERE bay_id = $1', [b.bay_id, name]);
      await audit('occupancy.bays', b.bay_id, 'update', { name, previous: b.name });
    }
  } else if (action === 'off' || action === 'on') {
    const active = action === 'on';
    await db.query('UPDATE occupancy.cameras SET is_active = $2 WHERE camera_id = $1', [cam.camera_id, active]);
    await audit('occupancy.cameras', cam.camera_id, active ? 'activate' : 'deactivate', {});
    for (const b of bays) {
      await db.query('UPDATE occupancy.bays SET is_active = $2 WHERE bay_id = $1', [b.bay_id, active]);
      await audit('occupancy.bays', b.bay_id, active ? 'activate' : 'deactivate', {});
    }
  }
  await db.query('COMMIT');

  const now = (await db.query(
    `SELECT 'camera' AS kind, code, name, is_active FROM occupancy.cameras WHERE camera_id = $1
     UNION ALL SELECT 'bay', code, name, is_active FROM occupancy.bays WHERE camera_id = $1 ORDER BY kind DESC, code`,
    [cam.camera_id],
  )).rows;
  console.table(now);
} catch (err) {
  await db.query('ROLLBACK');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.end();
}
