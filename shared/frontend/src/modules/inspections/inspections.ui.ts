import type { Tone } from '@/components/ui/StatusPill';
import type { DamageLabel, Detection, Hours, InspectionStatus, Priority, SeverityValue, ViewAngle } from './inspections.types';

export const DAMAGE_LABELS: Record<DamageLabel, string> = {
  dent: 'Dent',
  scratch: 'Scratch',
  crack: 'Crack',
  glass_shatter: 'Shattered glass',
  lamp_broken: 'Broken lamp',
  tire_flat: 'Flat tyre',
};

/** Severity is a state, so it uses the state colours: blue minor, amber moderate, red severe, grey not graded. */
export const SEVERITY: Record<NonNullable<SeverityValue>, { label: string; tone: Tone }> = {
  minor: { label: 'Minor', tone: 'info' },
  moderate: { label: 'Moderate', tone: 'warning' },
  severe: { label: 'Severe', tone: 'danger' },
  unavailable: { label: 'Not graded', tone: 'muted' },
};

export const STATUS: Record<InspectionStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  processing: { label: 'Analysing', tone: 'brand' },
  awaiting_review: { label: 'Waiting for review', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const REVIEW: Record<Detection['reviewStatus'], { label: string; tone: Tone }> = {
  pending: { label: 'To review', tone: 'warning' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  corrected: { label: 'Corrected', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'muted' },
};

export const VIEW_ANGLES: Record<ViewAngle, string> = {
  front: 'Front',
  rear: 'Rear',
  left: 'Left side',
  right: 'Right side',
  other: 'Other / close-up',
};

/** What a region counts as after review: the technician's correction wins; rejected regions count as nothing. */
export function finalLabel(d: Detection): DamageLabel {
  return d.correctedLabel ?? d.label;
}
export function finalSeverity(d: Detection): SeverityValue {
  if (d.reviewStatus === 'rejected') return null;
  return d.correctedSeverity ?? d.severity;
}

/** Possible damage nobody has accepted or dismissed yet. */
export const isOpenSuggestion = (d: Detection) => d.suggestion && d.reviewStatus === 'pending';
/** Counts as damage: a finding, or a suggestion a technician accepted. */
export const isFinding = (d: Detection) => !d.suggestion || d.reviewStatus === 'confirmed' || d.reviewStatus === 'corrected';

/** 0.873 -> "87%" */
export const percent = (v: number | null | undefined, digits = 0) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);

/** Repair priority, most urgent first: the safety-critical one is red, like severe damage. */
export const PRIORITY: Record<Priority, { label: string; tone: Tone; icon: string }> = {
  before_driving: { label: 'Fix before driving', tone: 'danger', icon: 'bi-sign-stop' },
  soon: { label: 'Fix soon', tone: 'warning', icon: 'bi-exclamation-triangle' },
  planned: { label: 'Can be planned', tone: 'info', icon: 'bi-calendar-check' },
  cosmetic: { label: 'Cosmetic', tone: 'muted', icon: 'bi-brush' },
};

/** [1.5, 3] -> "1.5–3 h"; [0.3, 0.75] -> "20–45 min" */
export function hours(range: Hours | null | undefined) {
  if (!range) return '—';
  const [a, b] = range;
  if (b < 1) return `${Math.round(a * 60)}–${Math.round(b * 60)} min`;
  const h = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  return `${h(a)}–${h(b)} h`;
}
