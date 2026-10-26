import { PRIORITIES, repairFor, sumHours, type Priority } from './inspections.repair.js';
import { MECHANICAL_RULES } from './inspections.mechanical.js';
import { SOUND_FAULTS, type SoundLabel, type SoundSituation } from './inspections.sound.js';

/**
 * Hand-over to maintenance forecasting (inspection-handover-v1): what the damage inspection found, said in the forecast's
 * terms, from technician-checked results only. Built from the same rules as the repair guide (repair-v0) and the
 * mechanical guide (sound-repair-v0); adds
 *   - safe to drive: no if anything must be fixed before driving, with the reasons;
 *   - a ready-written diagnosis sentence for the forecast's "technician diagnosis" input;
 *   - category hints: the sound faults mapped to the forecast model's own categories;
 *   - the parts likely needed (parts-v0, PROPOSED like the hours: a guide, not a quote or an order).
 * Explained for the forecast's owner in member-2-damage-assessment/docs/forecast-handover.md.
 */
export const HANDOVER_VERSION = 'inspection-handover-v1';
export const PARTS_METHOD = 'parts-v0';

/** The maintenance forecast model's categories (member-3 predictor.SUPPORTED_CATEGORIES). */
export type ForecastCategory = 'Battery' | 'Brakes' | 'Electrical' | 'Engine' | 'Transmission';

const DAMAGE_NAMES: Record<string, string> = {
  dent: 'Dent',
  scratch: 'Scratch',
  crack: 'Crack',
  glass_shatter: 'Shattered glass',
  lamp_broken: 'Broken lamp',
  tire_flat: 'Flat tyre',
};

/** Sound faults the forecast model has a category for. Power steering has none of the five, so it gets no hint. */
const CATEGORY: Partial<Record<SoundLabel, ForecastCategory>> = {
  worn_brakes: 'Brakes',
  dead_battery: 'Battery',
  bad_ignition: 'Engine',
  misfire: 'Engine',
  tappet: 'Engine',
  low_oil: 'Engine',
  serpentine_belt: 'Engine',
};

/** Proposed parts per finding (null: labour only, e.g. a dent pulled out or a scratch polished). */
const DAMAGE_PARTS: Record<string, (severity: string | null) => string | null> = {
  glass_shatter: () => 'Replacement glass',
  lamp_broken: () => 'Lamp unit',
  tire_flat: () => 'Tyre (or a puncture repair)',
  dent: (s) => (s === 'severe' ? 'Body panel' : null),
  crack: (s) => (s === 'severe' ? 'Bumper or panel' : null),
  scratch: () => null,
};
const SOUND_PARTS: Partial<Record<SoundLabel, string>> = {
  worn_brakes: 'Brake pads',
  low_oil: 'Engine oil and oil filter',
  misfire: 'Spark plugs (check the ignition coils)',
  bad_ignition: 'Spark plugs or ignition coil',
  dead_battery: 'Battery',
  power_steering: 'Power steering fluid',
  serpentine_belt: 'Drive belt',
};

type Hours = [number, number];

export type HandoverInput = {
  inspectionId: number;
  inspectionNo: string;
  status: string;
  reviewedAt: string | null;
  vehicle: { vehicleId: number; registrationNo: string };
  jobId: number | null;
  overallSeverity: string | null;
  /** Damaged areas that count (overlapping regions of one damage once), final type and severity, and where */
  areas: { label: string; severity: string | null; where: string }[];
  /** Sound results not rejected, with the final fault */
  sounds: { situation: SoundSituation; label: SoundLabel }[];
  /** Service names (workshop.service_types), by code */
  serviceNames: Record<string, string>;
  methods: { severity: string | null; repair: string; mechanical: string };
};

export type Handover = ReturnType<typeof inspectionHandover>;

export function inspectionHandover(i: HandoverInput) {
  const damage = i.areas.map((a) => ({ ...a, name: DAMAGE_NAMES[a.label] ?? a.label, repair: repairFor(a.label, a.severity) }));
  const faults = i.sounds
    .map((s) => ({ ...s, name: SOUND_FAULTS[s.label].name, normal: SOUND_FAULTS[s.label].normal, rule: MECHANICAL_RULES[s.label] }))
    .sort((a, b) => Number(a.normal) - Number(b.normal));
  const heard = faults.filter((f) => !f.normal);

  const unsafe = [
    ...grouped(damage.filter((d) => d.repair.priority === 'before_driving'), (d) => d.name, (d) => d.where.toLowerCase())
      .map((g) => `${g.key} (${unique(g.items).join('; ')})`),
    ...heard.filter((f) => f.rule?.priority === 'before_driving').map((f) => `${f.name} (heard while ${SITUATION_VERB[f.situation]})`),
  ];

  const categoryHints = (['Brakes', 'Battery', 'Engine', 'Electrical', 'Transmission'] as ForecastCategory[])
    .map((category) => ({ category, because: heard.filter((f) => CATEGORY[f.label] === category).map((f) => f.name) }))
    .filter((h) => h.because.length > 0);

  const services = [
    ...groupServices(damage.map((d) => ({ code: d.repair.service, priority: d.repair.priority, hours: d.repair.effortHours })), 'body'),
    ...groupServices(heard.filter((f) => f.rule).map((f) => ({ code: f.rule!.service, priority: f.rule!.priority, hours: f.rule!.effortHours })), 'mechanical'),
  ].map((s) => ({ ...s, name: i.serviceNames[s.code] ?? s.code }));
  const bodyHours = sumHours(damage.map((d) => d.repair.effortHours));
  const mechanicalHours = sumHours(heard.map((f) => f.rule?.effortHours ?? null));

  // One line per part, with how many and what for (e.g. "Lamp unit" x 4: left headlight, right headlight, ...)
  const needed = [
    ...damage.flatMap((d) => {
      const part = DAMAGE_PARTS[d.label]?.(d.severity);
      return part ? [{ part, for: `${d.name}, ${d.where.toLowerCase()}`, kind: 'body' as const }] : [];
    }),
    ...heard.flatMap((f) => (SOUND_PARTS[f.label] ? [{ part: SOUND_PARTS[f.label]!, for: f.name, kind: 'mechanical' as const }] : [])),
  ];
  const parts = grouped(needed, (n) => n.part, (n) => n).map((g) => ({
    part: g.key,
    quantity: g.items.length,
    for: g.items.map((n) => n.for),
    kind: g.items[0]!.kind,
  }));

  return {
    version: HANDOVER_VERSION,
    inspectionId: i.inspectionId,
    inspectionNo: i.inspectionNo,
    /** True once the inspection is confirmed; before that it is a draft from the results reviewed so far */
    final: i.status === 'confirmed',
    confirmedAt: i.status === 'confirmed' ? i.reviewedAt : null,
    vehicle: i.vehicle,
    jobId: i.jobId,
    overallSeverity: i.overallSeverity,
    safeToDrive: { safe: unsafe.length === 0, reasons: unsafe },
    diagnosis: diagnosisText(i.inspectionNo, i.status === 'confirmed', damage, heard, unsafe),
    categoryHints,
    work: { bodyHours, mechanicalHours, totalHours: sumHours([bodyHours, mechanicalHours]), services },
    parts,
    findings: {
      damage: damage.map((d) => ({ label: d.label, name: d.name, severity: d.severity, where: d.where, priority: d.repair.priority })),
      sounds: faults.map((f) => ({ situation: f.situation, label: f.label, name: f.name, normal: f.normal, priority: f.rule?.priority ?? null })),
    },
    methods: { ...i.methods, parts: PARTS_METHOD, validated: false },
  };
}

const SITUATION_VERB: Record<SoundSituation, string> = { starting: 'starting', idling: 'idling', braking: 'braking' };

function groupServices(rows: { code: string | null; priority: Priority; hours: Hours | null }[], kind: 'body' | 'mechanical') {
  const codes = [...new Set(rows.map((r) => r.code).filter((c): c is string => c !== null))];
  return codes.map((code) => {
    const mine = rows.filter((r) => r.code === code);
    return {
      code,
      kind,
      priority: PRIORITIES.find((p) => mine.some((r) => r.priority === p))!,
      effortHours: sumHours(mine.map((r) => r.hours)),
    };
  });
}

const unique = (xs: string[]) => [...new Set(xs)];

/** Items grouped by a key, in order of first appearance. */
function grouped<T, V>(items: T[], key: (t: T) => string, value: (t: T) => V) {
  const groups = new Map<string, V[]>();
  for (const t of items) groups.set(key(t), [...(groups.get(key(t)) ?? []), value(t)]);
  return [...groups].map(([k, v]) => ({ key: k, items: v }));
}

/** One paragraph for the forecast's "technician diagnosis": sounds first (they matter most to the forecast), then body. */
function diagnosisText(
  no: string,
  final: boolean,
  damage: { name: string; where: string }[],
  heard: { name: string; situation: SoundSituation }[],
  unsafe: string[],
) {
  const parts: string[] = [];
  if (heard.length) parts.push(`Heard: ${heard.map((f) => `${f.name.toLowerCase()} (while ${SITUATION_VERB[f.situation]})`).join('; ')}.`);
  if (damage.length) {
    const kinds = grouped(damage, (d) => d.name, (d) => d.where.toLowerCase());
    parts.push(`Body damage: ${kinds.map((g) => `${g.key.toLowerCase()}${g.items.length > 1 ? ` x${g.items.length}` : ''} (${unique(g.items).join('; ')})`).join(', ')}.`);
  }
  if (!parts.length) parts.push('No damage and no fault sounds found.');
  if (unsafe.length) parts.push(`Not safe to drive until fixed: ${unsafe.join('; ')}.`);
  const text = `Damage inspection ${no} (${final ? 'technician-confirmed' : 'draft, not yet confirmed'}). ${parts.join(' ')}`;
  return text.length > 2000 ? `${text.slice(0, 1997)}...` : text; // the forecast accepts at most 2000 characters
}
