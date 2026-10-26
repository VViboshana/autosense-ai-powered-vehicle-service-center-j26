import { PRIORITIES, sumHours, type Priority } from './inspections.repair.js';
import { SOUND_FAULTS, type SoundLabel, type SoundSituation } from './inspections.sound.js';

/**
 * Mechanical repair guide (sound-repair-v0): from a sound finding's final fault (after the technician's review) to a
 * priority, the service that fixes it (a workshop.service_types code) and an estimated effort in workshop hours.
 * Kept apart from the body-damage plan (repair-v0): a different kind of work, often a different technician.
 * PROPOSED rules and hours, not yet confirmed by the service centre's technician: a guide, never a quote.
 */
export const MECHANICAL_METHOD = 'sound-repair-v0';
export const MECHANICAL_VALIDATED = false;

type Hours = [number, number];
type Rule = { priority: Priority; why: string; service: string; effortHours: Hours };

/** Per fault: priority, service, proposed hours (normal sounds have no rule). Also used by the forecast hand-over. */
export const MECHANICAL_RULES: Partial<Record<SoundLabel, Rule>> = {
  worn_brakes: { priority: 'before_driving', why: 'Worn brakes make the vehicle unsafe to drive.', service: 'BRAKE_SERVICE', effortHours: [1.5, 2.5] },
  low_oil: { priority: 'before_driving', why: 'Driving with low oil can damage the engine.', service: 'OIL_CHANGE', effortHours: [0.5, 1] },
  misfire: { priority: 'soon', why: 'A misfire wastes fuel and can damage the catalytic converter.', service: 'ENGINE_REPAIR', effortHours: [1, 3] },
  bad_ignition: { priority: 'soon', why: 'The vehicle may fail to start.', service: 'ENGINE_REPAIR', effortHours: [1, 2] },
  dead_battery: { priority: 'soon', why: 'The vehicle may fail to start.', service: 'BATTERY_SERVICE', effortHours: [0.5, 1] },
  power_steering: { priority: 'soon', why: 'Steering can become heavy or fail.', service: 'STEERING_SERVICE', effortHours: [1, 2] },
  serpentine_belt: { priority: 'soon', why: 'A failing belt can stop the alternator, water pump and steering pump.', service: 'BELT_REPLACEMENT', effortHours: [0.5, 1.5] },
  tappet: { priority: 'planned', why: 'Valve noise: adjust before it causes wear.', service: 'ENGINE_REPAIR', effortHours: [1, 3] },
};

export type MechanicalItem = { situation: SoundSituation; label: SoundLabel; name: string } & Rule;

export type MechanicalPlan = {
  method: string;
  validated: boolean;
  /** The most urgent priority, or null when every sound was normal (or there were none) */
  priority: Priority | null;
  /** One per fault heard, most urgent first */
  items: MechanicalItem[];
  services: { code: string; faults: number; priority: Priority; effortHours: Hours | null }[];
  effortHours: Hours | null;
};

/** The plan from the final sound findings (normal results need nothing). */
export function mechanicalPlan(findings: { situation: SoundSituation; label: SoundLabel }[]): MechanicalPlan {
  const items: MechanicalItem[] = findings
    .filter((f) => MECHANICAL_RULES[f.label])
    .map((f) => ({ situation: f.situation, label: f.label, name: SOUND_FAULTS[f.label].name, ...MECHANICAL_RULES[f.label]! }))
    .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));
  const codes = [...new Set(items.map((i) => i.service))];
  return {
    method: MECHANICAL_METHOD,
    validated: MECHANICAL_VALIDATED,
    priority: items[0]?.priority ?? null,
    items,
    services: codes.map((code) => {
      const mine = items.filter((i) => i.service === code);
      return { code, faults: mine.length, priority: mine[0]!.priority, effortHours: sumHours(mine.map((i) => i.effortHours)) };
    }),
    effortHours: sumHours(items.map((i) => i.effortHours)),
  };
}
