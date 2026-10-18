import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/layout/PageHeader';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { DamageLabel, Severity } from './inspections.types';
import { DAMAGE_LABELS, SEVERITY, percent } from './inspections.ui';

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
  classes: ClassRow[];
  totals: Omit<ClassRow, 'label' | 'meanConfidenceKept' | 'meanConfidenceRejected'>;
  severity: { graded: number; agreed: number; agreement: number | null; matrix: Record<Severity, Record<Severity, number>> };
};

const GRADES: Severity[] = ['minor', 'moderate', 'severe'];
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
            <Card><Skeleton width="40%" /><div className="mt-3"><Skeleton width="100%" /></div></Card>
          ) : data.regionsReviewed === 0 ? (
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
  const { totals, severity, sample } = data;
  return (
    <>
      {data.regionsReviewed < ENOUGH && (
        <Alert tone="warning">
          Based on {data.regionsReviewed} reviewed {data.regionsReviewed === 1 ? 'region' : 'regions'} from {sample.inspections}{' '}
          {sample.inspections === 1 ? 'inspection' : 'inspections'}: too few for firm conclusions. The figures settle after about {ENOUGH} regions.
        </Alert>
      )}

      <section className="as-card as-kpis" aria-label="Summary">
        <Kpi icon="bi-clipboard-check" label="Confirmed inspections" value={sample.inspections} note={`${sample.photos} photos${sample.since ? ` since ${formatDate(sample.since)}` : ''}`} />
        <Kpi icon="bi-bullseye" label="Field precision" value={percent(totals.precision)} note={`${totals.correctType} of ${totals.findings} findings right`} />
        <Kpi icon="bi-search" label="Field recall (estimate)" value={percent(totals.recall)} note={`${totals.added} missed, added by technicians`} />
        <Kpi icon="bi-question-circle" label="Possible damage accepted" value={percent(totals.suggestions ? totals.accepted / totals.suggestions : null)} note={`${totals.accepted} of ${totals.suggestions} suggestions`} />
      </section>

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
        <p className="small text-body-secondary mb-0">
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
        {severity.graded > 0 && (
          <div className="table-responsive" style={{ maxWidth: '34rem' }}>
            <table className="table as-table">
              <thead>
                <tr>
                  <th>Rule said ↓ / technician's final →</th>
                  {GRADES.map((g) => <th key={g} className="text-end">{SEVERITY[g].label}</th>)}
                </tr>
              </thead>
              <tbody>
                {GRADES.map((rule) => (
                  <tr key={rule}>
                    <td>{SEVERITY[rule].label}</td>
                    {GRADES.map((final) => (
                      <td key={final} className={`as-num text-end${rule === final ? ' fw-semibold' : ''}`}>{severity.matrix[rule][final]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small text-body-secondary mb-0">
          Counts regions the rules graded and the technician kept. The diagonal is agreement; above it the rule graded too
          low, below it too high. Thresholds are in the damage service's severity_rules.json.
        </p>
      </Card>
    </>
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
