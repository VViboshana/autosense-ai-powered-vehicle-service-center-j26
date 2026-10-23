import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/States';
import { formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { DAMAGE_LABELS, SOUND_FAULTS, SOUND_SITUATIONS, percent } from '@/modules/inspections/inspections.ui';
import type { DamageLabel, SoundLabel, SoundSituation } from '@/modules/inspections/inspections.types';
import { CountUp } from './AiCharts';
import type { ActivityItem, Overview } from './ai.types';

/** Overview: the learning loop with live counts, the models in use, and the live feed of AI decisions. */
export function AiOverview({ data, onTab }: { data: Overview; onTab: (tab: string) => void }) {
  const l = data.learning;
  const sound = data.sound;
  const soundF1 = sound?.active?.comparison.new.all?.macroF1 ?? null;
  return (
    <div className="d-grid gap-3">
      {data.soundProblem && <Alert tone="warning">Sound model: {data.soundProblem}</Alert>}
      <div className="ai-top">
        <LearningLoop data={data} />
        <div className="ai-tiles">
          <Tile icon="bi-soundwave" label="Sound model" value={sound ? `V${sound.serving.versionNo}` : '—'}
            note={soundF1 !== null ? `fair-test macro F1 ${percent(soundF1, 1)}` : 'not running'} onClick={() => onTab('sound')} />
          <Tile icon="bi-camera" label="Damage model" value="V1"
            note={data.damage.testSet ? `test mask mAP50-95 ${percent(data.damage.testSet.mask.mAP50_95, 1)}` : 'no test results stored'} onClick={() => onTab('damage')} />
          <Tile icon="bi-database-add" label="Your recordings to learn from" value={<CountUp value={l.sound.learnable} />}
            note={`${l.sound.inActiveModel} already in the active sound model`} onClick={() => onTab('learning')} />
          <Tile icon="bi-pencil-square" label="Damage lessons collected" value={<CountUp value={l.damage.corrected + l.damage.missed + l.damage.falseAlarms} />}
            note={`${l.damage.corrected} corrected · ${l.damage.missed} missed · ${l.damage.falseAlarms} false alarms`} onClick={() => onTab('damage')} />
        </div>
      </div>
      <LiveFeed />
    </div>
  );
}

function Tile({ icon, label, value, note, onClick }: { icon: string; label: string; value: ReactNode; note: string; onClick: () => void }) {
  return (
    <button type="button" className="ai-tile" onClick={onClick}>
      <span className="ai-tile-label"><i className={`bi ${icon}`} aria-hidden="true" />{label}</span>
      <span className="ai-tile-value">{value}</span>
      <span className="ai-tile-note">{note}</span>
    </button>
  );
}

/**
 * The learning loop as a picture: inspections -> AI predicts -> technician reviews -> learning data -> retrain + fair
 * test -> a better model back in the inspections. Dots travel the loop; each step shows its live count.
 */
function LearningLoop({ data }: { data: Overview }) {
  const l = data.learning;
  const last = data.runs[0];
  const steps = [
    { icon: 'bi-camera', title: 'Inspection', note: 'photos + sounds' },
    { icon: 'bi-cpu', title: 'AI predicts', note: 'damage · faults' },
    { icon: 'bi-person-check', title: 'Technician', note: 'confirms or corrects' },
    { icon: 'bi-database-add', title: 'Learning data', note: `${l.sound.learnable} recordings · ${l.damage.corrected + l.damage.missed} photos lessons` },
    { icon: 'bi-arrow-repeat', title: 'Retrain + fair test', note: last ? `last: ${last.state === 'done' ? `V${last.versionNo}` : last.state}` : 'not yet' },
  ];
  const R = 112, C = 150;
  const at = (i: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps.length;
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
  };
  return (
    <Card className="ai-loop-card" icon="bi-infinity" title="Learning from your own workshop" subtitle="Every technician decision becomes training data for the next model.">
      <div className="ai-loop">
        <svg viewBox="0 0 300 300" aria-hidden="true">
          <circle cx={C} cy={C} r={R} className="ai-loop-ring" />
          <circle cx={C} cy={C} r={R} className="ai-loop-flow" />
          {[0, 1, 2].map((k) => (
            <circle key={k} r="4" className="ai-loop-dot">
              <animateMotion dur="6s" repeatCount="indefinite" begin={`${k * 2}s`} path={`M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R}`} />
            </circle>
          ))}
          <text x={C} y={C - 6} textAnchor="middle" className="ai-loop-core">AutoSense AI</text>
          <text x={C} y={C + 12} textAnchor="middle" className="ai-loop-sub">learns from you</text>
        </svg>
        {steps.map((s, i) => {
          const p = at(i);
          return (
            <div key={s.title} className="ai-loop-node" style={{ left: `${(p.x / 300) * 100}%`, top: `${(p.y / 300) * 100}%`, '--d': `${i * 150}ms` } as CSSProperties}>
              <i className={`bi ${s.icon}`} aria-hidden="true" />
              <b>{s.title}</b>
              <small>{s.note}</small>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const keyOf = (a: ActivityItem) => `${a.kind}|${a.at}|${a.inspectionId ?? ''}|${JSON.stringify(a.detail)}`;

/** The latest AI decisions and technicians' answers, refreshed every few seconds; new ones slide in. */
function LiveFeed() {
  const { data, loading } = useApi<ActivityItem[]>('/ai/activity', { limit: 25 }, { refreshMs: 5_000 });
  // The previous refresh's items, to slide in only the new ones (React's "previous value" pattern: no effect needed)
  const [snap, setSnap] = useState<{ data: ActivityItem[] | undefined; before: Set<string> | null }>({ data: undefined, before: null });
  if (data !== snap.data) setSnap({ data, before: snap.data ? new Set(snap.data.map(keyOf)) : null });
  const fresh = new Set(snap.before ? (data ?? []).map(keyOf).filter((k) => !snap.before!.has(k)) : []);
  return (
    <Card icon="bi-broadcast" title={<>Live AI activity <span className="ai-live"><i />live</span></>} subtitle="What the models decided and what technicians said, newest first.">
      <div className="as-card-body">
        {loading && !data ? (
          <Skeleton width="100%" />
        ) : !data?.length ? (
          <p className="small text-body-secondary mb-0">Nothing yet: AI decisions appear here as inspections are made and reviewed.</p>
        ) : (
          <ol className="ai-feed">
            {data.map((a) => <FeedItem key={keyOf(a)} a={a} fresh={fresh.has(keyOf(a))} />)}
          </ol>
        )}
      </div>
    </Card>
  );
}

function FeedItem({ a, fresh }: { a: ActivityItem; fresh: boolean }) {
  const d = a.detail as Record<string, never>;
  const conf = typeof d.confidence === 'number' || typeof d.confidence === 'string' ? percent(Number(d.confidence)) : null;
  const sit = (s: unknown) => SOUND_SITUATIONS[s as SoundSituation]?.label.toLowerCase() ?? '';
  const fault = (l: unknown) => SOUND_FAULTS[l as SoundLabel]?.name ?? String(l);
  const dmg = (l: unknown) => DAMAGE_LABELS[l as DamageLabel] ?? String(l);
  let icon = 'bi-cpu', tone = 'ai', text: ReactNode = null;
  switch (a.kind) {
    case 'analysed':
      icon = 'bi-magic';
      text = <>AI analysed {d.photos} {d.photos === 1 ? 'photo' : 'photos'}{d.sounds ? ` + ${d.sounds} sound${d.sounds === 1 ? '' : 's'}` : ''}: {d.regions} damage {d.regions === 1 ? 'region' : 'regions'}</>;
      break;
    case 'heard':
      icon = 'bi-soundwave';
      text = <>AI heard <b>{fault(d.label)}</b> while {sit(d.situation)} · {conf}{d.familiar === false ? ' · odd sound' : d.sure ? '' : ' · not sure'}</>;
      break;
    case 'sound_review':
      icon = d.decision === 'rejected' ? 'bi-x-circle' : 'bi-check-circle';
      tone = d.decision === 'confirmed' ? 'good' : 'teach';
      text = d.decision === 'confirmed' ? <>confirmed <b>{fault(d.label)}</b> ({sit(d.situation)}) · AI was right</>
        : d.decision === 'corrected' ? <>corrected <b>{fault(d.label)}</b> → <b>{fault(d.corrected)}</b>: a new lesson</>
        : <>rejected the {sit(d.situation)} result</>;
      break;
    case 'region_review':
      icon = d.decision === 'rejected' ? 'bi-x-circle' : 'bi-check-circle';
      tone = d.decision === 'confirmed' ? 'good' : 'teach';
      text = d.decision === 'confirmed' ? <>{d.suggestion ? 'accepted possible' : 'confirmed'} <b>{dmg(d.label)}</b> ({conf})</>
        : d.decision === 'corrected' ? <>corrected <b>{dmg(d.label)}</b>{d.corrected && d.corrected !== d.label ? <> → <b>{dmg(d.corrected)}</b></> : ' severity'}: a new lesson</>
        : <>{d.suggestion ? 'dismissed possible' : 'marked not damage:'} <b>{dmg(d.label)}</b>{d.suggestion ? '' : ' (a false alarm to learn from)'}</>;
      break;
    case 'missed':
      icon = 'bi-bounding-box-circles';
      tone = 'teach';
      text = <>added <b>{dmg(d.label)}</b> the AI missed: a new lesson</>;
      break;
    case 'training':
      icon = 'bi-arrow-repeat';
      text = <>sound model training {d.state === 'done' ? <>finished: <b>V{d.version}</b> learned from {d.recordings} of your recordings</> : d.state === 'failed' ? 'failed' : `started with ${d.recordings} of your recordings`}</>;
      break;
  }
  return (
    <li className={`ai-feed-item tone-${tone}${fresh ? ' fresh' : ''}`}>
      <span className="ai-feed-ic"><i className={`bi ${icon}`} aria-hidden="true" /></span>
      <span className="ai-feed-text">
        {a.who && <b className="me-1">{a.who}</b>}
        {text}
        {a.inspectionId && <> · <Link to={`/inspections/${a.inspectionId}`} className="as-mono">{a.inspectionNo}</Link></>}
        {a.registrationNo && <span className="text-body-secondary"> · {a.registrationNo}</span>}
      </span>
      <time className="ai-feed-time">{formatTime(a.at)}</time>
    </li>
  );
}
