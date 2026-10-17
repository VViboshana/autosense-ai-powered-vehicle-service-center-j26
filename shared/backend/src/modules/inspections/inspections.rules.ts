/** Damage classes the model is trained on (CarDD); the same list as the CHECK constraints in damage.detections. */
export const DAMAGE_LABELS = ['dent', 'scratch', 'crack', 'glass_shatter', 'lamp_broken', 'tire_flat'] as const;
export type DamageLabel = (typeof DAMAGE_LABELS)[number];

export const SEVERITIES = ['minor', 'moderate', 'severe'] as const;
export type Severity = (typeof SEVERITIES)[number];
export type OverallSeverity = Severity | 'unavailable' | null;

export const VIEW_ANGLES = ['front', 'rear', 'left', 'right', 'other'] as const;
export const INSPECTION_STATUSES = ['draft', 'processing', 'awaiting_review', 'confirmed', 'failed'] as const;
export const REVIEW_DECISIONS = ['confirmed', 'corrected', 'rejected'] as const;

export const isDamageLabel = (s: string): s is DamageLabel => (DAMAGE_LABELS as readonly string[]).includes(s);

/**
 * The worst severity in a list (severe > moderate > minor). Without any graded value: 'unavailable' when something
 * could not be graded, null when there is nothing at all (no damage found).
 */
export function worstSeverity(values: readonly (string | null)[]): OverallSeverity {
  const graded = values.filter((v): v is Severity => (SEVERITIES as readonly string[]).includes(v ?? ''));
  if (graded.length) return graded.reduce((a, b) => (SEVERITIES.indexOf(b) > SEVERITIES.indexOf(a) ? b : a));
  return values.includes('unavailable') ? 'unavailable' : null;
}

/** A region's severity after review: rejected regions drop out, a technician's correction wins over the model. */
export function finalSeverity(d: { reviewStatus: string; severity: string | null; correctedSeverity: string | null }): string | null {
  if (d.reviewStatus === 'rejected') return null;
  return d.correctedSeverity ?? d.severity;
}

/** e.g. INS-26-000123: two-digit year (service centre time) and the inspection id. */
export function formatInspectionNo(id: number, at = new Date()): string {
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Colombo', year: '2-digit' }).format(at);
  return `INS-${year}-${String(id).padStart(6, '0')}`;
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const extensionFor = (mimeType: string) => EXTENSIONS[mimeType] ?? 'bin';
