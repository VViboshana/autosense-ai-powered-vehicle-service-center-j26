import { useRef, useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiUpload, fieldErrors } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { SoundLabel, SoundSituation } from '@/modules/inspections/inspections.types';
import { SOUND_FAULTS, SOUND_SITUATIONS, percent } from '@/modules/inspections/inspections.ui';
import { ConfusionMatrix } from './AiCharts';
import { Kpi } from './AiSoundTab';
import type { LabRun, LabRunSummary } from './ai.types';

const LABELS = Object.keys(SOUND_FAULTS) as SoundLabel[];
const SITUATIONS = Object.keys(SOUND_SITUATIONS) as SoundSituation[];
const AUDIO = ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac', 'audio/ogg'];

/** A first guess at the fault from the file name (e.g. "misfire_040.wav", "worn_out_brakes_5.wav"); the user checks it. */
function guess(filename: string): SoundLabel | '' {
  const n = filename.toLowerCase();
  const rules: [RegExp, SoundLabel][] = [
    [/worn.?(out.?)?brake/, 'worn_brakes'], [/normal.?brake/, 'normal_brakes'], [/misfire/, 'misfire'], [/tappet/, 'tappet'],
    [/belt/, 'serpentine_belt'], [/power.?steer/, 'power_steering'], [/low.?oil/, 'low_oil'], [/dead.?batt|battery/, 'dead_battery'],
    [/ignition/, 'bad_ignition'], [/normal.?(engine.?)?start|startup/, 'normal_start'], [/healthy|normal.?(engine.?)?idle|idling|normal/, 'normal_idle'],
  ];
  return rules.find(([re]) => re.test(n))?.[1] ?? '';
}

/**
 * Test lab: upload labelled recordings (e.g. your own phone recordings of real cars) and see how the active sound
 * model does on them. No inspection is created; every test is kept as evidence.
 */
export function AiLabTab() {
  const list = useApi<LabRunSummary[]>('/ai/sound/lab');
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <div className="d-grid gap-3">
      {creating ? (
        <NewTest onCancel={() => setCreating(false)} onDone={(id) => { setCreating(false); setOpen(id); list.reload(); }} />
      ) : (
        <section className="as-card ai-lab-hero">
          <div>
            <span className="ai-eyebrow"><i className="bi bi-flask me-1" aria-hidden="true" />Test lab</span>
            <h2>Test the sound model on your own recordings</h2>
            <p>Record real cars (bonnet open, about 30 cm from the engine), upload them with the fault you know they have, and get a scorecard. Nothing reaches customers or inspections.</p>
          </div>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setCreating(true)}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />New test
          </button>
        </section>
      )}

      {open !== null && <LabResult id={open} onClose={() => setOpen(null)} />}

      <Card icon="bi-journal-check" title="Tests" subtitle="Each test keeps its recordings, the true faults and the model's answers.">
        <div className="as-card-body">
          {!list.data ? <Skeleton width="100%" /> : list.data.length === 0 ? (
            <EmptyState icon="bi-flask" title="No tests yet">Start one with "New test".</EmptyState>
          ) : (
            <ul className="ai-labs">
              {list.data.map((r) => (
                <li key={r.labRunId}>
                  <button type="button" className={open === r.labRunId ? 'on' : ''} onClick={() => setOpen(r.labRunId)}>
                    <b>{r.name}</b>
                    <small>{formatDate(r.createdAt)} {formatTime(r.createdAt)}{r.createdBy && ` · ${r.createdBy}`} · {r.modelVersion}</small>
                    <span className="ai-labs-score">{r.items ? percent(r.correct / r.items) : '—'}<small>{r.correct} of {r.items} right</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

type Pick = { file: File; label: SoundLabel | '' };

function NewTest({ onCancel, onDone }: { onCancel: () => void; onDone: (id: number) => void }) {
  const [name, setName] = useState(`My recordings ${new Date().toLocaleDateString()}`);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  function add(files: FileList | null) {
    const ok = [...(files ?? [])].filter((f) => AUDIO.includes(f.type));
    setPicks((p) => [...p, ...ok.map((file) => ({ file, label: guess(file.name) }))].slice(0, 30));
    if (input.current) input.current.value = '';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const form = new FormData();
    form.append('name', name);
    for (const p of picks) {
      form.append('recordings', p.file);
      form.append('labels', p.label);
    }
    setProgress(0);
    try {
      const run = await apiUpload<LabRun>('/ai/sound/lab', form, setProgress);
      onDone(run.labRunId);
    } catch (err) {
      setError(err);
      setProgress(null);
    }
  }

  const ready = picks.length > 0 && picks.every((p) => p.label) && name.trim();
  const fields = fieldErrors(error);
  return (
    <Card icon="bi-flask" title="New test" subtitle="Up to 30 recordings (WAV, FLAC or OGG). Give each one the fault you know it has: the guess from its file name is only a start.">
      <form className="as-card-body" onSubmit={submit} noValidate>
        {error instanceof ApiError && <Alert>{error.message}</Alert>}
        <div className="row g-3 align-items-end mb-3">
          <div className="col-md-6">
            <label className="form-label" htmlFor="lab-name">Test name</label>
            <input id="lab-name" className="form-control" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            {fields.name && <div className="text-danger small">{fields.name}</div>}
          </div>
          <div className="col-md-6 text-md-end">
            <input ref={input} type="file" multiple accept={AUDIO.join(',')} className="visually-hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => add(e.target.files)} />
            <button type="button" className="btn btn-light" disabled={progress !== null} onClick={() => input.current?.click()}>
              <i className="bi bi-folder2-open me-1" aria-hidden="true" />Add recordings
            </button>
          </div>
        </div>
        {picks.length > 0 && (
          <table className="table table-sm ai-table align-middle">
            <thead><tr><th>Recording</th><th>Its real fault</th><th /></tr></thead>
            <tbody>
              {picks.map((p, i) => (
                <tr key={`${p.file.name}-${i}`}>
                  <td className="text-truncate" style={{ maxWidth: '18rem' }}>{p.file.name}</td>
                  <td>
                    <select className="form-select form-select-sm" value={p.label} aria-label={`Real fault of ${p.file.name}`}
                      onChange={(e) => setPicks((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value as SoundLabel } : x)))}>
                      <option value="">Choose…</option>
                      {SITUATIONS.map((s) => (
                        <optgroup key={s} label={SOUND_SITUATIONS[s].label}>
                          {LABELS.filter((l) => SOUND_FAULTS[l].situation === s).map((l) => <option key={l} value={l}>{SOUND_FAULTS[l].name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="text-end">
                    <button type="button" className="btn btn-sm btn-light" aria-label={`Remove ${p.file.name}`} disabled={progress !== null}
                      onClick={() => setPicks((all) => all.filter((_, j) => j !== i))}><i className="bi bi-trash" aria-hidden="true" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="d-flex gap-2 align-items-center">
          <button type="submit" className="btn btn-primary" disabled={!ready || progress !== null}>
            <i className="bi bi-play-fill me-1" aria-hidden="true" />
            {progress === null ? `Run the test${picks.length ? ` on ${picks.length}` : ''}` : progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : 'The model is listening…'}
          </button>
          <button type="button" className="btn btn-light" disabled={progress !== null} onClick={onCancel}>Cancel</button>
          {picks.length > 0 && !picks.every((p) => p.label) && <span className="small text-body-secondary">Choose the real fault of every recording.</span>}
        </div>
      </form>
    </Card>
  );
}

function LabResult({ id, onClose }: { id: number; onClose: () => void }) {
  const { data } = useApi<LabRun>(`/ai/sound/lab/${id}`);
  if (!data) return <Card><div className="as-card-body pt-3"><Skeleton width="100%" /></div></Card>;
  const answered = data.items.filter((i) => i.predictedLabel);
  const right = answered.filter((i) => i.predictedLabel === i.trueLabel);
  const sure = answered.filter((i) => i.sure);
  const sureRight = sure.filter((i) => i.predictedLabel === i.trueLabel);
  const odd = answered.filter((i) => i.familiar === false);
  return (
    <Card icon="bi-clipboard2-data" title={data.name} subtitle={`${data.modelVersion} · ${formatDate(data.createdAt)}`}
      actions={<button type="button" className="btn btn-sm btn-light" onClick={onClose}>Close</button>}>
      <div className="as-card-body d-grid gap-3">
        <section className="as-kpis ai-kpis-flat" aria-label="Scorecard">
          <Kpi icon="bi-bullseye" label="Right" value={percent(answered.length ? right.length / answered.length : null)} note={`${right.length} of ${answered.length} recordings`} />
          <Kpi icon="bi-shield-check" label="Right when sure" value={percent(sure.length ? sureRight.length / sure.length : null)} note={`${sure.length} answered as sure`} />
          <Kpi icon="bi-shield-exclamation" label="Odd sounds" value={odd.length} note="flagged by the odd-sound check" />
          <Kpi icon="bi-file-earmark-x" label="Unusable" value={data.items.length - answered.length} note="silent, too short or unreadable" />
        </section>
        {SITUATIONS.map((s) => {
          const mine = answered.filter((i) => i.situation === s);
          if (!mine.length) return null;
          const labels = LABELS.filter((l) => SOUND_FAULTS[l].situation === s);
          return (
            <div key={s}>
              <h3 className="ai-h3">{SOUND_SITUATIONS[s].label}<small>{mine.filter((i) => i.predictedLabel === i.trueLabel).length} of {mine.length} right</small></h3>
              <ConfusionMatrix
                rows={labels.map((l) => ({ key: l, label: SOUND_FAULTS[l].name }))}
                cols={labels.map((l) => ({ key: l, label: SOUND_FAULTS[l].name }))}
                matrix={labels.map((t) => labels.map((p) => mine.filter((i) => i.trueLabel === t && i.predictedLabel === p).length))}
                rowTitle="Really"
                colTitle="AI said"
                unit={['recording', 'recordings']}
              />
            </div>
          );
        })}
        <table className="table table-sm ai-table align-middle mb-0">
          <thead><tr><th>Recording</th><th>Listen</th><th>Really</th><th>AI said</th><th className="text-end">Confidence</th><th /></tr></thead>
          <tbody>
            {data.items.map((i) => {
              const ok = i.predictedLabel === i.trueLabel;
              return (
                <tr key={i.labItemId}>
                  <td className="text-truncate" style={{ maxWidth: '14rem' }} title={i.filename}>{i.filename}</td>
                  <td><audio controls preload="none" src={i.url} className="ai-mini-audio" aria-label={`Play ${i.filename}`} /></td>
                  <td>{SOUND_FAULTS[i.trueLabel].name}</td>
                  <td>{i.predictedLabel ? SOUND_FAULTS[i.predictedLabel].name : <span className="text-body-secondary">no answer</span>}
                    {i.familiar === false && <span className="ms-1"><StatusPill tone="warning">Odd sound</StatusPill></span>}
                    {i.predictedLabel && !i.sure && i.familiar !== false && <span className="ms-1"><StatusPill tone="muted">Not sure</StatusPill></span>}</td>
                  <td className="text-end as-num">{percent(i.confidence)}</td>
                  <td>{i.predictedLabel && <i className={`bi ${ok ? 'bi-check-circle-fill text-success' : 'bi-x-circle-fill text-danger'}`} aria-label={ok ? 'right' : 'wrong'} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
