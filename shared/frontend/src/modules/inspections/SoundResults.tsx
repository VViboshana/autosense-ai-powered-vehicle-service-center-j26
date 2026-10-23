import { useState, type CSSProperties, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiSend } from '@/lib/api';
import type { InspectionDetail, MechanicalPlan, SoundCheck, SoundLabel } from './inspections.types';
import { PRIORITY, REVIEW, SOUND_FAULTS, SOUND_SITUATIONS, hours, percent } from './inspections.ui';

/**
 * The sound results of an inspection: each recording, the fault the sound model names for that situation, and how
 * sure it is. A technician listens and confirms, corrects (to another fault of the same situation) or rejects.
 */
export function SoundResults({ inspectionId, sounds, editable, onSaved, onError }: {
  inspectionId: number;
  sounds: SoundCheck[];
  editable: boolean;
  onSaved: (fresh: InspectionDetail, message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState<SoundCheck | null>(null);

  async function decide(s: SoundCheck, decision: 'confirmed' | 'rejected') {
    setBusyId(s.soundCheckId);
    onError(null);
    try {
      const fresh = await apiSend<InspectionDetail>('PATCH', `/inspections/${inspectionId}/sounds/${s.soundCheckId}`, { decision });
      const what = SOUND_SITUATIONS[s.situation].label.toLowerCase();
      onSaved(fresh, decision === 'confirmed' ? `Sound result (${what}) confirmed` : `Sound result (${what}) rejected`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'The change could not be saved.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card
      className="mb-3"
      icon="bi-soundwave"
      title="Sound"
      subtitle="What the sound model heard in each recording. Listen, then confirm, correct or reject."
    >
      <div className="as-card-body">
        <Alert tone="info">
          The sound model chooses only between the faults of the situation that was recorded. "Not sure" means its
          confidence is under 70%; "Odd sound" means the recording did not sound like an engine-bay recording (speech,
          music, a tone, or very unusual). Either way: check by ear, or record again in a new inspection.
        </Alert>
        <ol className="as-snd-results">
          {sounds.map((s) => (
            <SoundItem
              key={s.soundCheckId}
              s={s}
              editable={editable}
              busy={busyId === s.soundCheckId}
              onConfirm={() => void decide(s, 'confirmed')}
              onReject={() => void decide(s, 'rejected')}
              onCorrect={() => setCorrecting(s)}
            />
          ))}
        </ol>
      </div>
      {correcting && (
        <CorrectSoundDialog
          inspectionId={inspectionId}
          s={correcting}
          onClose={() => setCorrecting(null)}
          onDone={(fresh) => {
            setCorrecting(null);
            onSaved(fresh, 'Sound correction saved');
          }}
        />
      )}
    </Card>
  );
}

function SoundItem({ s, editable, busy, onConfirm, onReject, onCorrect }: {
  s: SoundCheck;
  editable: boolean;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onCorrect: () => void;
}) {
  const situation = SOUND_SITUATIONS[s.situation];
  const relabelled = s.correctedLabel && s.correctedLabel !== s.label;
  const rejected = s.reviewStatus === 'rejected';
  const tone = rejected ? 'muted' : s.normal ? 'success' : 'warning';
  return (
    <li className={`as-snd-result st-${s.reviewStatus}`}>
      <div className="as-dmg-item-head">
        <i className={`bi ${situation.icon}`} aria-hidden="true" />
        <span className="small text-body-secondary">{situation.label}</span>
        <b>
          {relabelled && <span className="as-dmg-was me-1">{SOUND_FAULTS[s.label].name}</span>}
          {SOUND_FAULTS[s.finalLabel ?? s.label].name}
        </b>
        <StatusPill tone={tone}>{s.normal ? 'Normal' : 'Fault'}</StatusPill>
        {s.familiar === false ? <StatusPill tone="warning"><i className="bi bi-shield-exclamation me-1" aria-hidden="true" />Odd sound</StatusPill>
          : !s.sure && s.reviewStatus === 'pending' && <StatusPill tone="muted">Not sure</StatusPill>}
        <StatusPill tone={REVIEW[s.reviewStatus].tone}>{REVIEW[s.reviewStatus].label}</StatusPill>
      </div>
      <audio controls preload="none" src={s.url} className="as-snd-audio" aria-label={`${situation.label} recording`} />
      <div className="as-dmg-facts">
        <span className="as-conf">
          Confidence {percent(s.confidence)}
          <i className="as-conf-bar" aria-hidden="true"><b style={{ '--v': s.confidence } as CSSProperties} /></i>
        </span>
        {s.durationS !== null && <span>{s.durationS.toFixed(1)} s recording</span>}
      </div>
      {!rejected && <p className="as-dmg-reason">{s.advice}</p>}
      {s.quality.warnings && s.quality.warnings.length > 0 && (
        <p className="as-dmg-reason text-warning-emphasis">
          <i className="bi bi-exclamation-triangle me-1" aria-hidden="true" />Recording: {s.quality.warnings.join(' ')}
        </p>
      )}
      <details className="as-snd-probs">
        <summary>All {situation.label.toLowerCase()} faults</summary>
        <ul>
          {s.probabilities.map((p) => (
            <li key={p.label}>
              <span>{SOUND_FAULTS[p.label].name}</span>
              <i className="as-conf-bar" aria-hidden="true"><b style={{ '--v': p.probability } as CSSProperties} /></i>
              <span className="as-num">{percent(p.probability)}</span>
            </li>
          ))}
        </ul>
      </details>
      {s.reviewedBy && s.reviewStatus !== 'pending' && <p className="as-dmg-reason">{REVIEW[s.reviewStatus].label} by {s.reviewedBy}</p>}
      {editable && (
        <div className="as-dmg-actions">
          <button type="button" className="btn btn-sm btn-light" disabled={busy || s.reviewStatus === 'confirmed'} onClick={onConfirm}>
            <i className="bi bi-check-lg me-1" aria-hidden="true" />Confirm
          </button>
          <button type="button" className="btn btn-sm btn-light" disabled={busy} onClick={onCorrect}>
            <i className="bi bi-pencil me-1" aria-hidden="true" />Correct
          </button>
          <button type="button" className="btn btn-sm btn-light" disabled={busy || rejected} onClick={onReject}>
            <i className="bi bi-x-lg me-1" aria-hidden="true" />Reject
          </button>
        </div>
      )}
    </li>
  );
}

function CorrectSoundDialog({ inspectionId, s, onClose, onDone }: {
  inspectionId: number;
  s: SoundCheck;
  onClose: () => void;
  onDone: (fresh: InspectionDetail) => void;
}) {
  const options = (Object.keys(SOUND_FAULTS) as SoundLabel[]).filter((l) => SOUND_FAULTS[l].situation === s.situation);
  const [label, setLabel] = useState<SoundLabel>(s.finalLabel ?? s.label);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await apiSend<InspectionDetail>('PATCH', `/inspections/${inspectionId}/sounds/${s.soundCheckId}`, { decision: 'corrected', label }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The correction could not be saved.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Correct the ${SOUND_SITUATIONS[s.situation].label.toLowerCase()} result`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="correct-sound-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <form id="correct-sound-form" onSubmit={submit} noValidate>
        <p className="small">
          The model said <b>{SOUND_FAULTS[s.label].name}</b> ({percent(s.confidence)}). Your correction is kept next to the
          model's answer, so the sound model can be evaluated in real use.
        </p>
        <SelectField label="What you heard" value={label} onChange={(e) => setLabel(e.target.value as SoundLabel)}>
          {options.map((l) => <option key={l} value={l}>{SOUND_FAULTS[l].name}</option>)}
        </SelectField>
      </form>
    </Modal>
  );
}

/**
 * Mechanical repair guide (sound-repair-v0) from the sound findings: kept apart from the body-damage repair guide.
 * While reviewing, undecided results count with the model's answer; rejected ones drop out.
 */
export function MechanicalGuide({ plan, reviewing }: { plan: MechanicalPlan; reviewing: boolean }) {
  const top = plan.priority ? PRIORITY[plan.priority] : null;
  return (
    <Card
      className="mb-3"
      icon="bi-gear-wide-connected"
      title="Mechanical"
      subtitle={`From what the sound model heard${reviewing ? ' (updates as you review)' : ''} · ${plan.method}, proposed hours`}
      actions={top && <StatusPill tone={top.tone}><i className={`bi ${top.icon} me-1`} aria-hidden="true" />{top.label}</StatusPill>}
    >
      <div className="as-card-body">
        {plan.items.length === 0 ? (
          <p className="small text-body-secondary mb-0"><i className="bi bi-check-circle text-success me-1" aria-hidden="true" />No mechanical work suggested: the recordings sounded normal.</p>
        ) : (
          <>
            <ul className="as-mech-list">
              {plan.items.map((i) => (
                <li key={i.label}>
                  <StatusPill tone={PRIORITY[i.priority].tone}>{PRIORITY[i.priority].label}</StatusPill>
                  <span>
                    <b>{i.name}</b> <span className="small text-body-secondary">· {SOUND_SITUATIONS[i.situation].label.toLowerCase()}</span>
                    <span className="d-block small text-body-secondary">{i.why}</span>
                  </span>
                  <span className="small text-end">
                    {plan.services.find((s) => s.code === i.service)?.name ?? i.service}
                    <span className="d-block as-num text-body-secondary">{hours(i.effortHours)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="small text-body-secondary mt-2 mb-0">
              Total about <b className="as-num">{hours(plan.effortHours)}</b> of workshop time. Hours are a proposal until the
              service centre's technician confirms them{plan.validated ? '' : ' (not validated yet)'}; never a quote.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
