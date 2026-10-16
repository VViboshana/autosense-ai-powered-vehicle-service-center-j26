import type { Db } from '../../db/pool.js';
import { LOCAL_DAY } from '../../db/sql.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../http/pagination.js';

export const JOB_STAGES = ['checked_in', 'inspected', 'waiting_for_bay', 'in_bay', 'ready', 'completed', 'cancelled'] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export type JobListItem = {
  jobId: number;
  jobNo: string;
  registrationNo: string;
  vehicle: string;
  customer: string | null;
  service: string;
  stage: JobStage;
  bay: string | null;
  checkedInAt: string;
  estimatedMinutes: number | null;
  estimateLkr: number | null;
  advisor: string | null;
};

export type JobFilter = PageRequest & { scope: 'today' | 'open'; search?: string; stage?: JobStage };

export async function listJobs(db: Db, f: JobFilter): Promise<Page<JobListItem>> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (f.scope === 'today') where.push(`j.checked_in_at >= day.start AND j.checked_in_at < day.start + interval '1 day'`);
  else where.push(`j.stage NOT IN ('completed', 'cancelled')`);
  if (f.stage) add('j.stage = ?', f.stage);
  if (f.search) {
    // Plates are matched without spaces and dashes, so "cab4521" finds "WP CAB-4521".
    params.push(`%${f.search.replace(/[\s-]/g, '').toUpperCase()}%`, `%${f.search}%`);
    where.push(
      `(upper(replace(replace(v.registration_no, ' ', ''), '-', '')) LIKE $${params.length - 1} OR c.full_name ILIKE $${params.length})`,
    );
  }

  const from = `
    FROM workshop.jobs j
    CROSS JOIN day
    JOIN workshop.vehicles v ON v.vehicle_id = j.vehicle_id
    JOIN workshop.service_types st ON st.service_type_id = j.service_type_id
    LEFT JOIN workshop.customers c ON c.customer_id = j.customer_id
    LEFT JOIN occupancy.bays b ON b.bay_id = j.bay_id
    LEFT JOIN app.users u ON u.user_id = j.advisor_user_id
    WHERE ${where.join(' AND ')}`;

  const total = await db.query(`${LOCAL_DAY} SELECT count(*) AS n ${from}`, params);
  const page = await db.query(
    `${LOCAL_DAY}
     SELECT j.job_id, j.job_no, v.registration_no,
            v.make || ' ' || v.model || coalesce(' · ' || v.year, '') AS vehicle,
            c.full_name AS customer, st.name AS service, j.stage, b.name AS bay, j.checked_in_at,
            j.estimated_minutes, j.estimate_lkr,
            u.first_name || ' ' || left(u.last_name, 1) || '.' AS advisor
     ${from}
     ORDER BY j.checked_in_at, j.job_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, f.pageSize, offsetOf(f)],
  );

  return toPage(
    page.rows.map((r) => ({
      jobId: r.job_id,
      jobNo: r.job_no,
      registrationNo: r.registration_no,
      vehicle: r.vehicle,
      customer: r.customer,
      service: r.service,
      stage: r.stage,
      bay: r.bay,
      checkedInAt: r.checked_in_at,
      estimatedMinutes: r.estimated_minutes,
      estimateLkr: r.estimate_lkr,
      advisor: r.advisor,
    })),
    total.rows[0].n,
    f,
  );
}
