import { describe, expect, it } from 'vitest';
import { inspectionHandover, type HandoverInput } from './inspections.handover.js';

const base: HandoverInput = {
  inspectionId: 44,
  inspectionNo: 'INS-26-000044',
  status: 'confirmed',
  reviewedAt: '2026-10-26T10:00:00Z',
  vehicle: { vehicleId: 7, registrationNo: 'KP-0683' },
  jobId: 12,
  overallSeverity: 'moderate',
  areas: [],
  sounds: [],
  serviceNames: { TYRE_SERVICE: 'Tyre service', BRAKE_SERVICE: 'Brake service', LIGHTING_REPAIR: 'Lighting repair' },
  methods: { severity: 'rule-v0', repair: 'repair-v0', mechanical: 'sound-repair-v0' },
};

describe('hand-over to maintenance forecasting (inspection-handover-v1)', () => {
  it('says a clean vehicle is safe, with nothing to do', () => {
    const h = inspectionHandover({ ...base, sounds: [{ situation: 'idling', label: 'normal_idle' }] });
    expect(h.safeToDrive).toEqual({ safe: true, reasons: [] });
    expect(h.categoryHints).toEqual([]);
    expect(h.parts).toEqual([]);
    expect(h.work.totalHours).toBeNull();
    expect(h.diagnosis).toBe('Damage inspection INS-26-000044 (technician-confirmed). No damage and no fault sounds found.');
  });

  it('is not safe to drive with a flat tyre or worn brakes, and says why', () => {
    const h = inspectionHandover({
      ...base,
      areas: [{ label: 'tire_flat', severity: 'severe', where: 'Left front tyre' }, { label: 'lamp_broken', severity: 'moderate', where: 'Right headlight' }],
      sounds: [{ situation: 'braking', label: 'worn_brakes' }],
    });
    expect(h.safeToDrive.safe).toBe(false);
    expect(h.safeToDrive.reasons).toEqual(['Flat tyre (left front tyre)', 'Worn brakes (heard while braking)']);
  });

  it('maps sound faults to the forecast model categories', () => {
    const h = inspectionHandover({
      ...base,
      sounds: [
        { situation: 'starting', label: 'dead_battery' },
        { situation: 'idling', label: 'misfire' },
        { situation: 'braking', label: 'worn_brakes' },
      ],
    });
    expect(h.categoryHints.map((c) => c.category)).toEqual(['Brakes', 'Battery', 'Engine']);
    expect(h.categoryHints.find((c) => c.category === 'Engine')!.because).toEqual(['Engine misfire']);
  });

  it('adds body and mechanical hours, and lists the likely parts', () => {
    const h = inspectionHandover({
      ...base,
      areas: [{ label: 'lamp_broken', severity: 'moderate', where: 'Right headlight' }, { label: 'scratch', severity: 'minor', where: 'Front bumper, left side' }],
      sounds: [{ situation: 'braking', label: 'worn_brakes' }],
    });
    expect(h.work.bodyHours).toEqual([1, 2.5]);
    expect(h.work.mechanicalHours).toEqual([1.5, 2.5]);
    expect(h.work.totalHours).toEqual([2.5, 5]);
    expect(h.work.services.map((s) => [s.code, s.kind, s.name])).toEqual([
      ['LIGHTING_REPAIR', 'body', 'Lighting repair'],
      ['BODY_REPAIR', 'body', 'BODY_REPAIR'],
      ['BRAKE_SERVICE', 'mechanical', 'Brake service'],
    ]);
    // a minor scratch needs no part
    expect(h.parts.map((p) => p.part)).toEqual(['Lamp unit', 'Brake pads']);
  });

  it('counts the same part once with its quantity', () => {
    const h = inspectionHandover({
      ...base,
      areas: [{ label: 'lamp_broken', severity: 'moderate', where: 'Left headlight' }, { label: 'lamp_broken', severity: 'moderate', where: 'Right tail light' }],
    });
    expect(h.parts).toEqual([{ part: 'Lamp unit', quantity: 2, for: ['Broken lamp, left headlight', 'Broken lamp, right tail light'], kind: 'body' }]);
    expect(h.diagnosis).toContain('Body damage: broken lamp x2 (left headlight; right tail light).');
  });

  it('writes a diagnosis the forecast can read, sounds first, and marks a draft', () => {
    const h = inspectionHandover({
      ...base,
      status: 'awaiting_review',
      areas: [{ label: 'dent', severity: 'moderate', where: 'Rear bumper, left side' }],
      sounds: [{ situation: 'idling', label: 'tappet' }],
    });
    expect(h.final).toBe(false);
    expect(h.confirmedAt).toBeNull();
    expect(h.diagnosis).toBe(
      'Damage inspection INS-26-000044 (draft, not yet confirmed). Heard: tappet (valve) noise (while idling). Body damage: dent (rear bumper, left side).',
    );
  });
});
