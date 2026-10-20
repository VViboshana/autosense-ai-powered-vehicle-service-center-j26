import { describe, expect, it } from 'vitest';
import { BAY_READY_STAGES } from '../occupancy/occupancy.repository.js';
import { IN_BAY_STAGES, JOB_STAGES } from './jobs.repository.js';
import { actionBody, checkInBody } from './jobs.routes.js';
import { ACTIONS } from './jobs.service.js';

describe('check-in input', () => {
  it('takes a booking, or a vehicle with its service for a walk-in', () => {
    expect(checkInBody.parse({ bookingId: 4 })).toEqual({ bookingId: 4, customerNotes: null });
    expect(checkInBody.parse({ bookingId: 4, serviceTypeId: 2, customerNotes: ' rattle at the back ' }))
      .toEqual({ bookingId: 4, serviceTypeId: 2, customerNotes: 'rattle at the back' });
    expect(checkInBody.parse({ vehicleId: 7, serviceTypeId: 2 })).toEqual({ vehicleId: 7, serviceTypeId: 2, customerNotes: null });
  });

  it('refuses a walk-in without a service, and anything that is neither', () => {
    expect(checkInBody.safeParse({ vehicleId: 7 }).success).toBe(false);
    expect(checkInBody.safeParse({}).success).toBe(false);
  });
});

describe('the service flow', () => {
  it('lists the stages in flow order, with inspection inside the bay', () => {
    expect(JOB_STAGES).toEqual(['checked_in', 'waiting_for_bay', 'in_bay', 'inspecting', 'inspected', 'ready', 'completed', 'cancelled']);
    expect(IN_BAY_STAGES).toEqual(['in_bay', 'inspecting', 'inspected']);
  });

  it('only moves jobs forward along the agreed steps', () => {
    expect(ACTIONS.send_to_inspection).toMatchObject({ from: ['in_bay'], to: 'inspecting' });
    expect(ACTIONS.work_done.from).toEqual(IN_BAY_STAGES);
    expect(ACTIONS.work_done.to).toBe('ready');
    expect(ACTIONS.collected).toMatchObject({ from: ['ready'], to: 'completed' });
    expect(ACTIONS.cancel.from).not.toContain('completed');
    expect(ACTIONS.cancel.from).not.toContain('cancelled');
  });

  it('never offers an inspected or in-bay job for a bay again', () => {
    for (const s of IN_BAY_STAGES) expect(BAY_READY_STAGES as readonly string[]).not.toContain(s);
    expect(BAY_READY_STAGES).toEqual(['waiting_for_bay', 'checked_in']);
  });

  it('accepts a note and the "anyway" answer to the inspection warning', () => {
    expect(actionBody.parse({})).toEqual({ note: null });
    expect(actionBody.parse({ note: ' customer left ', anyway: true })).toEqual({ note: 'customer left', anyway: true });
  });
});
