import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/layout/PageHeader';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { DamageLabel, Severity } from './inspections.types';
import { DAMAGE_LABELS, percent } from './inspections.ui';
import { ClassSmallMultiples, SeverityHeatmap, type ClassFigures } from './PerformanceCharts';
import './inspections.css';

type TestSet = {
  version: string;
  split: string;
  images: number;
  regions: number;
  mask: { precision: number; recall: number; mAP50: number; mAP50_95: number };
  perClassMaskMAP50_95: Partial<Record<DamageLabel, number>>;
};

type ClassRow = {
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
type Performance = {
  sample: { inspections: number; photos: number; avgProcessingMs: number | null; since: string | null; modelVersions: string[] };
  regionsReviewed: number;
  testSet: TestSet | null;
  classes: ClassRow[];
  totals: Omit<ClassRow, 'label' | 'meanConfidenceKept' | 'meanConfidenceRejected'>;
  severity: { graded: number; agreed: number; agreement: number | null; matrix: Record<Severity, Record<Severity, number>> };
};

const ENOUGH = 50; // reviewed regions before the figures mean much

/**
 * Feature setup › Damage settings (DAMAGE_SETTINGS): how the damage model and the severity rules do in real use,
 * from technicians' decisions on confirmed inspections. Complements the test-set evaluation: the test set says how
 * the model does on CarDD, this says how it does on this service centre's photos.
 */
export function DamagePerformancePage() {
  const { data, error, loading, reload } = useApi<Performance>('/inspections/performance');

  return (
    <>
      <PageHeader
        title="Damage model performance"
        subtitle="Measured from technicians' decisions on confirmed inspections."
        actions={
          <button type="button" className="btn btn-light" onClick={reload}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />Refresh
          </button>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          {error && !data ? (
            <ErrorState error={error} onRetry={reload} title="Figures couldn't be loaded" />
          ) : loading || !data ? (
            <Card><div className="as-card-body pt-3"><Skeleton width="40%" /><div className="mt-3"><Skeleton width="100%" /></div></div></Card>
          ) : data.regionsReviewed === 0 && !data.testSet ? (
            <Card>
              <EmptyState icon="bi-graph-up" title="Nothing measured yet">
                Figures appear once inspections are reviewed and confirmed.
              </EmptyState>
            </Card>
          ) : (
            <Figures data={data} />
          )}
        </div>
      </div>
    </>
  );
}

function Figures({ data }: { data: Performance }) {
  const { totals, severity, sample, testSet } = data;
  const rows: ClassFigures[] = data.classes.map((c) => ({
    label: c.label,
    test: testSet?.perClassMaskMAP50_95[c.label] ?? null,
    precision: c.precision,
    recall: c.recall,
    precisionNote: `${c.correctType} of ${c.findings} findings`,
    recallNote: `${c.correctType + c.accepted} found, ${c.added} missed`,
    precisionN: c.findings,
    recallN: c.correctType + c.accepted + c.added,
  }));
  const total: ClassFigures = {
    label: 'dent',
    test: testSet?.mask.mAP50_95 ?? null,
    precision: totals.precision,
    recall: totals.recall,
    precisionNote: `${totals.correctType} of ${totals.findings} findings`,
    recallNote: `${totals.correctType + totals.accepted} found, ${totals.added} missed`,
    precisionN: totals.findings,
    recallN: totals.correctType + totals.accepted + totals.added,
  };
  const testNote = testSet ? `${testSet.split}, ${testSet.images} photos, model ${testSet.version}` : '';

  return (
    <div className="d-grid gap-3">
      {data.regionsReviewed < ENOUGH && (
        <Alert tone="warning">
          Based on {data.regionsReviewed} reviewed {data.regionsReviewed === 1 ? 'region' : 'regions'} from {sample.inspections}{' '}
          {sample.inspections === 1 ? 'inspection' : 'inspections'}: too few for firm conclusions. The figures settle after about {ENOUGH} regions.
        </Alert>
      )}

      <section className="as-card as-kpis" aria-label="Summary">
        <Kpi
          icon="bi-mortarboard"
          label="Test set (CarDD)"
          value={percent(testSet?.mask.mAP50_95)}
          note={testSet ? `mask mAP50-95 · ${testSet.images} test photos` : 'no test results stored'}
        />
        <Kpi icon="bi-clipboard-check" label="Confirmed inspections" value={sample.inspections} note={`${sample.photos} photos${sample.since ? ` since ${formatDate(sample.since)}` : ''}`} />
        <Kpi icon="bi-bullseye" label="Field precision" value={percent(totals.precision)} note={`${totals.correctType} of ${totals.findings} findings right`} />
        <Kpi icon="bi-search" label="Field recall (estimate)" value={percent(totals.recall)} note={`${totals.added} missed, added by technicians`} />
        <Kpi icon="bi-question-circle" label="Possible damage accepted" value={percent(totals.suggestions ? totals.accepted / totals.suggestions : null)} note={`${totals.accepted} of ${totals.suggestions} suggestions`} />
      </section>

      <Card
        icon="bi-bar-chart"
        title="Test set vs real use"
        subtitle="Different measures, so each has its own panel on the same 0–100% scale. Hover a bar for the counts behind it."
      >
        <div className="as-card-body">
          <ClassSmallMultiples rows={rows} total={total} testNote={testNote} />
          <p className="small text-body-secondary mt-3 mb-0">
            The test set measures how closely the model outlines damage on CarDD photos it never trained on. Real use measures
            what technicians kept on this service centre's photos. A big gap for a damage type means it behaves differently here.
          </p>
        </div>
      </Card>

      <Card icon="bi-grid-3x3" title="By damage type" subtitle={`Model ${sample.modelVersions.join(', ') || '—'} · ${sample.avgProcessingMs ?? '—'} ms per photo on average`}>
        <div className="table-responsive">
          <table className="table as-table">
            <thead>
              <tr>
                <th>Damage</th>
                <th className="text-end">Found</th>
                <th className="text-end">Right type</th>
                <th className="text-end">Wrong type</th>
                <th className="text-end">Not damage</th>
                <th className="text-end">Precision</th>
                <th className="text-end">Suggested (accepted)</th>
                <th className="text-end">Missed</th>
                <th className="text-end">Recall (est.)</th>
                <th className="text-end">Confidence: kept / not damage</th>
              </tr>
            </thead>
            <tbody>
              {data.classes.map((c) => (
                <tr key={c.label}>
                  <td>{DAMAGE_LABELS[c.label]}</td>
                  <td className="as-num text-end">{c.findings}</td>
                  <td className="as-num text-end">{c.correctType}</td>
                  <td className="as-num text-end">{c.wrongType}</td>
                  <td className="as-num text-end">{c.rejected}</td>
                  <td className="as-num text-end fw-semibold">{percent(c.precision)}</td>
                  <td className="as-num text-end">{c.suggestions} ({c.accepted})</td>
                  <td className="as-num text-end">{c.added}</td>
                  <td className="as-num text-end fw-semibold">{percent(c.recall)}</td>
                  <td className="as-num text-end">{percent(c.meanConfidenceKept)} / {percent(c.meanConfidenceRejected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small text-body-secondary as-card-note">
          Precision: findings kept with the right type ÷ findings. Recall estimate: (right findings + accepted suggestions) ÷
          (those + damage technicians added); damage nobody noticed is not counted, so true recall may be lower.
        </p>
      </Card>

      <Card
        icon="bi-sliders"
        title="Severity rule check (rule-v0)"
        subtitle={
          severity.graded
            ? `The technician kept the rule's grade on ${severity.agreed} of ${severity.graded} regions (${percent(severity.agreement)}).`
            : 'No graded regions reviewed yet.'
        }
      >
        <div className="as-card-body">
          {severity.graded > 0 && <SeverityHeatmap matrix={severity.matrix} />}
          <p className="small text-body-secondary mt-3 mb-0">
            Counts regions the rules graded and the technician kept; darker means more. The outlined diagonal is agreement;
            right of it the rule graded too low, left of it too high. Thresholds are in the damage service's severity_rules.json.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, note }: { icon: string; label: string; value: string | number; note: string }) {
  return (
    <div className="as-kpi">
      <span className="as-kpi-label"><i className={`bi ${icon}`} aria-hidden="true" />{label}</span>
      <span className="as-kpi-value">{value}</span>
      <span className="as-kpi-note">{note}</span>
    </div>
  );
}
