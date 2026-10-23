import { useEffect, useState, type CSSProperties } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { percent } from '@/modules/inspections/inspections.ui';
import { BeforeAfter } from './AiCharts';
import type { Overview, SoundVersions, TrainingStatus, VersionReport } from './ai.types';

const STAGES = [
  { key: 'collect', icon: 'bi-collection', title: 'Collect', note: 'your confirmed recordings + the datasets' },
  { key: 'fingerprint', icon: 'bi-fingerprint', title: 'Fingerprint', note: 'PANNs listens to each new recording' },
  { key: 'compare', icon: 'bi-clipboard2-data', title: 'Fair test', note: 'current vs new on the same 5 folds' },
  { key: 'train', icon: 'bi-cpu', title: 'Train', note: 'final model + odd-sound check' },
] as const;

/** Learning: retrain the sound model on the app's confirmed recordings, compare fairly, activate or roll back. */
export function AiLearningTab({ overview, onChanged }: { overview: Overview; onChanged: () => void }) {
  const versions = useApi<SoundVersions>('/ai/sound/versions');
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A run already in progress (started earlier or by someone else): follow it
  const running = versions.data?.running ?? null;
  const following = runId ?? running;

  useEffect(() => {
    if (!following) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await apiGet<TrainingStatus>(`/ai/sound/retrain/${following}`);
        if (stop) return;
        setStatus(s);
        if (s.state === 'running') window.setTimeout(tick, 1500);
        else {
          versions.reload();
          onChanged();
        }
      } catch (err) {
        if (!stop) setError(err instanceof ApiError ? err.message : 'Lost track of the training run.');
      }
    };
    void tick();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow one run at a time
  }, [following]);

  async function retrain() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const r = await apiSend<{ runId: string; appRecordings: number }>('POST', '/ai/sound/retrain');
      setRunId(r.runId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Training could not be started.');
    } finally {
      setBusy(false);
    }
  }

  async function activate(v: VersionReport) {
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/ai/sound/versions/${v.versionNo}/activate`);
      versions.reload();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The version could not be activated.');
    } finally {
      setBusy(false);
    }
  }

  const l = overview.learning.sound;
  const fresh = Math.max(0, l.learnable - l.inActiveModel);
  const inProgress = status?.state === 'running' || (!status && !!following);

  return (
    <div className="d-grid gap-3">
      {error && <Alert>{error}</Alert>}
      <section className="as-card ai-teach">
        <div className="ai-teach-main">
          <span className="ai-eyebrow"><i className="bi bi-stars me-1" aria-hidden="true" />Sound model · learns from your workshop</span>
          <h2>{fresh > 0 ? <><b>{fresh}</b> new {fresh === 1 ? 'recording' : 'recordings'} to learn from</> : l.learnable ? 'Up to date with your recordings' : 'No confirmed recordings yet'}</h2>
          <p>
            {l.learnable} technician-confirmed {l.learnable === 1 ? 'recording' : 'recordings'} in total; the active model already learned from {l.inActiveModel}.
            Retraining keeps everything it knew (1,261 dataset clips) and adds yours. About 3–5 minutes on this computer; the app keeps working.
            The new version is only used after you activate it.
          </p>
          <button type="button" className="btn btn-primary btn-lg ai-teach-btn" disabled={busy || inProgress || l.learnable === 0} onClick={() => void retrain()}>
            <i className="bi bi-arrow-repeat me-2" aria-hidden="true" />{inProgress ? 'Training…' : 'Retrain sound model'}
          </button>
        </div>
        <Pipeline status={status} active={inProgress} />
      </section>

      {status?.state === 'done' && status.result && (
        <ResultCard report={status.result} active={versions.data?.active ?? null} busy={busy} onActivate={() => void activate(status.result!)} />
      )}
      {status?.state === 'failed' && <Alert>Training failed: {status.error}. The active model is unchanged.</Alert>}

      <Card icon="bi-clock-history" title="Model versions" subtitle="Every version keeps its fair-test report. Activate one to use it; activate an older one to roll back.">
        <div className="as-card-body">
          {versions.error && !versions.data ? (
            <ErrorState inline error={versions.error} onRetry={versions.reload} title="Versions couldn't be loaded (is the damage service running?)" />
          ) : !versions.data ? <Skeleton width="100%" /> : (
            <ol className="ai-versions">
              {versions.data.versions.map((v, i) => {
                const isActive = v.versionNo === versions.data!.active;
                const f1 = v.comparison.new.all?.macroF1 ?? null;
                const prev = versions.data!.versions[i + 1]?.comparison.new.all?.macroF1 ?? null;
                return (
                  <li key={v.versionNo} className={isActive ? 'on' : ''} style={{ '--d': `${i * 80}ms` } as CSSProperties}>
                    <span className="ai-v-badge">V{v.versionNo}</span>
                    <span className="ai-v-body">
                      <b>{v.version}</b> {isActive && <StatusPill tone="success">Active</StatusPill>}
                      <small>
                        Trained {v.trained} · {Object.entries(v.trainedOn).map(([k, n]) => `${n} ${k === 'app' ? 'of your recordings' : k.replace('_', ' ')}`).join(' + ')}
                      </small>
                    </span>
                    <span className="ai-v-score">
                      {percent(f1, 1)}
                      {f1 !== null && prev !== null && Math.abs(f1 - prev) >= 0.0005 && <small className={f1 > prev ? 'up' : 'down'}>{f1 > prev ? '▲' : '▼'} {Math.abs((f1 - prev) * 100).toFixed(1)}</small>}
                      <small>macro F1</small>
                    </span>
                    {!isActive && (
                      <button type="button" className="btn btn-sm btn-light" disabled={busy || inProgress} onClick={() => void activate(v)}>
                        {v.versionNo < versions.data!.active ? 'Roll back to this' : 'Activate'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </Card>
    </div>
  );
}

/** The four training stages; the current one pulses, finished ones get a tick. */
function Pipeline({ status, active }: { status: TrainingStatus | null; active: boolean }) {
  const at = status ? (status.stage === 'done' ? STAGES.length : STAGES.findIndex((s) => s.key === status.stage)) : active ? 0 : -1;
  return (
    <div className={`ai-pipe${active ? ' running' : ''}`} aria-live="polite">
      {STAGES.map((s, i) => {
        const state = at > i || status?.state === 'done' ? 'done' : at === i && status?.state !== 'failed' ? 'now' : status?.state === 'failed' && at === i ? 'failed' : '';
        return (
          <div key={s.key} className={`ai-pipe-step ${state}`}>
            <span className="ai-pipe-ic"><i className={`bi ${state === 'done' ? 'bi-check-lg' : state === 'failed' ? 'bi-x-lg' : s.icon}`} aria-hidden="true" /></span>
            <span><b>{s.title}</b><small>{state === 'now' && status ? status.message : s.note}</small></span>
            {state === 'now' && status && <i className="ai-pipe-bar"><b style={{ width: `${Math.round(status.progress * 100)}%` }} /></i>}
          </div>
        );
      })}
    </div>
  );
}

/** The fair comparison: the recipe without your recordings vs with them, on the same test folds. */
function ResultCard({ report, active, busy, onActivate }: { report: VersionReport; active: number | null; busy: boolean; onActivate: () => void }) {
  const c = report.comparison;
  const before = c.current.all?.macroF1 ?? 0;
  const after = c.new.all?.macroF1 ?? 0;
  const better = after >= before - 0.005;
  return (
    <Card
      className="ai-result"
      icon="bi-trophy"
      title={`V${report.versionNo} learned from ${report.appRecordings} of your recordings`}
      subtitle="Same test folds for both: what the model scores without your recordings vs with them."
      actions={active !== report.versionNo && (
        <button type="button" className={`btn ${better ? 'btn-primary' : 'btn-light'}`} disabled={busy} onClick={onActivate}>
          <i className="bi bi-rocket-takeoff me-1" aria-hidden="true" />Activate V{report.versionNo}
        </button>
      )}
    >
      <div className="as-card-body">
        <p className={`ai-verdict ${better ? 'good' : 'bad'}`}>
          <i className={`bi ${better ? 'bi-graph-up-arrow' : 'bi-exclamation-triangle'}`} aria-hidden="true" />
          {better
            ? <>Recommended: macro F1 <b>{percent(before, 1)} → {percent(after, 1)}</b>{c.new.appRecordings && <>; on your own recordings <b>{percent(c.current.appRecordings?.macroF1, 1)} → {percent(c.new.appRecordings.macroF1, 1)}</b></>}.</>
            : <>Not better ({percent(before, 1)} → {percent(after, 1)}): keep the current version unless you have a reason.</>}
        </p>
        <BeforeAfter
          before="Without your recordings"
          after="With your recordings"
          rows={[
            { label: 'All test clips', before: c.current.all, after: c.new.all, measure: 'macroF1' },
            { label: 'Workshop noise', before: c.current.noisy, after: c.new.noisy, measure: 'macroF1' },
            { label: 'Your recordings', before: c.current.appRecordings, after: c.new.appRecordings, measure: 'accuracy' },
          ]}
        />
        <p className="small text-body-secondary mt-2 mb-0">
          Macro F1 for the clip sets (every fault counts equally); accuracy for your recordings (too few per fault for F1).
        </p>
      </div>
    </Card>
  );
}
