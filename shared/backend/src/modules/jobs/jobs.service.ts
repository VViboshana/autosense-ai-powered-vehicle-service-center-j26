import type pg from 'pg';
import { withTransaction } from '../../db/pool.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../http/errors.js';
import { audit } from '../../lib/audit.js';
import { centreTimeZone, nowInZone } from '../bookings/bookingRules.js';
import * as repo from './jobs.repository.js';
import { IN_BAY_STAGES, type JobStage } from './jobs.repository.js';

/**
 * The service flow (migration 0012): check-in creates the job and puts it in the queue; the occupancy module moves it
 * into a bay (staff confirm the camera's suggestion); from the bay it goes to damage inspection (component 2), is
 * finished and collected. Every change is a staff action, written to job_stage_history and the audit log.
 *
 *   checked_in -> waiting_for_bay -> in_bay -> inspecting -> inspected -> ready -> completed   (or cancelled)
 */

/** The stage actions staff take on a job: where each may start from and where it goes. */
export const ACTIONS = {
  send_to_inspection: { from: ['in_bay'], to: 'inspecting', note: 'Sent for damage inspection' },
  work_done: { from: IN_BAY_STAGES, to: 'ready', note: 'Work done' },
  collected: { from: ['ready'], to: 'completed', note: 'Collected by the customer' },
  cancel: { from: ['checked_in', 'waiting_for_bay', 'in_bay', 'inspecting', 'inspected', 'ready'], to: 'cancelled', note: 'Cancelled' },
} as const satisfies Record<string, { from: readonly JobStage[]; to: JobStage; note: string }>;
export type JobAction = keyof typeof ACTIONS;

export const centreToday = async (pool: pg.Pool) => nowInZone(await centreTimeZone(pool)).date;

export type CheckIn =
  | { bookingId: number; serviceTypeId?: number; customerNotes?: string | null }
  | { vehicleId: number; serviceTypeId: number; customerNotes?: string | null };

/**
 * Checks a vehicle in: from one of today's bookings (a pending one is confirmed on the spot) or as a walk-in for a
 * vehicle on record. Creates the job in the queue (waiting_for_bay), with the signed-in user as advisor.
 */
export async function checkIn(pool: pg.Pool, input: CheckIn, userId: number) {
  const today = await centreToday(pool);
  return withTransaction(pool, async (client) => {
    let vehicleId: number;
    let customerId: number | null;
    let serviceTypeId: number;
    let notes: string | null;
    let note: string;
    let booking: { id: number; no: string } | null = null;

    if ('bookingId' in input) {
      const b = await repo.lockBookingForCheckIn(client, input.bookingId, today);
      if (!b) throw new NotFoundError('This booking is not open for today (already checked in, cancelled or another day). Refresh the list.');
      ({ vehicle_id: vehicleId, customer_id: customerId } = b);
      serviceTypeId = input.serviceTypeId ?? b.service_type_id;
      notes = input.customerNotes !== undefined ? input.customerNotes : b.customer_notes;
      note = `Checked in from booking ${b.booking_no}`;
      booking = { id: input.bookingId, no: b.booking_no };
    } else {
      const v = await repo.vehicleOwner(client, input.vehicleId);
      if (!v) throw new NotFoundError('That vehicle is not on record.');
      vehicleId = input.vehicleId;
      customerId = v.customerId;
      serviceTypeId = input.serviceTypeId;
      notes = input.customerNotes ?? null;
      note = 'Checked in as a walk-in';
    }

    const open = await repo.openJobOf(client, vehicleId);
    if (open) throw new ConflictError('VEHICLE_ALREADY_CHECKED_IN', `This vehicle is already at the centre (${open}).`);

    let job: { jobId: number; jobNo: string };
    try {
      job = await repo.insertJob(client, { vehicleId, customerId, serviceTypeId, advisorId: userId, customerNotes: notes, note });
    } catch (err) {
      if (err instanceof Error && err.message === 'SERVICE_TYPE_INACTIVE') throw new BusinessRuleError('SERVICE_TYPE_INACTIVE', 'That service is not offered any more. Pick another.');
      throw err;
    }
    if (booking) await repo.markBookingCheckedIn(client, booking.id, job.jobId, userId);
    await audit(client, {
      table: 'workshop.jobs', recordId: job.jobId, action: 'check_in', userId,
      snapshot: { jobNo: job.jobNo, vehicleId, serviceTypeId, bookingNo: booking?.no ?? null },
    });
    return job;
  });
}

/**
 * One stage action on a job. `work_done` without a confirmed damage inspection is refused with NO_CONFIRMED_INSPECTION
 * unless `anyway` is set: a warning the user can accept, not a block (decision 20/10/2026).
 */
export async function changeStage(pool: pg.Pool, input: { jobId: number; action: JobAction; note?: string | null; anyway?: boolean; userId: number }) {
  const a = ACTIONS[input.action];
  if (input.action === 'cancel' && !input.note) throw new BusinessRuleError('NOTE_REQUIRED', 'Say why the job is cancelled.');
  return withTransaction(pool, async (client) => {
    if (input.action === 'work_done' && !input.anyway && !(await repo.hasConfirmedInspection(client, input.jobId))) {
      throw new BusinessRuleError('NO_CONFIRMED_INSPECTION', 'This vehicle has no confirmed damage inspection yet. Mark the work done anyway?');
    }
    const jobNo = await repo.moveStage(client, {
      jobId: input.jobId, from: a.from, to: a.to, userId: input.userId,
      note: input.note ? `${a.note}: ${input.note}` : a.note,
    });
    if (!jobNo) throw new BusinessRuleError('STAGE_CHANGED', 'This job has moved on since you opened it. Refresh to see where it is now.');
    await audit(client, { table: 'workshop.jobs', recordId: input.jobId, action: input.action, userId: input.userId, snapshot: { to: a.to, note: input.note ?? null } });
    return { jobId: input.jobId, jobNo, stage: a.to };
  });
}
