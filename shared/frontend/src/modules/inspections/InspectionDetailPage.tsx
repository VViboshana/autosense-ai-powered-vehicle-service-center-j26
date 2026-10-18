import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { DamagePhoto } from './DamagePhoto';
import type { DamageLabel, Detection, InspectionDetail, Severity } from './inspections.types';
import { DAMAGE_LABELS, REVIEW, SEVERITY, STATUS, VIEW_ANGLES, finalLabel, finalSeverity, isFinding, isOpenSuggestion, percent } from './inspections.ui';
import './inspections.css';

/**
 * One inspection: each photo with the damage outlines, and beside it the regions the model found. A technician
 * confirms, corrects or rejects each region (INSPECTION_REVIEW); once none is left to review, someone with
 * INSPECTION_CONFIRM confirms the inspection, which makes it final and visible to the customer.
 */
export function InspectionDetailPage() {
  const { id } = useParams();
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<InspectionDetail>(`/inspections/${id}`);
  const [selected, setSelected] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState<Detection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Region numbers run across all photos, so "3" means the same region on the photo and in the list.
  // Possible damage is numbered P1, P2...; dismissed possible damage gets no number and is not drawn.
  const numbers = useMemo(() => {
    const map = new Map<number, string>();
    const all = data?.images.flatMap((im) => im.detections) ?? [];
    all.filter(isFinding).forEach((d, n) => map.set(d.detectionId, String(n + 1)));
    all.filter(isOpenSuggestion).forEach((d, n) => map.set(d.detectionId, `P${n + 1}`));
    return map;
  }, [data]);

  if (error && !data) {
    return (
      <div className="app-content pt-4">
        <div className="container-fluid">
          <ErrorState error={error} onRetry={reload} title={error.status === 404 ? 'Inspection not found' : undefined} />
        </div>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="app-content pt-4">
        <div className="container-fluid">
          <Card><Skeleton width="30%" /><div className="mt-3"><Skeleton width="100%" /></div></Card>
        </div>
      </div>
    );
  }

  const editable = data.status === 'awaiting_review' && can('INSPECTION_REVIEW');
  const all = data.images.flatMap((im) => im.detections);
  const findings = all.filter(isFinding);
  const pending = findings.filter((d) => d.reviewStatus === 'pending').length;
  const possible = all.filter(isOpenSuggestion).length;

  async function review(d: Detection, decision: 'confirmed' | 'rejected') {
    setBusyId(d.detectionId);
    setActionError(null);
    try {
      await apiSend('PATCH', `/inspections/${data!.inspectionId}/detections/${d.detectionId}`, { decision });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'The change could not be saved.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title={
          <>
            {data.inspectionNo} <StatusPill tone={STATUS[data.status].tone}>{STATUS[data.status].label}</StatusPill>
          </>
        }
        documentTitle={data.inspectionNo}
        subtitle={
          <>
            <span className="as-mono fw-semibold">{data.vehicle.registrationNo}</span>
            <span aria-hidden="true">·</span>
            <span>{data.vehicle.description}</span>
            {data.job && (
              <>
                <span aria-hidden="true">·</span>
                <span className="as-mono">{data.job.jobNo}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>
              {formatDate(data.createdAt)} {formatTime(data.createdAt)}
              {data.createdBy && ` by ${data.createdBy}`}
            </span>
          </>
        }
        actions={
          <>
            <Link className="btn btn-light" to={can('INSPECTION_REVIEW') && data.status === 'awaiting_review' ? '/inspections/review' : '/inspections'}>
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              Back
            </Link>
            {data.status === 'awaiting_review' && can('INSPECTION_CONFIRM') && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending > 0}
                title={pending > 0 ? `Review every region first (${pending} left)` : undefined}
                onClick={() => setConfirming(true)}
              >
                <i className="bi bi-check2-all me-1" aria-hidden="true" />
                Confirm inspection
              </button>
            )}
          </>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          {actionError && <Alert>{actionError}</Alert>}

          <section className="as-card as-kpis" aria-label="Inspection summary">
            <div className="as-kpi">
              <span className="as-kpi-label"><i className="bi bi-exclamation-octagon" aria-hidden="true" />Overall severity</span>
              <span className="as-kpi-value" style={{ fontSize: '1.1rem' }}>
                {data.overallSeverity ? (
                  <StatusPill tone={SEVERITY[data.overallSeverity].tone}>{SEVERITY[data.overallSeverity].label}</StatusPill>
                ) : (
                  'No damage'
                )}
              </span>
            </div>
            <div className="as-kpi">
              <span className="as-kpi-label"><i className="bi bi-bounding-box" aria-hidden="true" />Damage regions</span>
              <span className="as-kpi-value">{findings.filter((d) => d.reviewStatus !== 'rejected').length}<small>of {findings.length} found</small></span>
            </div>
            <div className="as-kpi">
              <span className="as-kpi-label"><i className="bi bi-hourglass-split" aria-hidden="true" />To review</span>
              <span className="as-kpi-value">{pending}{possible > 0 && <small>+ {possible} possible</small>}</span>
            </div>
            <div className="as-kpi">
              <span className="as-kpi-label"><i className="bi bi-cpu" aria-hidden="true" />Model</span>
              <span className="as-kpi-value as-mono" style={{ fontSize: '0.85rem' }}>{data.model ? data.model.version : '—'}</span>
            </div>
          </section>

          <Alert tone="info">
            Damage is found by an AI model and the severity is a preliminary estimate ({data.severityMethod ?? 'rule-v0'}),
            {data.severityValidated ? ' validated against technician labels.' : ' not yet validated.'} Confidence is the model's
            confidence, not a probability of being right. Check every region before confirming.
          </Alert>
          {data.status === 'confirmed' && (
            <Alert tone="success">
              Confirmed{data.reviewedBy && ` by ${data.reviewedBy}`}{data.reviewedAt && ` on ${formatDate(data.reviewedAt)} at ${formatTime(data.reviewedAt)}`}.
              {data.reviewNotes && <div className="mt-1">Note: {data.reviewNotes}</div>}
            </Alert>
          )}

          {data.images.map((image) => (
            <Card key={image.imageId} icon="bi-camera" title={VIEW_ANGLES[image.viewAngle]} subtitle={photoFacts(image)}>
              {image.quality.warnings && image.quality.warnings.length > 0 && (
                <Alert tone="warning">
                  Photo quality: {image.quality.warnings.join(' ')} Results from this photo may be less reliable.
                </Alert>
              )}
              <div className="row g-3">
                <div className="col-lg-7">
                  <DamagePhoto image={image} numbers={numbers} selected={selected} onSelect={setSelected} />
                </div>
                <div className="col-lg-5">
                  {(() => {
                    const item = (d: Detection) => (
                      <RegionItem
                        key={d.detectionId}
                        d={d}
                        no={numbers.get(d.detectionId) ?? ''}
                        on={selected === d.detectionId}
                        editable={editable}
                        busy={busyId === d.detectionId}
                        onSelect={() => setSelected(d.detectionId)}
                        onConfirm={() => review(d, 'confirmed')}
                        onReject={() => review(d, 'rejected')}
                        onCorrect={() => setCorrecting(d)}
                      />
                    );
                    const found = image.detections.filter(isFinding);
                    const open = image.detections.filter(isOpenSuggestion);
                    const dismissed = image.detections.filter((d) => d.suggestion && d.reviewStatus === 'rejected').length;
                    return (
                      <>
                        {found.length === 0 ? (
                          <p className="text-body-secondary small mb-0">No damage was found in this photo.</p>
                        ) : (
                          <ol className="as-dmg-list" aria-label="Damage found">{found.map(item)}</ol>
                        )}
                        {open.length > 0 && (
                          <section className="as-dmg-possible" aria-label="Possible damage">
                            <h3><i className="bi bi-question-circle" aria-hidden="true" />Possible damage</h3>
                            <p>
                              The model is less sure about these (confidence under 25%). Accept the ones that are real damage;
                              the rest are dismissed when the inspection is confirmed.
                            </p>
                            <ol className="as-dmg-list">{open.map(item)}</ol>
                          </section>
                        )}
                        {dismissed > 0 && (
                          <p className="small text-body-secondary mt-2 mb-0">
                            {dismissed} possible {dismissed === 1 ? 'region was' : 'regions were'} dismissed.
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {correcting && (
        <CorrectDialog
          inspectionId={data.inspectionId}
          d={correcting}
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            reload();
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          inspection={data}
          onClose={() => setConfirming(false)}
          onDone={() => {
            setConfirming(false);
            reload();
          }}
        />
      )}
    </>
  );
}

function photoFacts(image: InspectionDetail['images'][number]) {
  const parts = [];
  if (image.width && image.height) parts.push(`${image.width} × ${image.height}`);
  if (image.processingMs != null) parts.push(`analysed in ${(image.processingMs / 1000).toFixed(1)} s`);
  const found = image.detections.filter(isFinding).length;
  const open = image.detections.filter(isOpenSuggestion).length;
  parts.push(`${found} ${found === 1 ? 'region' : 'regions'}${open ? ` + ${open} possible` : ''}`);
  return parts.join(' · ');
}

function RegionItem({ d, no, on, editable, busy, onSelect, onConfirm, onReject, onCorrect }: {
  d: Detection;
  no: string;
  on: boolean;
  editable: boolean;
  busy: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onCorrect: () => void;
}) {
  const open = isOpenSuggestion(d);
  // Possible damage shows the severity it would get if accepted
  const severity = open ? d.severity : finalSeverity(d);
  const tone = severity ? SEVERITY[severity].tone : 'muted';
  const relabelled = d.correctedLabel && d.correctedLabel !== d.label;
  return (
    <li className={`as-dmg-item${on ? ' on' : ''}${open ? ' possible' : ''}`} onClick={onSelect}>
      <div className="as-dmg-item-head">
        <span className={`as-dmg-no as-tone-${tone}`} style={{ background: 'none' }}>{no}</span>
        <b>
          {relabelled && <span className="as-dmg-was me-1">{DAMAGE_LABELS[d.label]}</span>}
          {DAMAGE_LABELS[finalLabel(d)]}
        </b>
        {severity && <StatusPill tone={SEVERITY[severity].tone}>{open ? `${SEVERITY[severity].label} if accepted` : SEVERITY[severity].label}</StatusPill>}
        {open ? <StatusPill tone="muted">Possible</StatusPill> : <StatusPill tone={REVIEW[d.reviewStatus].tone}>{REVIEW[d.reviewStatus].label}</StatusPill>}
      </div>
      {d.suggestion && !open && <p className="as-dmg-reason mb-0">Suggested by the model at low confidence, accepted by the technician.</p>}
      <div className="as-dmg-facts">
        <span>Confidence {percent(d.confidence)}</span>
        {d.areaRatioVehicle != null && <span>{percent(d.areaRatioVehicle, 1)} of vehicle</span>}
        {d.location && <span>{d.location}</span>}
      </div>
      {d.severityReason && <p className="as-dmg-reason">{d.severityReason}</p>}
      {d.reviewedBy && d.reviewStatus !== 'pending' && (
        <p className="as-dmg-reason">{REVIEW[d.reviewStatus].label} by {d.reviewedBy}</p>
      )}
      {editable && (
        <div className="as-dmg-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-sm btn-light" disabled={busy || d.reviewStatus === 'confirmed'} onClick={onConfirm}>
            <i className="bi bi-check-lg me-1" aria-hidden="true" />{open ? 'Accept' : 'Confirm'}
          </button>
          <button type="button" className="btn btn-sm btn-light" disabled={busy} onClick={onCorrect}>
            <i className="bi bi-pencil me-1" aria-hidden="true" />{open ? 'Accept as…' : 'Correct'}
          </button>
          <button type="button" className="btn btn-sm btn-light" disabled={busy || d.reviewStatus === 'rejected'} onClick={onReject}>
            <i className="bi bi-x-lg me-1" aria-hidden="true" />{open ? 'Dismiss' : 'Not damage'}
          </button>
        </div>
      )}
    </li>
  );
}

function CorrectDialog({ inspectionId, d, onClose, onDone }: { inspectionId: number; d: Detection; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState<DamageLabel>(finalLabel(d));
  const current = finalSeverity(d);
  const [severity, setSeverity] = useState<Severity>(current && current !== 'unavailable' ? current : 'minor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('PATCH', `/inspections/${inspectionId}/detections/${d.detectionId}`, { decision: 'corrected', label, severity });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The correction could not be saved.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Correct ${DAMAGE_LABELS[d.label].toLowerCase()}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="correct-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <form id="correct-form" onSubmit={submit} noValidate>
        <p className="small">
          The model said <b>{DAMAGE_LABELS[d.label]}</b>
          {d.severity && d.severity !== 'unavailable' && <>, <b>{SEVERITY[d.severity].label.toLowerCase()}</b></>}. Your correction is kept
          next to the model's answer, so the model can be evaluated later.
        </p>
        <SelectField label="Damage type" value={label} onChange={(e) => setLabel(e.target.value as DamageLabel)}>
          {(Object.keys(DAMAGE_LABELS) as DamageLabel[]).map((l) => <option key={l} value={l}>{DAMAGE_LABELS[l]}</option>)}
        </SelectField>
        <SelectField label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
          {(['minor', 'moderate', 'severe'] as const).map((s) => <option key={s} value={s}>{SEVERITY[s].label}</option>)}
        </SelectField>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ inspection, onClose, onDone }: { inspection: InspectionDetail; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const all = inspection.images.flatMap((im) => im.detections);
  const kept = all.filter((d) => isFinding(d) && d.reviewStatus !== 'rejected');
  const undecided = all.filter(isOpenSuggestion).length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/inspections/${inspection.inspectionId}/confirm`, { notes });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The inspection could not be confirmed.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Confirm ${inspection.inspectionNo}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="confirm-form" className="btn btn-primary" disabled={busy}>{busy ? 'Confirming…' : 'Confirm inspection'}</button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <form id="confirm-form" onSubmit={submit} noValidate>
        <p className="small">
          {kept.length === 0
            ? 'No damage will be recorded on this vehicle.'
            : `${kept.length} damage ${kept.length === 1 ? 'region' : 'regions'} will be recorded.`}{' '}
          {undecided > 0 && `${undecided} possible ${undecided === 1 ? 'region you did not accept is' : 'regions you did not accept are'} dismissed. `}
          The report becomes final and the customer can see it in their account.
        </p>
        <div className="mb-3">
          <label className="form-label" htmlFor="confirm-notes">Note for the report (optional)</label>
          <textarea id="confirm-notes" className="form-control" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
