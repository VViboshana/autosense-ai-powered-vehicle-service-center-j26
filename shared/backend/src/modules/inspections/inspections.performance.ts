import { DAMAGE_LABELS, SEVERITIES, type DamageLabel, type Severity } from './inspections.rules.js';

/**
 * How the damage model and the severity rules do in real use, measured from technicians' decisions on CONFIRMED
 * inspections (final decisions only). Pure: rows in, figures out, so it is unit-tested without a database.
 *
 * Per damage type (the model's label for its own regions, the technician's label for added ones):
 *   findings       regions the model reported at normal confidence
 *   correctType    kept with the same type (confirmed, or corrected in severity only)
 *   wrongType      kept but the technician changed the type
 *   rejected       not damage (false alarm)
 *   suggestions / accepted   possible damage offered / accepted by the technician
 *   added          damage the technician drew because the model missed it
 *   precision      correctType / findings
 *   recall         found / (found + added), found = correctType + accepted; an estimate: unnoticed misses are not counted
 * Severity rule check: for regions the rules graded (minor/moderate/severe) and the technician kept, does the rule's
 * grade match the final one?
 */
export type ReviewedRegion = {
  label: DamageLabel;
  correctedLabel: DamageLabel | null;
  severity: string | null;
  correctedSeverity: string | null;
  reviewStatus: 'pending' | 'confirmed' | 'corrected' | 'rejected';
  source: 'model' | 'technician';
  isSuggestion: boolean;
  confidence: number | null;
};

export type ClassPerformance = {
  label: DamageLabel;
  findings: number;
  correctType: number;
  wrongType: number;
  rejected: number;
  suggestions: number;
  accepted: number;
  added: number;
  precision: number | null;
  recall: number | null;
  meanConfidenceKept: number | null;
  meanConfidenceRejected: number | null;
};

export type SeverityCheck = {
  graded: number;
  agreed: number;
  agreement: number | null;
  /** matrix[rule][final] = count */
  matrix: Record<Severity, Record<Severity, number>>;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const isSeverity = (s: string | null): s is Severity => (SEVERITIES as readonly string[]).includes(s ?? '');

export function fieldPerformance(regions: ReviewedRegion[]): { classes: ClassPerformance[]; totals: Omit<ClassPerformance, 'label' | 'meanConfidenceKept' | 'meanConfidenceRejected'>; severity: SeverityCheck } {
  const kept = (r: ReviewedRegion) => r.reviewStatus === 'confirmed' || r.reviewStatus === 'corrected';
  const sameType = (r: ReviewedRegion) => !r.correctedLabel || r.correctedLabel === r.label;

  const classes = DAMAGE_LABELS.map((label): ClassPerformance => {
    const model = regions.filter((r) => r.source === 'model' && r.label === label);
    const findings = model.filter((r) => !r.isSuggestion);
    const suggestions = model.filter((r) => r.isSuggestion);
    const correct = findings.filter((r) => kept(r) && sameType(r));
    const accepted = suggestions.filter((r) => kept(r)).length;
    const added = regions.filter((r) => r.source === 'technician' && (r.correctedLabel ?? r.label) === label).length;
    const found = correct.length + accepted;
    return {
      label,
      findings: findings.length,
      correctType: correct.length,
      wrongType: findings.filter((r) => kept(r) && !sameType(r)).length,
      rejected: findings.filter((r) => r.reviewStatus === 'rejected').length,
      suggestions: suggestions.length,
      accepted,
      added,
      precision: ratio(correct.length, findings.length),
      recall: ratio(found, found + added),
      meanConfidenceKept: mean(correct.map((r) => r.confidence ?? 0)),
      meanConfidenceRejected: mean(findings.filter((r) => r.reviewStatus === 'rejected').map((r) => r.confidence ?? 0)),
    };
  });

  const sum = (key: 'findings' | 'correctType' | 'wrongType' | 'rejected' | 'suggestions' | 'accepted' | 'added') =>
    classes.reduce((s, c) => s + c[key], 0);
  const t = {
    findings: sum('findings'), correctType: sum('correctType'), wrongType: sum('wrongType'), rejected: sum('rejected'),
    suggestions: sum('suggestions'), accepted: sum('accepted'), added: sum('added'),
  };
  const found = t.correctType + t.accepted;

  const matrix = Object.fromEntries(SEVERITIES.map((a) => [a, Object.fromEntries(SEVERITIES.map((b) => [b, 0]))])) as SeverityCheck['matrix'];
  let graded = 0;
  let agreed = 0;
  for (const r of regions) {
    if (r.source !== 'model' || !kept(r) || !isSeverity(r.severity)) continue;
    const final = r.correctedSeverity ?? r.severity;
    if (!isSeverity(final)) continue;
    matrix[r.severity][final] += 1;
    graded += 1;
    if (final === r.severity) agreed += 1;
  }

  return {
    classes,
    totals: { ...t, precision: ratio(t.correctType, t.findings), recall: ratio(found, found + t.added) },
    severity: { graded, agreed, agreement: ratio(agreed, graded), matrix },
  };
}
