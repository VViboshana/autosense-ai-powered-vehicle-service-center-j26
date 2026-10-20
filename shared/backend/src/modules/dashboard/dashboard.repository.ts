import type { Db } from '../../db/pool.js';
import { LOCAL_DAY } from '../../db/sql.js';

export type DashboardSummary = {
  vehiclesToday: number;
  vehiclesSameTimeLastWeek: number;
  bays: { total: number; occupied: number; free: number; uncertain: number };
  awaitingReview: { count: number; oldestAt: string | null };
  timeInBay: { averageMinutes: number | null; jobsDone: number };
};

export async function getSummary(db: Db): Promise<DashboardSummary> {
  const { rows } = await db.query(
    `${LOCAL_DAY}
     SELECT
       (SELECT count(*) FROM workshop.jobs j, day
         WHERE j.checked_in_at >= day.start AND j.checked_in_at < day.start + interval '1 day' AND j.stage <> 'cancelled') AS vehicles_today,
       (SELECT count(*) FROM workshop.jobs j, day
         WHERE j.checked_in_at >= day.start - interval '7 days' AND j.checked_in_at < now() - interval '7 days'
           AND j.stage <> 'cancelled') AS same_time_last_week,
       (SELECT count(*) FROM occupancy.bays b WHERE b.is_active) AS bays_total,
       (SELECT count(*) FILTER (WHERE s.state = 'occupied')  FROM occupancy.bays b JOIN occupancy.bay_status s USING (bay_id) WHERE b.is_active) AS bays_occupied,
       (SELECT count(*) FILTER (WHERE s.state = 'free')      FROM occupancy.bays b JOIN occupancy.bay_status s USING (bay_id) WHERE b.is_active) AS bays_free,
       (SELECT count(*) FILTER (WHERE s.state = 'uncertain') FROM occupancy.bays b JOIN occupancy.bay_status s USING (bay_id) WHERE b.is_active) AS bays_uncertain,
       (SELECT count(*) FROM damage.inspections WHERE status = 'awaiting_review') AS awaiting_review,
       (SELECT min(created_at) FROM damage.inspections WHERE status = 'awaiting_review') AS oldest_awaiting_at,
       (SELECT round(avg(extract(epoch FROM (j.ready_at - j.bay_entered_at)) / 60)) FROM workshop.jobs j, day
         WHERE j.ready_at >= day.start AND j.bay_entered_at IS NOT NULL) AS avg_bay_minutes,
       (SELECT count(*) FROM workshop.jobs j, day WHERE j.ready_at >= day.start) AS jobs_done`,
  );
  const r = rows[0];
  return {
    vehiclesToday: r.vehicles_today,
    vehiclesSameTimeLastWeek: r.same_time_last_week,
    bays: { total: r.bays_total, occupied: r.bays_occupied, free: r.bays_free, uncertain: r.bays_uncertain },
    awaitingReview: { count: r.awaiting_review, oldestAt: r.oldest_awaiting_at },
    timeInBay: { averageMinutes: r.avg_bay_minutes, jobsDone: r.jobs_done },
  };
}

export type BayCard = {
  bayId: number;
  code: string;
  name: string;
  /** The camera that watches this bay (null when none is set) */
  camera: { cameraId: number; code: string; name: string } | null;
  state: 'free' | 'occupied' | 'uncertain' | 'unknown';
  since: string | null;
  overlap: number | null;
  job: {
    jobId: number;
    jobNo: string;
    /** in_bay, inspecting or inspected (the stages in which the vehicle is in its bay) */
    stage: 'in_bay' | 'inspecting' | 'inspected';
    /** The job's latest damage inspection (component 2), or null when none was started */
    inspectionStatus: 'draft' | 'processing' | 'awaiting_review' | 'confirmed' | 'failed' | null;
    registrationNo: string;
    vehicle: string;
    service: string;
    bayEnteredAt: string | null;
    estimatedMinutes: number | null;
  } | null;
};

export type BayBoard = {
  camera: { code: string; name: string; status: 'online' | 'offline' } | null;
  bays: BayCard[];
  nextInQueue: { jobNo: string; registrationNo: string; vehicle: string; waitingSince: string } | null;
};

export async function getBayBoard(db: Db): Promise<BayBoard> {
  const bays = await db.query(
    `SELECT b.bay_id, b.code, b.name, b.camera_id, s.state, s.since, s.overlap,
            cam.code AS camera_code, cam.name AS camera_name, cam.status AS camera_status,
            j.job_id, j.job_no, j.stage AS job_stage, v.registration_no, v.make || ' ' || v.model AS vehicle, st.name AS service,
            j.bay_entered_at, j.estimated_minutes,
            (SELECT i.status FROM damage.inspections i WHERE i.job_id = j.job_id ORDER BY i.created_at DESC LIMIT 1) AS inspection_status
     FROM occupancy.bays b
     LEFT JOIN occupancy.cameras cam ON cam.camera_id = b.camera_id
     LEFT JOIN occupancy.bay_status s ON s.bay_id = b.bay_id
     LEFT JOIN LATERAL (
       SELECT * FROM workshop.jobs jj WHERE jj.bay_id = b.bay_id AND jj.stage IN ('in_bay', 'inspecting', 'inspected')
       ORDER BY jj.bay_entered_at DESC LIMIT 1
     ) j ON true
     LEFT JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     LEFT JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
     WHERE b.is_active
     ORDER BY b.display_order, b.code`,
  );
  const next = await db.query(
    `SELECT j.job_no, v.registration_no, v.make || ' ' || v.model AS vehicle, j.checked_in_at
     FROM workshop.jobs j JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
     WHERE j.stage = 'waiting_for_bay'
     ORDER BY j.checked_in_at
     LIMIT 1`,
  );

  const first = bays.rows[0];
  const n = next.rows[0];
  return {
    camera: first?.camera_code ? { code: first.camera_code, name: first.camera_name, status: first.camera_status } : null,
    bays: bays.rows.map((r) => ({
      bayId: r.bay_id,
      code: r.code,
      name: r.name,
      camera: r.camera_code ? { cameraId: r.camera_id, code: r.camera_code, name: r.camera_name } : null,
      state: r.state ?? 'unknown',
      since: r.since,
      overlap: r.overlap,
      job: r.job_no
        ? {
            jobId: r.job_id,
            jobNo: r.job_no,
            stage: r.job_stage,
            inspectionStatus: r.inspection_status,
            registrationNo: r.registration_no,
            vehicle: r.vehicle,
            service: r.service,
            bayEnteredAt: r.bay_entered_at,
            estimatedMinutes: r.estimated_minutes,
          }
        : null,
    })),
    nextInQueue: n ? { jobNo: n.job_no, registrationNo: n.registration_no, vehicle: n.vehicle, waitingSince: n.checked_in_at } : null,
  };
}

export type ActionItem = {
  key: 'safety_alerts' | 'inspection_review' | 'maintenance_suggestions' | 'waiting_for_bay' | 'vehicle_requests' | 'cameras_offline';
  /** False while the component that owns this queue is not connected yet. */
  connected: boolean;
  count: number;
  detail: string | null;
  at: string | null;
};

export async function getActions(db: Db): Promise<ActionItem[]> {
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*) FROM damage.inspections WHERE status = 'awaiting_review') AS review_count,
       (SELECT inspection_no FROM damage.inspections WHERE status = 'awaiting_review' ORDER BY created_at LIMIT 1) AS review_oldest_no,
       (SELECT min(created_at) FROM damage.inspections WHERE status = 'awaiting_review') AS review_oldest_at,
       (SELECT count(*) FROM workshop.jobs WHERE stage = 'waiting_for_bay') AS waiting_count,
       (SELECT min(checked_in_at) FROM workshop.jobs WHERE stage = 'waiting_for_bay') AS waiting_since,
       (SELECT count(*) FROM workshop.vehicle_claims WHERE status = 'pending') AS claims_count,
       (SELECT min(requested_at) FROM workshop.vehicle_claims WHERE status = 'pending') AS claims_oldest,
       (SELECT count(*) FROM occupancy.cameras WHERE is_active AND status = 'offline') AS offline_count,
       (SELECT name FROM occupancy.cameras WHERE is_active AND status = 'offline' ORDER BY last_seen_at NULLS FIRST LIMIT 1) AS offline_name,
       (SELECT last_seen_at FROM occupancy.cameras WHERE is_active AND status = 'offline' ORDER BY last_seen_at NULLS FIRST LIMIT 1) AS offline_since`,
  );
  const r = rows[0];
  return [
    { key: 'safety_alerts', connected: false, count: 0, detail: null, at: null },
    { key: 'inspection_review', connected: true, count: r.review_count, detail: r.review_oldest_no, at: r.review_oldest_at },
    { key: 'maintenance_suggestions', connected: false, count: 0, detail: null, at: null },
    { key: 'waiting_for_bay', connected: true, count: r.waiting_count, detail: null, at: r.waiting_since },
    { key: 'vehicle_requests', connected: true, count: r.claims_count, detail: null, at: r.claims_oldest },
    { key: 'cameras_offline', connected: true, count: r.offline_count, detail: r.offline_name, at: r.offline_since },
  ];
}
