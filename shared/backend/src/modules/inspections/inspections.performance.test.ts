import { describe, expect, it } from 'vitest';
import { fieldPerformance, type ReviewedRegion } from './inspections.performance.js';

const region = (over: Partial<ReviewedRegion>): ReviewedRegion => ({
  label: 'dent', correctedLabel: null, severity: 'moderate', correctedSeverity: null, reviewStatus: 'confirmed',
  source: 'model', isSuggestion: false, confidence: 0.6, ...over,
});

describe('field performance', () => {
  const regions: ReviewedRegion[] = [
    region({}),                                                       // dent, right
    region({ reviewStatus: 'corrected', correctedSeverity: 'severe' }), // dent, right type, severity changed
    region({ reviewStatus: 'corrected', correctedLabel: 'scratch' }),   // said dent, was a scratch
    region({ reviewStatus: 'rejected', confidence: 0.3 }),              // false alarm
    region({ isSuggestion: true, reviewStatus: 'confirmed', confidence: 0.2 }), // accepted suggestion
    region({ isSuggestion: true, reviewStatus: 'rejected', confidence: 0.12 }), // dismissed suggestion
    region({ source: 'technician', confidence: null, severity: 'minor' }),      // missed dent, added
  ];
  const out = fieldPerformance(regions);
  const dent = out.classes.find((c) => c.label === 'dent')!;

  it('counts what the technicians decided for each of the model findings', () => {
    expect(dent).toMatchObject({ findings: 4, correctType: 2, wrongType: 1, rejected: 1, suggestions: 2, accepted: 1, added: 1 });
  });

  it('works out field precision and the recall estimate', () => {
    expect(dent.precision).toBe(0.5);       // 2 right of 4 findings
    expect(dent.recall).toBe(0.75);         // found 2 + 1 accepted = 3, of 3 + 1 added
    expect(dent.meanConfidenceKept).toBeCloseTo(0.6);
    expect(dent.meanConfidenceRejected).toBeCloseTo(0.3);
  });

  it('checks the severity rules against the final grade on the regions the technician kept', () => {
    // kept model regions with a rule grade: the right one, the severity-corrected one, the scratch, the accepted suggestion
    expect(out.severity.graded).toBe(4);
    expect(out.severity.agreed).toBe(3);
    expect(out.severity.matrix.moderate.severe).toBe(1);
    expect(out.severity.agreement).toBe(0.75);
  });

  it('returns no rate rather than 0% when there is nothing to measure', () => {
    const empty = fieldPerformance([]);
    expect(empty.totals.precision).toBeNull();
    expect(empty.severity.agreement).toBeNull();
    expect(empty.classes.find((c) => c.label === 'crack')!.recall).toBeNull();
  });
});
