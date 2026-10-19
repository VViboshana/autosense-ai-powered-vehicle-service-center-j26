import { describe, expect, it } from 'vitest';
import { repairFor, repairPlan } from './inspections.repair.js';

describe('repair guide for one damaged area', () => {
  it('puts safety damage first whatever its size', () => {
    expect(repairFor('glass_shatter', 'minor').priority).toBe('before_driving');
    expect(repairFor('tire_flat', null).priority).toBe('before_driving');
    expect(repairFor('lamp_broken', 'moderate').priority).toBe('soon');
  });

  it('otherwise follows the severity: severe soon, moderate planned, minor cosmetic', () => {
    expect(repairFor('dent', 'severe').priority).toBe('soon');
    expect(repairFor('scratch', 'moderate').priority).toBe('planned');
    expect(repairFor('scratch', 'minor').priority).toBe('cosmetic');
  });

  it('names the service that fixes each damage type', () => {
    expect(['dent', 'scratch', 'crack'].map((l) => repairFor(l, 'minor').service)).toEqual(['BODY_REPAIR', 'BODY_REPAIR', 'BODY_REPAIR']);
    expect(repairFor('glass_shatter', 'severe').service).toBe('GLASS_REPLACEMENT');
    expect(repairFor('lamp_broken', 'moderate').service).toBe('LIGHTING_REPAIR');
    expect(repairFor('tire_flat', 'severe').service).toBe('TYRE_SERVICE');
  });

  it('estimates effort only for graded damage', () => {
    expect(repairFor('dent', 'severe').effortHours).toEqual([4, 8]);
    expect(repairFor('dent', 'unavailable').effortHours).toBeNull();
    expect(repairFor('dent', null)).toMatchObject({ priority: 'planned', effortHours: null });
  });
});

describe('repair plan for an inspection', () => {
  it('takes the most urgent priority, groups areas by service and adds up the hours', () => {
    // INS-26-000025 after grouping: 9 areas
    const plan = repairPlan([
      { label: 'lamp_broken', severity: 'moderate' },
      { label: 'crack', severity: 'moderate' },
      { label: 'dent', severity: 'moderate' },
      { label: 'dent', severity: 'severe' },
      { label: 'dent', severity: 'moderate' },
      { label: 'crack', severity: 'moderate' },
      { label: 'glass_shatter', severity: 'severe' },
      { label: 'dent', severity: 'severe' },
      { label: 'lamp_broken', severity: 'moderate' },
    ]);
    expect(plan.priority).toBe('before_driving');
    // Most urgent service first (glass), then the most work (body repair before lighting, both "soon")
    expect(plan.services).toEqual([
      { code: 'GLASS_REPLACEMENT', areas: 1, priority: 'before_driving', effortHours: [1.5, 3] },
      { code: 'BODY_REPAIR', areas: 6, priority: 'soon', effortHours: [14, 28] },
      { code: 'LIGHTING_REPAIR', areas: 2, priority: 'soon', effortHours: [1, 3] },
    ]);
    expect(plan.effortHours).toEqual([16.5, 34]);
    expect(plan.validated).toBe(false);
  });

  it('has no priority and no effort when there is no damage', () => {
    expect(repairPlan([])).toMatchObject({ priority: null, services: [], effortHours: null, notEstimated: 0 });
  });

  it('counts areas it could not estimate', () => {
    const plan = repairPlan([{ label: 'dent', severity: 'unavailable' }, { label: 'scratch', severity: 'minor' }]);
    expect(plan.effortHours).toEqual([0.5, 1]);
    expect(plan.notEstimated).toBe(1);
  });
});
