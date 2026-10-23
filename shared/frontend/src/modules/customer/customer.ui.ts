import type { JobStage } from '@/modules/dashboard/dashboard.types';
import type { Priority } from '@/modules/inspections/inspections.types';
import type { ViewAngle } from './customer.types';

/** Words for the customer side: plain names, no model terms. */
export const DAMAGE_NAMES: Record<string, string> = {
  dent: 'Dent',
  scratch: 'Scratch',
  crack: 'Crack',
  glass_shatter: 'Shattered glass',
  lamp_broken: 'Broken lamp',
  tire_flat: 'Flat tyre',
};
export const VIEW_NAMES: Record<ViewAngle, string> = { front: 'Front', left: 'Left side', rear: 'Rear', right: 'Right side', other: 'Close-up' };
export const VIEW_ORDER: ViewAngle[] = ['front', 'left', 'rear', 'right', 'other'];

/** Severity is a state, so it uses the state colours (as on the staff inspection screens): blue, amber, red. */
export const SEVERITIES = [
  { key: 'severe', name: 'Severe', tone: 'danger', rank: 3, meaning: 'Large damage, or broken glass or a flat tyre. The part usually needs replacing, or the car is not safe to drive.' },
  { key: 'moderate', name: 'Moderate', tone: 'warning', rank: 2, meaning: 'Clearly visible damage, or a broken lamp. The part needs repair or refinishing.' },
  { key: 'minor', name: 'Minor', tone: 'info', rank: 1, meaning: 'Small and on the surface. Cosmetic: a polish or touch-up usually fixes it.' },
] as const;
export type SeverityTone = (typeof SEVERITIES)[number]['tone'] | 'muted';
export const severityOf = (s: string | null) => SEVERITIES.find((v) => v.key === s);
export const severityTone = (s: string | null): SeverityTone => severityOf(s)?.tone ?? 'muted';
export const severityName = (s: string | null) => severityOf(s)?.name ?? 'Not graded';

/** The six steps of a visit, as the customer sees them (job stages map onto them with journeyStep). */
export const JOURNEY = [
  { label: 'Checked in', icon: 'bi-box-arrow-in-right' },
  { label: 'Waiting for a bay', icon: 'bi-hourglass-split' },
  { label: 'In a bay', icon: 'bi-car-front' },
  { label: 'Damage inspection', icon: 'bi-clipboard-check' },
  { label: 'Maintenance plan', icon: 'bi-wrench-adjustable' },
  { label: 'Ready for pickup', icon: 'bi-key' },
];
export const JOURNEY_STEPS = JOURNEY.length;

/**
 * Where a visit is on the journey (1-6; 0 for a cancelled one). After the damage inspection the service centre makes
 * the maintenance plan: an inspected vehicle is on that step, and the step is done once the plan is confirmed.
 */
export function journeyStep(stage: JobStage, planReady = false): number {
  switch (stage) {
    case 'checked_in': return 1;
    case 'waiting_for_bay': return 2;
    case 'in_bay': return 3;
    case 'inspecting': return 4;
    case 'inspected': return planReady ? 6 : 5;
    case 'ready': case 'completed': return 6;
    default: return 0;
  }
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th" */
export function ordinal(n: number) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Shrinks a photo in the browser before uploading (longest side 1600 px, JPEG): a phone photo of 4-8 MB becomes a few
 * hundred KB, which is plenty for showing the car. createImageBitmap applies the phone's rotation tag.
 */
export async function shrinkPhoto(file: File, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', 0.86),
  );
}

/** Repair priority in customer words (same levels as the staff screens), most urgent first. */
export const PRIORITY_INFO: Record<Priority, { name: string; tone: 'danger' | 'warning' | 'info' | 'muted'; icon: string; advice: string }> = {
  before_driving: { name: 'Fix before driving', tone: 'danger', icon: 'bi-sign-stop', advice: 'Please have this fixed before you drive the car again.' },
  soon: { name: 'Fix soon', tone: 'warning', icon: 'bi-exclamation-triangle', advice: 'Book a repair soon, before it gets worse.' },
  planned: { name: 'Book a repair', tone: 'info', icon: 'bi-calendar-check', advice: 'It needs repair, but it can wait for a convenient time.' },
  cosmetic: { name: 'Cosmetic', tone: 'muted', icon: 'bi-brush', advice: 'Only affects how the car looks. Repair when convenient.' },
};

/** Estimated workshop hours in rough customer words: never exact hours or a price. */
export function roughTime(range: [number, number] | null) {
  if (!range) return 'Time to be confirmed';
  const most = range[1];
  if (most <= 1) return 'Under an hour';
  if (most <= 4) return 'A few hours';
  if (most <= 8) return 'About a day';
  if (most <= 16) return 'About two days';
  return 'Several days';
}
