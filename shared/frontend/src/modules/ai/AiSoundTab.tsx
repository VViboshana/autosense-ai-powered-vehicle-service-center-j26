import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useApi } from '@/lib/useApi';
import { SOUND_FAULTS, SOUND_SITUATIONS, percent } from '@/modules/inspections/inspections.ui';
import { ConfusionMatrix, CountUp, Reliability } from './AiCharts';
import type { SoundPerformance } from './ai.types';

const ENOUGH = 30; // reviewed results before the real-use figures mean much

/** Sound model: fair-test figures from training, and how it does in real use (technicians' decisions). */
export function AiSoundTab() {
  const { data, error, loading, reload } = useApi<SoundPerformance>('/ai/sound/performance');
  if (error && !data) return <ErrorState error={error} onRetry={reload} title="Figures couldn't be loaded" />;
  if (loading || !data) return <Card><div className="as-card-body pt-3"><Skeleton width="100%" /></div></Card>;
  const t = data.testSet;
  return (
    <div className="d-grid gap-3">
      <section className="as-card as-kpis" aria-label="Sound model summary">
        <Kpi icon="bi-mortarboard" label="Fair test (training data)" value={t?.all ? percent(t.all.macroF1, 1) : '—'} note={t ? `macro F1 · ${t.version}` : 'service not running'} />
        <Kpi icon="bi-cloud-haze2" label="Fair test, workshop noise" value={t?.noisy ? percent(t.noisy.macroF1, 1) : '—'} note="same clips with 5–20 dB noise" />
        <Kpi icon="bi-person-check" label="Real use: AI right" value={data.accuracy !== null ? <CountUp value={data.accuracy * 100} format={(v) => `${v.toFixed(0)}%`} /> : '—'}
          note={`${data.correct} of ${data.reviewed} results confirmed as heard`} />
        <Kpi icon="bi-pencil" label="Corrected by technicians" value={data.corrected} note={`${data.rejected} rejected · each one a lesson`} />
      </section>

      {data.reviewed === 0 ? (
        <Card>
          <EmptyState icon="bi-soundwave" title="No reviewed sound results yet">
            Real-use figures appear once inspections with recordings are reviewed and confirmed. The fair-test figures above come from training.
          </EmptyState>
        </Card>
      ) : (
        <>
          {data.reviewed < ENOUGH && (
            <Alert tone="warning">Based on {data.reviewed} reviewed {data.reviewed === 1 ? 'result' : 'results'}: too few for firm conclusions (about {ENOUGH} needed).</Alert>
          )}
          <Card icon="bi-grid-3x3-gap" title="What the AI said vs what the technician heard" subtitle="One table per situation. Rows: what the technician decided; columns: what the AI said. The outlined diagonal is where they agree.">
            <div className="as-card-body ai-cm-group">
              {data.situations.filter((s) => s.reviewed > 0).map((s) => (
                <div key={s.situation}>
                  <h3 className="ai-h3"><i className={`bi ${SOUND_SITUATIONS[s.situation].icon} me-1`} aria-hidden="true" />{SOUND_SITUATIONS[s.situation].label}
                    <small>{s.correct} of {s.reviewed} right</small></h3>
                  <ConfusionMatrix
                    rows={[...s.labels.map((l) => ({ key: l, label: SOUND_FAULTS[l].name })), ...(s.rejected.some(Boolean) ? [{ key: 'rejected', label: 'Rejected' }] : [])]}
                    cols={s.labels.map((l) => ({ key: l, label: SOUND_FAULTS[l].name }))}
                    matrix={[...s.matrix, ...(s.rejected.some(Boolean) ? [s.rejected] : [])]}
                    rowTitle="Technician"
                    colTitle="AI said"
                    unit={['result', 'results']}
                  />
                </div>
              ))}
            </div>
          </Card>
          <div className="ai-grid-2">
            <Card icon="bi-bullseye" title="Is its confidence honest?" subtitle="When the AI says 80% sure, is it right 80% of the time? Bars below the line: over-confident; above: under-confident.">
              <div className="as-card-body"><Reliability calibration={data.calibration} /></div>
            </Card>
            <Card icon="bi-shield-exclamation" title="Odd-sound check in real use" subtitle="Recordings that did not sound like engine-bay recordings are marked not sure.">
              <div className="as-card-body">
                {data.familiarity.flagged + data.familiarity.others === 0 ? (
                  <p className="small text-body-secondary mb-0">
                    No reviewed results with the check yet: results from before it was added were not checked. Figures
                    appear as new inspections are reviewed.
                  </p>
                ) : (
                  <div className="ai-odd">
                    <span><b>{data.familiarity.flagged}</b> flagged as odd · {data.familiarity.flaggedWrong} of them were wrong</span>
                    <span><b>{data.familiarity.others}</b> normal recordings · {data.familiarity.othersWrong} wrong ({percent(data.familiarity.others ? data.familiarity.othersWrong / data.familiarity.others : null)})</span>
                  </div>
                )}
              </div>
            </Card>
          </div>
          <Card icon="bi-list-check" title="By fault" subtitle="Precision: when the AI names this fault, how often it is right. Recall: of the real cases, how many it found.">
            <div className="as-card-body">
              <table className="table table-sm ai-table mb-0">
                <thead><tr><th>Fault</th><th>Situation</th><th className="text-end">AI said</th><th>Precision</th><th className="text-end">Real cases</th><th>Recall</th></tr></thead>
                <tbody>
                  {data.perFault.filter((f) => f.said || f.truly).map((f) => (
                    <tr key={f.label}>
                      <td>{SOUND_FAULTS[f.label].name}</td>
                      <td className="text-body-secondary">{SOUND_SITUATIONS[SOUND_FAULTS[f.label].situation].label}</td>
                      <td className="text-end as-num">{f.said}</td>
                      <td><Meter v={f.precision} /></td>
                      <td className="text-end as-num">{f.truly}</td>
                      <td><Meter v={f.recall} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export function Meter({ v }: { v: number | null }) {
  return v === null ? <span className="text-body-secondary small">—</span> : (
    <span className="ai-meter" title={percent(v, 1)}><span className="ai-meter-track"><i style={{ width: `${v * 100}%` }} /></span><b>{percent(v)}</b></span>
  );
}

export function Kpi({ icon, label, value, note }: { icon: string; label: string; value: ReactNode; note: string }) {
  return (
    <div className="as-kpi">
      <span className="as-kpi-label"><i className={`bi ${icon}`} aria-hidden="true" />{label}</span>
      <span className="as-kpi-value">{value}</span>
      <span className="as-kpi-note small text-body-secondary">{note}</span>
    </div>
  );
}
