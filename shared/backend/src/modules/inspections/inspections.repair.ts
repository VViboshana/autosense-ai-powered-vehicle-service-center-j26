/**
 * Repair guide (repair-v0): from a damaged area's final damage type and severity (after the technician's review) to
 *   - a repair priority (how urgent),
 *   - the service category that fixes it (a workshop.service_types code), and
 *   - an estimated repair effort in workshop hours (a range).
 *
 * Fixed, readable rules, so every suggestion can be explained. The technician controls them through the damage type
 * and severity they confirm or correct. The effort ranges are PROPOSED (typical body-shop times) and not yet confirmed
 * by the service centre's technician: shown as a guide, never as a quote. See
 * member-2-damage-assessment/docs/severity-and-repair-guide.md.
 */
export const REPAIR_METHOD = 'repair-v0';
export const REPAIR_VALIDATED = false;

export const PRIORITIES = ['before_driving', 'soon', 'planned', 'cosmetic'] as const;
export type Priority = (typeof PRIORITIES)[number];

type Hours = [number, number];

const SERVICE: Record<string, string> = {
  dent: 'BODY_REPAIR',
  scratch: 'BODY_REPAIR',
  crack: 'BODY_REPAIR',
  glass_shatter: 'GLASS_REPLACEMENT',
  lamp_broken: 'LIGHTING_REPAIR',
  tire_flat: 'TYRE_SERVICE',
};

/** Proposed workshop hours for one damaged area, by damage type and severity (to be confirmed by the technician). */
const EFFORT: Record<string, Partial<Record<string, Hours>>> = {
  dent: { minor: [0.5, 1], moderate: [1.5, 3], severe: [4, 8] }, // paintless repair / filler and refinish / panel replacement
  scratch: { minor: [0.5, 1], moderate: [1.5, 3], severe: [3, 5] }, // polish / refinish the panel / repaint several panels
  crack: { minor: [0.5, 1], moderate: [1.5, 3], severe: [2, 4] }, // plastic repair and refinish / replace the bumper or panel
  glass_shatter: { minor: [1.5, 3], moderate: [1.5, 3], severe: [1.5, 3] }, // replace the glass, including adhesive curing
  lamp_broken: { minor: [0.5, 1.5], moderate: [0.5, 1.5], severe: [0.5, 1.5] }, // replace the lamp unit
  tire_flat: { minor: [0.3, 0.75], moderate: [0.3, 0.75], severe: [0.3, 0.75] }, // repair the puncture or fit a new tyre
};

/** Damage types that make the vehicle unsafe whatever their size, and why (the same as the severity rule's overrides). */
const SAFETY: Record<string, { priority: Priority; why: string }> = {
  glass_shatter: { priority: 'before_driving', why: 'Shattered glass affects visibility.' },
  tire_flat: { priority: 'before_driving', why: 'The vehicle is not safe to drive on a flat tyre.' },
  lamp_broken: { priority: 'soon', why: 'A working lamp is needed for the vehicle to be roadworthy.' },
};

export type AreaRepair = { priority: Priority; why: string; service: string | null; effortHours: Hours | null };

/** The repair guide for one damaged area. A severity of null or 'unavailable' (not graded) gets no effort estimate. */
export function repairFor(label: string, severity: string | null): AreaRepair {
  const service = SERVICE[label] ?? null;
  const effortHours = (severity && EFFORT[label]?.[severity]) || null;
  const safety = SAFETY[label];
  if (safety) return { ...safety, service, effortHours };
  switch (severity) {
    case 'severe': return { priority: 'soon', why: 'Severe damage: repair it soon to stop it getting worse.', service, effortHours };
    case 'moderate': return { priority: 'planned', why: 'Visible damage that needs repair; it can be booked in.', service, effortHours };
    case 'minor': return { priority: 'cosmetic', why: 'Cosmetic: repair when convenient.', service, effortHours };
    default: return { priority: 'planned', why: 'Not graded from the photo: the technician decides.', service, effortHours };
  }
}

export type RepairPlan = {
  method: string;
  validated: boolean;
  /** The most urgent priority among the areas, or null when there is no damage */
  priority: Priority | null;
  /** Most urgent first, then the most work first */
  services: { code: string; areas: number; priority: Priority; effortHours: Hours | null }[];
  /** Total proposed hours (areas repaired one after another), or null when nothing could be estimated */
  effortHours: Hours | null;
  /** Areas without an estimate (not graded) */
  notEstimated: number;
};

const round = (h: number) => Math.round(h * 2) / 2; // to the half hour
const sum = (ranges: (Hours | null)[]): Hours | null => {
  const known = ranges.filter((r): r is Hours => r !== null);
  return known.length ? [round(known.reduce((s, r) => s + r[0], 0)), round(known.reduce((s, r) => s + r[1], 0))] : null;
};

/** The plan for a whole inspection: most urgent priority, the services needed (with their areas and hours), total hours. */
export function repairPlan(areas: { label: string; severity: string | null }[]): RepairPlan {
  const each = areas.map((a) => repairFor(a.label, a.severity));
  const priority = each.length ? PRIORITIES.find((p) => each.some((r) => r.priority === p)) ?? null : null;
  const codes = [...new Set(each.map((r) => r.service).filter((s): s is string => s !== null))];
  return {
    method: REPAIR_METHOD,
    validated: REPAIR_VALIDATED,
    priority,
    services: codes
      .map((code) => {
        const mine = each.filter((r) => r.service === code);
        const urgent = PRIORITIES.find((p) => mine.some((r) => r.priority === p))!;
        return { code, areas: mine.length, priority: urgent, effortHours: sum(mine.map((r) => r.effortHours)) };
      })
      .sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || (b.effortHours?.[1] ?? 0) - (a.effortHours?.[1] ?? 0)),
    effortHours: sum(each.map((r) => r.effortHours)),
    notEstimated: each.filter((r) => r.effortHours === null).length,
  };
}
