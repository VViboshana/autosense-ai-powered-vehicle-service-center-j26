import type pg from 'pg';
import type { Db } from '../../db/pool.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../http/pagination.js';
import { getSetting } from '../../lib/settings.js';
import { PLATE_KEY } from '../claims/claims.routes.js';
import { NOTIFICATION_MATRIX, type AlertStatus, type Resolution, type Severity, type ThreatType } from './security.rules.js';

export type Detection = { label: string; confidence: number; bbox: [number, number, number, number] };

export type AlertListItem = {
  alertId: number;
  alertNo: string;
  threatType: ThreatType;
  threatName: string;
  severity: Severity;
  escalated: boolean;
  confidence: number | null;
  camera: string | null;
  zone: string | null;
  detectedAt: string;
  summary: string;
  personsInvolved: number;
  personsAffected: number;
  vehicle: { registrationNo: string; bay: string | null } | null;
  status: AlertStatus;
  resolution: Resolution | null;
};

export type AlertAction = { action: string; note: string | null; by: string | null; at: string };

export type AlertDetail = AlertListItem & {
  threat: { ref: string; detectedBy: string; escalation: string };
  baseSeverity: Severity;
  escalationReasons: string[];
  lastSeenAt: string | null;
  durationS: number | null;
  personRole: 'worker' | 'visitor' | 'unknown' | null;
  cameraInfo: { code: string; name: string; location: string | null; status: 'online' | 'offline' } | null;
  zoneInfo: { code: string; name: string; zoneType: string } | null;
  affectedVehicle: { vehicleId: number; registrationNo: string; description: string; owner: string | null; bay: string | null; jobNo: string | null } | null;
  detections: Detection[];
  notifyRoles: string[];
  hasSnapshot: boolean;
  resolutionNote: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  model: { name: string; version: string } | null;
  actions: AlertAction[];
  /** Set when the alert was found in a recorded video: which analysis, and how many seconds into the clip. */
  video: { videoAnalysisId: number; fileName: string; timeS: number } | null;
};

export type AlertView = 'active' | 'resolved' | 'all';
export type AlertFilter = PageRequest & {
  view: AlertView;
  severity?: Severity;
  threat?: ThreatType;
  cameraId?: number;
  search?: string;
};

const USER_NAME = (alias: string) => `nullif(trim(${alias}.first_name || ' ' || ${alias}.last_name), '')`;
const SEVERITY_RANK = `array_position(ARRAY['low','medium','high','critical']::varchar[], a.severity)`;

const LIST_COLUMNS = `
  a.alert_id, a.alert_no, a.threat_type, t.name AS threat_name, a.severity, a.base_severity, a.confidence,
  cam.name AS camera_name, z.name AS zone_name, a.detected_at, a.summary, a.persons_involved, a.persons_affected,
  v.registration_no, b.name AS bay_name, a.status, a.resolution`;
const LIST_JOINS = `
  FROM security.alerts a
  JOIN security.threat_types t ON t.code = a.threat_type
  LEFT JOIN security.cameras cam ON cam.camera_id = a.camera_id
  LEFT JOIN security.zones z ON z.zone_id = a.zone_id
  LEFT JOIN workshop.vehicles v ON v.vehicle_id = a.vehicle_id
  LEFT JOIN occupancy.bays b ON b.bay_id = a.bay_id`;

function toListItem(r: pg.QueryResultRow): AlertListItem {
  return {
    alertId: r.alert_id,
    alertNo: r.alert_no,
    threatType: r.threat_type,
    threatName: r.threat_name,
    severity: r.severity,
    escalated: r.severity !== r.base_severity,
    confidence: r.confidence,
    camera: r.camera_name,
    zone: r.zone_name,
    detectedAt: r.detected_at,
    summary: r.summary,
    personsInvolved: r.persons_involved,
    personsAffected: r.persons_affected,
    vehicle: r.registration_no ? { registrationNo: r.registration_no, bay: r.bay_name } : null,
    status: r.status,
    resolution: r.resolution,
  };
}

export async function listAlerts(db: Db, f: AlertFilter): Promise<Page<AlertListItem>> {
  const where: string[] = ['true'];
  const params: unknown[] = [];
  const add = (sql: (n: number) => string, value: unknown) => {
    params.push(value);
    where.push(sql(params.length));
  };
  if (f.view === 'active') where.push("a.status <> 'resolved'");
  if (f.view === 'resolved') where.push("a.status = 'resolved'");
  if (f.severity) add((n) => `a.severity = $${n}`, f.severity);
  if (f.threat) add((n) => `a.threat_type = $${n}`, f.threat);
  if (f.cameraId) add((n) => `a.camera_id = $${n}`, f.cameraId);
  if (f.search) {
    // Alert number, or a plate matched without spaces and dashes ("cab4521" finds "WP CAB-4521")
    params.push(`%${f.search}%`, `%${f.search.replace(/[\s-]/g, '').toUpperCase()}%`);
    where.push(`(a.alert_no ILIKE $${params.length - 1} OR ${PLATE_KEY('v.registration_no')} LIKE $${params.length})`);
  }
  const filtered = `${LIST_JOINS} WHERE ${where.join(' AND ')}`;

  // Active alerts are worked most severe first; the history shows the newest first.
  const order = f.view === 'active' ? `${SEVERITY_RANK} DESC, a.detected_at DESC` : 'a.detected_at DESC';
  const total = await db.query(`SELECT count(*) AS n ${filtered}`, params);
  const rows = await db.query(
    `SELECT ${LIST_COLUMNS} ${filtered} ORDER BY ${order}, a.alert_id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, offsetOf(f)],
  );
  return toPage(rows.rows.map(toListItem), total.rows[0].n, f);
}

export async function getAlert(db: Db, id: number): Promise<AlertDetail | null> {
  const head = await db.query(
    `SELECT ${LIST_COLUMNS}, t.ref, t.detected_by, t.escalation, a.escalation_reasons, a.last_seen_at, a.duration_s,
            a.person_role, cam.code AS camera_code, cam.location AS camera_location, cam.status AS camera_status,
            z.code AS zone_code, z.zone_type, a.vehicle_id, v.make || ' ' || v.model || coalesce(' · ' || v.colour, '') AS vehicle_desc,
            cu.full_name AS owner_name, j.job_no, a.detections, a.notify_roles, a.snapshot_key IS NOT NULL AS has_snapshot,
            a.resolution_note, a.acknowledged_at, a.resolved_at, ${USER_NAME('au')} AS acknowledged_by, ${USER_NAME('ru')} AS resolved_by,
            mv.name AS model_name, mv.version AS model_version,
            a.video_analysis_id, a.video_time_s, va.file_name AS video_file_name
     ${LIST_JOINS}
     LEFT JOIN security.video_analyses va ON va.video_analysis_id = a.video_analysis_id
     LEFT JOIN workshop.customers cu ON cu.customer_id = v.customer_id
     LEFT JOIN workshop.jobs j ON j.job_id = a.job_id
     LEFT JOIN app.users au ON au.user_id = a.acknowledged_by
     LEFT JOIN app.users ru ON ru.user_id = a.resolved_by
     LEFT JOIN app.model_versions mv ON mv.model_version_id = a.model_version_id
     WHERE a.alert_id = $1`,
    [id],
  );
  const r = head.rows[0];
  if (!r) return null;

  const actions = await db.query(
    `SELECT x.action, x.note, x.at, ${USER_NAME('u')} AS by
     FROM security.alert_actions x LEFT JOIN app.users u ON u.user_id = x.user_id
     WHERE x.alert_id = $1 ORDER BY x.at, x.action_id`,
    [id],
  );

  return {
    ...toListItem(r),
    threat: { ref: r.ref, detectedBy: r.detected_by, escalation: r.escalation },
    baseSeverity: r.base_severity,
    escalationReasons: r.escalation_reasons,
    lastSeenAt: r.last_seen_at,
    durationS: r.duration_s,
    personRole: r.person_role,
    cameraInfo: r.camera_code ? { code: r.camera_code, name: r.camera_name, location: r.camera_location, status: r.camera_status } : null,
    zoneInfo: r.zone_code ? { code: r.zone_code, name: r.zone_name, zoneType: r.zone_type } : null,
    affectedVehicle: r.vehicle_id
      ? { vehicleId: r.vehicle_id, registrationNo: r.registration_no, description: r.vehicle_desc, owner: r.owner_name, bay: r.bay_name, jobNo: r.job_no }
      : null,
    detections: r.detections,
    notifyRoles: r.notify_roles,
    hasSnapshot: r.has_snapshot,
    resolutionNote: r.resolution_note,
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: r.acknowledged_at,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    model: r.model_name ? { name: r.model_name, version: r.model_version } : null,
    actions: actions.rows.map((a) => ({ action: a.action, note: a.note, by: a.by, at: a.at })),
    video: r.video_analysis_id ? { videoAnalysisId: r.video_analysis_id, fileName: r.video_file_name, timeS: r.video_time_s } : null,
  };
}

/** Where an alert's stored snapshot is, relative to UPLOAD_DIR; null when it has none. */
export async function alertSnapshotKey(db: Db, id: number): Promise<string | null> {
  const { rows } = await db.query<{ snapshot_key: string | null }>('SELECT snapshot_key FROM security.alerts WHERE alert_id = $1', [id]);
  return rows[0]?.snapshot_key ?? null;
}

/** The alert's state, locked for the rest of the transaction (two guards pressing a button at once). */
export async function lockAlert(client: pg.PoolClient, id: number) {
  const { rows } = await client.query<{ status: AlertStatus; severity: Severity; has_vehicle: boolean; alert_no: string }>(
    'SELECT status, severity, vehicle_id IS NOT NULL AS has_vehicle, alert_no FROM security.alerts WHERE alert_id = $1 FOR UPDATE',
    [id],
  );
  const r = rows[0];
  return r ? { status: r.status, severity: r.severity, hasVehicle: r.has_vehicle, alertNo: r.alert_no } : null;
}

export async function addAction(db: Db, id: number, action: string, note: string | null, userId: number) {
  await db.query('INSERT INTO security.alert_actions (alert_id, action, note, user_id) VALUES ($1, $2, $3, $4)', [id, action, note, userId]);
}

export async function acknowledgeAlert(db: Db, id: number, userId: number) {
  await db.query(
    "UPDATE security.alerts SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now() WHERE alert_id = $1",
    [id, userId],
  );
}

/** Resolving an alert that was never acknowledged also acknowledges it, so response times stay complete. */
export async function resolveAlert(db: Db, id: number, resolution: Resolution, note: string | null, userId: number) {
  await db.query(
    `UPDATE security.alerts
     SET status = 'resolved', resolution = $2, resolution_note = $3, resolved_by = $4, resolved_at = now(),
         acknowledged_by = coalesce(acknowledged_by, $4), acknowledged_at = coalesce(acknowledged_at, now())
     WHERE alert_id = $1`,
    [id, resolution, note, userId],
  );
}

export type SecuritySummary = {
  open: Record<Severity, number>;
  acknowledged: number;
  oldestOpenAt: string | null;
  today: { raised: number; resolved: number; falseAlarms: number };
  cameras: { online: number; total: number };
};

/** Figures for the top of the Alerts screen; "today" is the service centre's day (Asia/Colombo). */
export async function securitySummary(db: Db): Promise<SecuritySummary> {
  const { rows } = await db.query(
    `WITH today AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo') AS start)
     SELECT
       count(*) FILTER (WHERE status = 'open' AND severity = 'low')      AS open_low,
       count(*) FILTER (WHERE status = 'open' AND severity = 'medium')   AS open_medium,
       count(*) FILTER (WHERE status = 'open' AND severity = 'high')     AS open_high,
       count(*) FILTER (WHERE status = 'open' AND severity = 'critical') AS open_critical,
       count(*) FILTER (WHERE status = 'acknowledged')                   AS acknowledged,
       min(detected_at) FILTER (WHERE status = 'open')                   AS oldest_open_at,
       count(*) FILTER (WHERE detected_at >= today.start)                AS raised_today,
       count(*) FILTER (WHERE resolved_at >= today.start AND resolution = 'handled')     AS resolved_today,
       count(*) FILTER (WHERE resolved_at >= today.start AND resolution = 'false_alarm') AS false_today,
       (SELECT count(*) FROM security.cameras WHERE is_active AND status = 'online') AS cameras_online,
       (SELECT count(*) FROM security.cameras WHERE is_active)                       AS cameras_total
     FROM security.alerts, today`,
  );
  const r = rows[0];
  return {
    open: { low: r.open_low, medium: r.open_medium, high: r.open_high, critical: r.open_critical },
    acknowledged: r.acknowledged,
    oldestOpenAt: r.oldest_open_at,
    today: { raised: r.raised_today, resolved: r.resolved_today, falseAlarms: r.false_today },
    cameras: { online: r.cameras_online, total: r.cameras_total },
  };
}

export type SecurityCamera = {
  cameraId: number;
  code: string;
  name: string;
  location: string | null;
  zone: { name: string; zoneType: string } | null;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
  activeAlerts: number;
  worstActiveSeverity: Severity | null;
  alertsToday: number;
  lastAlertAt: string | null;
};

export async function listCameras(db: Db): Promise<SecurityCamera[]> {
  const { rows } = await db.query(
    `WITH today AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Colombo') AT TIME ZONE 'Asia/Colombo') AS start)
     SELECT c.camera_id, c.code, c.name, c.location, c.status, c.last_seen_at, z.name AS zone_name, z.zone_type,
            count(a.alert_id) FILTER (WHERE a.status <> 'resolved') AS active_alerts,
            (array_agg(a.severity ORDER BY ${SEVERITY_RANK} DESC) FILTER (WHERE a.status <> 'resolved'))[1] AS worst_active,
            count(a.alert_id) FILTER (WHERE a.detected_at >= today.start) AS alerts_today,
            max(a.detected_at) AS last_alert_at
     FROM security.cameras c
     CROSS JOIN today
     LEFT JOIN security.zones z ON z.zone_id = c.zone_id
     LEFT JOIN security.alerts a ON a.camera_id = c.camera_id
     WHERE c.is_active
     GROUP BY c.camera_id, z.zone_id
     ORDER BY c.code`,
  );
  return rows.map((r) => ({
    cameraId: r.camera_id,
    code: r.code,
    name: r.name,
    location: r.location,
    zone: r.zone_name ? { name: r.zone_name, zoneType: r.zone_type } : null,
    status: r.status,
    lastSeenAt: r.last_seen_at,
    activeAlerts: r.active_alerts,
    worstActiveSeverity: r.worst_active,
    alertsToday: r.alerts_today,
    lastAlertAt: r.last_alert_at,
  }));
}

export type RuleSettings = {
  persistenceSeconds: number;
  minConfidence: number;
  loiteringSeconds: number;
  touchSeconds: number;
  smokeCriticalSeconds: number;
  workerNearbyMetres: number;
  afterHours: { from: string; to: string };
};
export const DEFAULT_RULES: RuleSettings = {
  persistenceSeconds: 2,
  minConfidence: 0.45,
  loiteringSeconds: 120,
  touchSeconds: 10,
  smokeCriticalSeconds: 10,
  workerNearbyMetres: 3,
  afterHours: { from: '19:00', to: '07:00' },
};

/** The threat catalogue, zones, rule thresholds and notification matrix: the Alert rules screen. */
export async function securityRules(db: Db) {
  const threats = await db.query(
    `SELECT code, ref, name, base_severity, detected_by, escalation, notify_roles FROM security.threat_types ORDER BY display_order`,
  );
  const zones = await db.query(
    `SELECT z.code, z.name, z.zone_type, z.description, count(c.camera_id) FILTER (WHERE c.is_active) AS cameras
     FROM security.zones z LEFT JOIN security.cameras c ON c.zone_id = z.zone_id
     WHERE z.is_active GROUP BY z.zone_id ORDER BY z.zone_id`,
  );
  return {
    threats: threats.rows.map((t) => ({
      code: t.code as ThreatType,
      ref: t.ref as string,
      name: t.name as string,
      baseSeverity: t.base_severity as Severity,
      detectedBy: t.detected_by as string,
      escalation: t.escalation as string,
      notifyRoles: t.notify_roles as string[],
    })),
    zones: zones.rows.map((z) => ({ code: z.code, name: z.name, zoneType: z.zone_type, description: z.description, cameras: z.cameras })),
    settings: await getSetting(db, 'security.rules', DEFAULT_RULES),
    notificationMatrix: NOTIFICATION_MATRIX,
  };
}

// ---------------------------------------------------------------- recorded video analysis

export type VideoAnalysisStatus = 'running' | 'done' | 'failed';
export type VideoAnalysis = {
  videoAnalysisId: number;
  fileName: string;
  fileSize: number;
  camera: { cameraId: number; code: string; name: string; zone: string | null };
  startTime: string | null;
  shortTimings: boolean;
  status: VideoAnalysisStatus;
  error: string | null;
  summary: { video_s?: number; processing_s?: number; frames?: number; tracked_people?: number; workers?: number; alerts?: number } | null;
  alertCount: number;
  hasVideo: boolean;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const VIDEO_COLUMNS = `
  va.video_analysis_id, va.file_name, va.file_size, va.start_time, va.short_timings, va.status, va.error, va.summary,
  va.alert_count, va.video_key IS NOT NULL AS has_video, va.created_at, va.finished_at,
  c.camera_id, c.code AS camera_code, c.name AS camera_name, z.name AS zone_name, ${USER_NAME('u')} AS created_by
  FROM security.video_analyses va
  JOIN security.cameras c ON c.camera_id = va.camera_id
  LEFT JOIN security.zones z ON z.zone_id = c.zone_id
  LEFT JOIN app.users u ON u.user_id = va.created_by`;

function toVideo(r: pg.QueryResultRow): VideoAnalysis {
  return {
    videoAnalysisId: r.video_analysis_id,
    fileName: r.file_name,
    fileSize: r.file_size,
    camera: { cameraId: r.camera_id, code: r.camera_code, name: r.camera_name, zone: r.zone_name },
    startTime: r.start_time,
    shortTimings: r.short_timings,
    status: r.status,
    error: r.error,
    summary: r.summary,
    alertCount: r.alert_count,
    hasVideo: r.has_video,
    createdBy: r.created_by,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  };
}

export async function cameraForVideo(db: Db, cameraId: number) {
  const { rows } = await db.query<{ code: string }>('SELECT code FROM security.cameras WHERE camera_id = $1 AND is_active', [cameraId]);
  return rows[0] ?? null;
}

export async function insertVideoAnalysis(
  db: Db,
  v: { cameraId: number; fileName: string; fileSize: number; startTime: string | null; shortTimings: boolean; serviceJobId: string; userId: number },
): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO security.video_analyses (camera_id, file_name, file_size, start_time, short_timings, service_job_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING video_analysis_id AS id`,
    [v.cameraId, v.fileName.slice(0, 200), v.fileSize, v.startTime, v.shortTimings, v.serviceJobId, v.userId],
  );
  return rows[0]!.id;
}

export async function listVideoAnalyses(db: Db, limit = 10): Promise<VideoAnalysis[]> {
  const { rows } = await db.query(`SELECT ${VIDEO_COLUMNS} ORDER BY va.created_at DESC LIMIT $1`, [limit]);
  return rows.map(toVideo);
}

export async function runningVideoIds(db: Db): Promise<number[]> {
  const { rows } = await db.query<{ id: number }>("SELECT video_analysis_id AS id FROM security.video_analyses WHERE status = 'running'");
  return rows.map((r) => r.id);
}

export async function getVideoAnalysis(db: Db, id: number) {
  const { rows } = await db.query(`SELECT ${VIDEO_COLUMNS} WHERE va.video_analysis_id = $1`, [id]);
  if (!rows[0]) return null;
  const alerts = await db.query(
    `SELECT ${LIST_COLUMNS}, a.video_time_s, a.snapshot_key IS NOT NULL AS has_snapshot, a.escalation_reasons, a.person_role
     ${LIST_JOINS} WHERE a.video_analysis_id = $1 ORDER BY a.video_time_s, a.alert_id`,
    [id],
  );
  return {
    ...toVideo(rows[0]),
    alerts: alerts.rows.map((r) => ({
      ...toListItem(r),
      videoTimeS: r.video_time_s as number,
      hasSnapshot: r.has_snapshot as boolean,
      reasons: r.escalation_reasons as string[],
      personRole: r.person_role as string | null,
    })),
  };
}

export async function videoKey(db: Db, id: number): Promise<string | null> {
  const { rows } = await db.query<{ video_key: string | null }>('SELECT video_key FROM security.video_analyses WHERE video_analysis_id = $1', [id]);
  return rows[0]?.video_key ?? null;
}
