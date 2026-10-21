import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Db } from '../../db/pool.js';
import { ServiceUnavailableError } from '../../http/errors.js';
import { logger } from '../../lib/logger.js';
import { formatAlertNo, type Severity } from './security.rules.js';

/**
 * Recorded video analysis (component 4). The API sends an uploaded clip to the security service
 * (member-4-anomaly-detection/service, `uvicorn c4security.service:app --port 8004`), follows the job, and when it is
 * done keeps the annotated video, the snapshots and the alerts here. The service keeps its jobs in memory only, so
 * everything the app shows later comes from this database and UPLOAD_DIR, not from the service.
 */
export type VideoDeps = { pool: pg.Pool; uploadDir: string; serviceUrl: string };

/** Shorter rule times for short demo clips (from the service README): loitering after 20 s, touching after 3 s. */
export const SHORT_TIMINGS = ['loitering.dwell_s=20', 'tampering.touch_s=3'];

const NOT_RESPONDING = 'The security service is not responding. Start it with: uvicorn c4security.service:app --port 8004';

const engineAlert = z.object({
  alert_id: z.string(),
  threat_type: z.enum(['fire', 'smoke', 'weapon', 'tampering', 'unauthorised_access', 'loitering']),
  severity: z.enum(['Low', 'Medium', 'High', 'Critical']),
  escalated_from: z.string().nullable().optional(),
  confidence: z.number().nullable(),
  zone: z.string().nullable().optional(),
  video_time_s: z.number().nullable().optional(),
  clock_time: z.string().nullable().optional(),
  person_track_id: z.number().nullable().optional(),
  person_role: z.enum(['worker', 'visitor']).nullable().optional(),
  affected_vehicles: z.array(z.object({ plate: z.string().optional() }).passthrough()).default([]),
  affected_persons: z.number().default(0),
  reasons: z.array(z.string()).default([]),
  notify_roles: z.array(z.string()).default([]),
  snapshot: z.string().nullable().optional(),
});
type EngineAlert = z.infer<typeof engineAlert>;

const jobReply = z.object({
  status: z.enum(['running', 'done', 'failed', 'stopped']),
  error: z.string().nullable().optional(),
  summary: z.record(z.string(), z.unknown()).nullable().optional(),
});

async function call(serviceUrl: string, route: string, init: RequestInit = {}, timeoutMs = 15_000) {
  try {
    return await fetch(new URL(route, serviceUrl), { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ServiceUnavailableError('SECURITY_SERVICE_UNAVAILABLE', NOT_RESPONDING);
  }
}

export async function serviceHealth(serviceUrl: string) {
  try {
    const res = await fetch(new URL('/health', serviceUrl), { signal: AbortSignal.timeout(3_000) });
    const body = (await res.json()) as { model_found?: boolean; running_jobs?: number; version?: string };
    return { online: res.ok, modelFound: Boolean(body.model_found), runningJobs: body.running_jobs ?? 0, version: body.version ?? null };
  } catch {
    return { online: false, modelFound: false, runningJobs: 0, version: null };
  }
}

/** Sends the clip to the service; returns its job id. */
export async function submitVideo(
  serviceUrl: string,
  file: { path: string; name: string; mimeType: string },
  cameraCode: string,
  startTime: string | null,
  shortTimings: boolean,
): Promise<string> {
  const form = new FormData();
  form.append('video', await openAsBlob(file.path, { type: file.mimeType }), file.name);
  form.append('camera_id', cameraCode);
  // Sent explicitly: the service's FastAPI version reads a missing save_video as false, and then writes no video
  form.append('save_video', 'true');
  if (startTime) form.append('start_time', startTime);
  if (shortTimings) form.append('overrides', SHORT_TIMINGS.join(','));
  const res = await call(serviceUrl, '/analyze', { method: 'POST', body: form }, 10 * 60_000);
  const body = (await res.json().catch(() => null)) as { job_id?: string } | null;
  if (!res.ok || !body?.job_id) throw new ServiceUnavailableError('SECURITY_SERVICE_REJECTED', 'The security service could not start the analysis.');
  return body.job_id;
}

async function download(serviceUrl: string, route: string, dest: string) {
  const res = await call(serviceUrl, route, {}, 10 * 60_000);
  if (!res.ok || !res.body) throw new Error(`${route}: HTTP ${res.status}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
}

const syncing = new Set<number>();

/**
 * Brings a running analysis up to date: still running, failed, or done (then the results are copied in, once).
 * Called when the analysis is opened; a page that shows a running analysis refreshes, so it finishes by itself.
 */
export async function syncAnalysis(deps: VideoDeps, id: number) {
  const { pool, serviceUrl, uploadDir } = deps;
  const { rows } = await pool.query(
    `SELECT a.video_analysis_id, a.service_job_id, a.status, a.created_at, a.camera_id, a.is_synthetic, c.zone_id
     FROM security.video_analyses a LEFT JOIN security.cameras c ON c.camera_id = a.camera_id WHERE a.video_analysis_id = $1`,
    [id],
  );
  const a = rows[0];
  if (!a || a.status !== 'running' || !a.service_job_id || syncing.has(id)) return { reachable: true };
  syncing.add(id);
  try {
    let res: Response;
    try {
      res = await call(serviceUrl, `/jobs/${a.service_job_id}`, {}, 5_000);
    } catch {
      return { reachable: false };
    }
    if (res.status === 404) {
      await markFailed(pool, id, 'The security service was restarted before this analysis finished. Upload the video again.');
      return { reachable: true };
    }
    const job = jobReply.safeParse(await res.json().catch(() => null));
    if (!job.success) return { reachable: true };
    if (job.data.status === 'running') return { reachable: true };
    if (job.data.status !== 'done') {
      await markFailed(pool, id, job.data.error ? `The analysis failed: ${job.data.error}` : 'The analysis was stopped.');
      return { reachable: true };
    }

    // Done: copy the alerts, the snapshots and the browser video into the app
    const jsonl = await call(serviceUrl, `/jobs/${a.service_job_id}/files/alerts.jsonl`);
    const lines = jsonl.ok ? (await jsonl.text()).split('\n').filter(Boolean) : [];
    const alerts = lines.flatMap((l) => {
      const parsed = engineAlert.safeParse(JSON.parse(l));
      return parsed.success ? [parsed.data] : [];
    });
    const folder = path.join('security', 'videos', String(id));
    const snapshotKeys = new Map<string, string>();
    for (const al of alerts) {
      if (!al.snapshot) continue;
      const key = path.join(folder, path.basename(al.snapshot));
      try {
        await download(serviceUrl, `/jobs/${a.service_job_id}/files/${al.snapshot}`, path.join(uploadDir, key));
        snapshotKeys.set(al.alert_id, key);
      } catch (err) {
        logger.warn('security snapshot not copied', { videoAnalysisId: id, error: String(err) });
      }
    }
    let videoKey: string | null = path.join(folder, 'annotated.mp4');
    try {
      await download(serviceUrl, `/jobs/${a.service_job_id}/browser-video`, path.join(uploadDir, videoKey));
    } catch (err) {
      videoKey = null;
      logger.warn('security video not copied', { videoAnalysisId: id, error: String(err) });
    }

    await withTransaction(pool, async (client) => {
      for (const al of alerts) await importAlert(client, a, al, snapshotKeys.get(al.alert_id) ?? null);
      await client.query(
        `UPDATE security.video_analyses SET status = 'done', summary = $2, alert_count = $3, video_key = $4, finished_at = now()
         WHERE video_analysis_id = $1`,
        [id, JSON.stringify(job.data.summary ?? {}), alerts.length, videoKey],
      );
      // A camera whose recording was just analysed is sending pictures again: it is online
      if (a.camera_id && !a.is_synthetic) {
        await client.query(`UPDATE security.cameras SET status = 'online', last_seen_at = now() WHERE camera_id = $1`, [a.camera_id]);
      }
    });
    return { reachable: true };
  } finally {
    syncing.delete(id);
  }
}

async function markFailed(db: Db, id: number, error: string) {
  await db.query(`UPDATE security.video_analyses SET status = 'failed', error = $2, finished_at = now() WHERE video_analysis_id = $1`, [id, error.slice(0, 500)]);
}

/** One engine alert -> a security.alerts row (status open) with its "raised" (and "escalated") timeline entries. */
async function importAlert(
  client: pg.PoolClient,
  a: { video_analysis_id: number; created_at: Date; camera_id: number | null; zone_id: number | null; is_synthetic: boolean },
  al: EngineAlert,
  snapshotKey: string | null,
) {
  const severity = al.severity.toLowerCase() as Severity;
  const t = al.video_time_s ?? 0;
  // The camera clock when a start time was given (service centre time), otherwise upload time + seconds into the clip
  const detectedAt = al.clock_time ? new Date(`${al.clock_time}+05:30`) : new Date(a.created_at.getTime() + t * 1000);
  const reasons = al.reasons.filter((r) => r !== 'base rule');
  const plates = al.affected_vehicles.map((v) => v.plate).filter(Boolean);
  const who = al.person_role ? `${al.person_role === 'worker' ? 'Worker' : 'Visitor'}${al.person_track_id ? ` (track ${al.person_track_id})` : ''}` : null;
  const summary = [
    `Found in a ${a.is_synthetic ? 'synthetic test' : 'recorded'} video at ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
    who,
    al.affected_vehicles.length ? `${al.affected_vehicles.length} ${al.affected_vehicles.length === 1 ? 'vehicle' : 'vehicles'} nearby` : null,
    reasons.length ? reasons.join(', ') : null,
  ].filter(Boolean).join(' · ');

  const { rows: idRows } = await client.query<{ id: number }>(`SELECT nextval(pg_get_serial_sequence('security.alerts', 'alert_id')) AS id`);
  const alertId = idRows[0]!.id;
  const inserted = await client.query(
    `INSERT INTO security.alerts (alert_id, alert_no, threat_type, severity, base_severity, escalation_reasons, confidence,
                                  camera_id, zone_id, detected_at, person_role, persons_involved, persons_affected,
                                  vehicle_id, summary, notify_roles, snapshot_key, status, model_version_id,
                                  video_analysis_id, video_time_s, source_alert_id, is_synthetic)
     SELECT $1, $2, $3::varchar, $4, t.base_severity, $5, $6, $7, $8, $9, $10, $11, $12,
            (SELECT vehicle_id FROM workshop.vehicles WHERE upper(replace(replace(registration_no, ' ', ''), '-', '')) =
               upper(replace(replace($13::text, ' ', ''), '-', '')) LIMIT 1),
            $14, $15, $16, 'open',
            (SELECT model_version_id FROM app.model_versions WHERE component = 'security' AND is_active ORDER BY model_version_id DESC LIMIT 1),
            $17, $18, $19, $20
     FROM security.threat_types t WHERE t.code = $3::varchar
     ON CONFLICT (video_analysis_id, source_alert_id) WHERE video_analysis_id IS NOT NULL DO NOTHING
     RETURNING alert_id, base_severity`,
    [
      alertId, formatAlertNo(alertId, detectedAt), al.threat_type, severity, reasons, al.confidence, a.camera_id, a.zone_id, detectedAt,
      al.person_role ?? null, al.person_track_id != null ? 1 : 0, al.affected_persons, plates[0] ?? null, summary.slice(0, 300),
      al.notify_roles.filter((r) => r !== 'log_only'), snapshotKey, a.video_analysis_id, t, al.alert_id, a.is_synthetic,
    ],
  );
  const row = inserted.rows[0];
  if (!row) return;
  await client.query(`INSERT INTO security.alert_actions (alert_id, action, note, at) VALUES ($1, 'raised', $2, $3)`, [
    alertId, a.is_synthetic ? 'From a synthetic test video (not a real incident)' : 'From recorded video analysis', detectedAt,
  ]);
  if (row.base_severity !== severity) {
    await client.query(`INSERT INTO security.alert_actions (alert_id, action, note, at) VALUES ($1, 'escalated', $2, $3)`, [
      alertId, `Raised from ${row.base_severity} to ${severity}: ${reasons.join(', ')}`, detectedAt,
    ]);
  }
}

/** Asks the service to drop its own copy of a job (upload and outputs). Best effort: the app's copy is already gone. */
export async function removeServiceJob(serviceUrl: string, jobId: string) {
  try {
    await fetch(new URL(`/jobs/${jobId}`, serviceUrl), { method: 'DELETE', signal: AbortSignal.timeout(5_000) });
  } catch {
    logger.warn('security service copy not removed (service not running)', { jobId });
  }
}

export async function removeUpload(filePath: string) {
  await rm(filePath, { force: true });
}
