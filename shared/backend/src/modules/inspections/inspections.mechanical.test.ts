import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mechanicalPlan } from './inspections.mechanical.js';
import { SOUND_FAULTS, SOUND_LABELS } from './inspections.sound.js';

describe('mechanical repair guide (sound-repair-v0)', () => {
  it('needs nothing when every sound was normal', () => {
    const plan = mechanicalPlan([{ situation: 'idling', label: 'normal_idle' }, { situation: 'braking', label: 'normal_brakes' }]);
    expect(plan).toMatchObject({ priority: null, items: [], services: [], effortHours: null, validated: false });
  });

  it('puts worn brakes first, before driving, and adds the hours up', () => {
    const plan = mechanicalPlan([{ situation: 'idling', label: 'tappet' }, { situation: 'braking', label: 'worn_brakes' }]);
    expect(plan.priority).toBe('before_driving');
    expect(plan.items.map((i) => i.label)).toEqual(['worn_brakes', 'tappet']);
    expect(plan.effortHours).toEqual([2.5, 5.5]);
  });

  it('groups faults that the same service fixes', () => {
    const plan = mechanicalPlan([{ situation: 'starting', label: 'bad_ignition' }, { situation: 'idling', label: 'misfire' }]);
    expect(plan.services).toEqual([{ code: 'ENGINE_REPAIR', faults: 2, priority: 'soon', effortHours: [2, 5] }]);
  });

  it('has a rule for every fault and none for the normal classes', () => {
    for (const label of SOUND_LABELS) {
      const plan = mechanicalPlan([{ situation: SOUND_FAULTS[label].situation, label }]);
      expect(plan.items.length).toBe(SOUND_FAULTS[label].normal ? 0 : 1);
    }
  });

  it('only uses services that exist in the reference list', () => {
    const sql = readFileSync(new URL('../../../../database/reference/040_service_types.sql', import.meta.url), 'utf8');
    const codes = new Set([...sql.matchAll(/\('([A-Z_]+)',/g)].map((m) => m[1]));
    for (const label of SOUND_LABELS) {
      for (const s of mechanicalPlan([{ situation: SOUND_FAULTS[label].situation, label }]).services) expect(codes).toContain(s.code);
    }
  });
});
