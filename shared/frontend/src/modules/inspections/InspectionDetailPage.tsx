import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
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
import { Celebration } from './Celebration';
import { DamagePhoto } from './DamagePhoto';
import { PhotoViewer } from './PhotoViewer';
import { Toasts } from './Toasts';
import { useToasts } from './useToasts';
import type { DamageLabel, Detection, InspectionDetail, RepairPlan, Severity } from './inspections.types';
import { DAMAGE_LABELS, PRIORITY, REVIEW, SEVERITY, STATUS, VIEW_ANGLES, finalLabel, finalSeverity, hours, isFinding, isOpenSuggestion, percent } from './inspections.ui';
import './inspections.css';

/**
 * One inspection: each photo with the damage outlines, and beside it the regions the model found. A technician
 * confirms, corrects or rejects each region (INSPECTION_REVIEW); once none is left to review, someone with
 * INSPECTION_CONFIRM confirms the inspection, which makes it final and visible to the customer.
 */
export function InspectionDetailPage() {
  const { id } = useParams();
  const { can } = useSession();
  const { data: loaded, error, loading, reload } = useApi<InspectionDetail>(`/inspections/${id}`);
  // The latest version after a review action (optimistic, then the server's answer). A fresh load replaces it.
  const [latest, setLatest] = useState<{ base: InspectionDetail; value: InspectionDetail } | null>(null);
  const data = latest && loaded && latest.base === loaded ? latest.value : loaded;
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState<Detection | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState<{ kept: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [drawingImage, setDrawingImage] = useState<number | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const { toasts, show } = useToasts();
  const location = useLocation();
  const navigate = useNavigate();

  // A message handed over by the previous page (e.g. "Inspection created"), shown once
  useEffect(() => {
    const message = (location.state as { toast?: string } | null)?.toast;
    if (!message) return;
    show(message);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate, show]);
  const [adding, setAdding] = useState<{ imageId: number; bbox: [number, number, number, number] } | null>(null);

  // Region numbers run across all photos, so "3" means the same region on the photo and in the list.
  // Possible damage is numbered P1, P2...; dismissed possible damage gets no number and is not drawn.
  const numbers = useMemo(() => {
    const map = new Map<number, string>();
    const all = data?.images.flatMap((im) => im.detections) ?? [];
    all.filter(isFinding).forEach((d, n) => map.set(d.detectionId, String(n + 1)));
    all.filter(isOpenSuggestion).forEach((d, n) => map.set(d.detectionId, `P${n + 1}`));
    return map;
  }, [data]);

  // Keep the selected region in view when it changes (keyboard or click)
  useEffect(() => {
    if (selected !== null) document.querySelector(`[data-detection="${selected}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

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
          <Card><div className="as-card-body pt-3"><Skeleton width="30%" /><div className="mt-3"><Skeleton width="100%" /></div></div></Card>
        </div>
      </div>
    );
  }

  const editable = data.status === 'awaiting_review' && can('INSPECTION_REVIEW');
  const all = data.images.flatMap((im) => im.detections);
  const findings = all.filter(isFinding);
  const pending = findings.filter((d) => d.reviewStatus === 'pending').length;
  const possible = all.filter(isOpenSuggestion).length;
  const order = [...numbers.keys()]; // regions in the order they are numbered: findings, then possible damage
  const modalOpen = !!(correcting || confirming || adding || drawingImage) || viewerIndex !== null;

  /** Shows the decision at once, then the server's version; puts the page back if saving fails. */
  async function review(d: Detection, decision: 'confirmed' | 'rejected' | 'remove') {
    if (busyId) return;
    const base = loaded!;
    const before = data!;
    setBusyId(d.detectionId);
    setActionError(null);
    setLatest({ base, value: withDecision(before, d.detectionId, decision) });
    try {
      const path = `/inspections/${before.inspectionId}/detections/${d.detectionId}`;
      const fresh = await (decision === 'remove'
        ? apiSend<InspectionDetail>('DELETE', path)
        : apiSend<InspectionDetail>('PATCH', path, { decision }));
      setLatest({ base, value: fresh });
      const no = numbers.get(d.detectionId);
      const open = d.suggestion && d.reviewStatus === 'pending';
      show(
        decision === 'remove' ? 'Added damage removed'
        : decision === 'confirmed' ? (open ? 'Possible damage accepted' : `Region ${no} confirmed`)
        : open ? 'Suggestion dismissed' : `Region ${no} marked as not damage`,
      );
    } catch (err) {
      setLatest({ base, value: before });
      setActionError(err instanceof ApiError ? err.message : 'The change could not be saved.');
    } finally {
      setBusyId(null);
    }
  }

  /** The next region after `from` that still needs a decision (wrapping round), for auto-advance. */
  function nextOpen(from: number | null) {
    const start = from === null ? -1 : order.indexOf(from);
    for (let k = 1; k <= order.length; k++) {
      const candidate = all.find((d) => d.detectionId === order[(start + k) % order.length]);
      if (candidate && candidate.reviewStatus === 'pending' && candidate.detectionId !== from) return candidate.detectionId;
    }
    return null;
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
                className={`btn btn-primary${pending === 0 ? ' as-ready' : ''}`}
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

          <section className="as-card as-kpis mb-3" aria-label="Inspection summary">
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

          <RepairGuide plan={data.repair} reviewing={data.status === 'awaiting_review'} />

          {editable && (
            <ReviewProgress
              reviewed={findings.length - pending}
              total={findings.length}
              possible={possible}
              canConfirm={can('INSPECTION_CONFIRM')}
            />
          )}
          {editable && (
            <ReviewKeys
              disabled={modalOpen}
              order={order}
              selected={selected}
              onMove={setSelected}
              onDecide={(decision) => {
                const d = all.find((x) => x.detectionId === selected);
                if (!d || d.source === 'technician') return;
                setSelected(nextOpen(d.detectionId) ?? d.detectionId);
                void review(d, decision);
              }}
              onCorrect={() => {
                const d = all.find((x) => x.detectionId === selected);
                if (d && d.source !== 'technician') setCorrecting(d);
              }}
            />
          )}

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
            <Card
              key={image.imageId}
              className="mb-3"
              icon="bi-camera"
              title={VIEW_ANGLES[image.viewAngle]}
              subtitle={photoFacts(image)}
              actions={
                editable &&
                (drawingImage === image.imageId ? (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => setDrawingImage(null)}>Cancel</button>
                ) : (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => setDrawingImage(image.imageId)}>
                    <i className="bi bi-bounding-box-circles me-1" aria-hidden="true" />Add missed damage
                  </button>
                ))
              }
            >
              <div className="as-card-body">
              {drawingImage === image.imageId && (
                <Alert tone="info">Drag a box around the damage the model missed, then choose its type and severity.</Alert>
              )}
              {image.quality.warnings && image.quality.warnings.length > 0 && (
                <Alert tone="warning">
                  Photo quality: {image.quality.warnings.join(' ')} Results from this photo may be less reliable.
                </Alert>
              )}
              <div className="row g-3">
                <div className="col-lg-7">
                  <div className="as-dmg-stick">
                    <DamagePhoto
                      image={image}
                      numbers={numbers}
                      selected={selected}
                      hovered={hovered}
                      onSelect={setSelected}
                      onHover={setHovered}
                      onExpand={() => setViewerIndex(data.images.indexOf(image))}
                      drawing={drawingImage === image.imageId}
                      intro={data.status === 'awaiting_review'}
                      onDrawn={(bbox) => {
                        setDrawingImage(null);
                        setAdding({ imageId: image.imageId, bbox });
                      }}
                    />
                  </div>
                </div>
                <div className="col-lg-5">
                  {(() => {
                    const item = (d: Detection) => (
                      <RegionItem
                        key={d.detectionId}
                        d={d}
                        no={numbers.get(d.detectionId) ?? ''}
                        serviceName={data.repair.services.find((s) => s.code === d.repair?.service)?.name ?? null}
                        on={selected === d.detectionId || hovered === d.detectionId}
                        editable={editable}
                        busy={busyId === d.detectionId}
                        onSelect={() => setSelected(d.detectionId)}
                        onHover={(over) => setHovered(over ? d.detectionId : null)}
                        onConfirm={() => review(d, 'confirmed')}
                        onReject={() => review(d, 'rejected')}
                        onRemove={() => review(d, 'remove')}
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
            show('Correction saved');
          }}
        />
      )}
      {adding && (
        <AddRegionDialog
          inspectionId={data.inspectionId}
          {...adding}
          onClose={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            reload();
            show('Missed damage added');
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          inspection={data}
          onClose={() => setConfirming(false)}
          onDone={(kept) => {
            setConfirming(false);
            reload();
            setConfirmed({ kept });
          }}
        />
      )}
      {confirmed && (
        <Celebration
          title="Inspection confirmed"
          primary={can('INSPECTION_REVIEW') ? 'Next in review queue' : 'Back to inspections'}
          onPrimary={() => navigate(can('INSPECTION_REVIEW') ? '/inspections/review' : '/inspections')}
          onClose={() => setConfirmed(null)}
        >
          {confirmed.kept === 0
            ? `No damage is recorded on ${data.vehicle.registrationNo}.`
            : `${confirmed.kept} damage ${confirmed.kept === 1 ? 'region is' : 'regions are'} now in ${data.vehicle.registrationNo}'s report.`}{' '}
          The customer can see it in their account.
        </Celebration>
      )}
      {viewerIndex !== null && data.images[viewerIndex] && (
        <PhotoViewer
          images={data.images}
          index={viewerIndex}
          numbers={numbers}
          selected={selected}
          onSelect={setSelected}
          onIndex={(n) => setViewerIndex(Math.max(0, Math.min(data.images.length - 1, n)))}
          onClose={() => setViewerIndex(null)}
        />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}

/** The inspection with one decision applied locally (shown before the server answers). */
function withDecision(inspection: InspectionDetail, detectionId: number, decision: 'confirmed' | 'rejected' | 'remove'): InspectionDetail {
  return {
    ...inspection,
    images: inspection.images.map((im) => ({
      ...im,
      detections:
        decision === 'remove'
          ? im.detections.filter((d) => d.detectionId !== detectionId)
          : im.detections.map((d) => (d.detectionId === detectionId ? { ...d, reviewStatus: decision } : d)),
    })),
  };
}

/**
 * Repair guide for the inspection (repair-v0): how urgent, which services, and roughly how many workshop hours. It
 * follows the final damage type and severity, so it updates as regions are reviewed or corrected. The hours are
 * proposed values not yet confirmed by the technician: a guide for planning, not a quote.
 */
function RepairGuide({ plan, reviewing }: { plan: RepairPlan; reviewing: boolean }) {
  const top = plan.priority ? PRIORITY[plan.priority] : null;
  return (
    <Card
      className="mb-3 as-repair"
      icon="bi-tools"
      title="Repair guide"
      subtitle={`${reviewing ? 'From the regions found so far; it updates as you review' : 'From the confirmed damage'} · ${plan.method}`}
      actions={top && <StatusPill tone={top.tone}><i className={`bi ${top.icon} me-1`} aria-hidden="true" />{top.label}</StatusPill>}
    >
      {plan.services.length === 0 ? (
        <div className="as-card-body text-body-secondary small">No damage counted, so no repair is suggested.</div>
      ) : (
        <>
          <div className="table-responsive">
            <table className="table as-table mb-0">
              <thead>
                <tr><th>Service</th><th className="text-end">Areas</th><th>Priority</th><th className="text-end">Estimated time</th></tr>
              </thead>
              <tbody>
                {plan.services.map((s) => (
                  <tr key={s.code}>
                    <td className="fw-semibold">{s.name}</td>
                    <td className="text-end as-num">{s.areas}</td>
                    <td><StatusPill tone={PRIORITY[s.priority].tone}>{PRIORITY[s.priority].label}</StatusPill></td>
                    <td className="text-end as-num">{hours(s.effortHours)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="fw-semibold">Total workshop time{plan.notEstimated > 0 && <span className="text-body-secondary fw-normal"> · {plan.notEstimated} not graded, not estimated</span>}</td>
                  <td className="text-end as-num fw-semibold">{hours(plan.effortHours)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="as-card-note mb-0">
            {plan.validated ? '' : "Proposed hours, not yet confirmed by the service centre's technician: a guide for planning, not a quote. "}
            Overlapping regions of one damage count once; areas are repaired one after another.
          </p>
        </>
      )}
    </Card>
  );
}

/** One region's repair line: priority, the service that fixes it, and its estimated time. */
function RegionRepair({ repair, serviceName }: { repair: NonNullable<Detection['repair']>; serviceName: string | null }) {
  return (
    <div className="as-dmg-repair" title={repair.why}>
      <StatusPill tone={PRIORITY[repair.priority].tone}>{PRIORITY[repair.priority].label}</StatusPill>
      {serviceName && <span><i className="bi bi-tools me-1" aria-hidden="true" />{serviceName}</span>}
      {repair.effortHours && <span className="as-num">{hours(repair.effortHours)}</span>}
    </div>
  );
}

function ReviewProgress({ reviewed, total, possible, canConfirm }: { reviewed: number; total: number; possible: number; canConfirm: boolean }) {
  const done = reviewed === total;
  return (
    <section className={`as-card as-dmg-progress${done ? ' done' : ''}`} aria-label="Review progress">
      <div className="d-flex justify-content-between align-items-baseline flex-wrap gap-2">
        <b>{done ? (canConfirm ? 'Every region reviewed: ready to confirm' : 'Every region reviewed') : 'Review progress'}</b>
        <span className="small text-body-secondary as-num">
          {reviewed} of {total} {total === 1 ? 'region' : 'regions'} reviewed
          {possible > 0 && ` · ${possible} possible damage to accept or dismiss`}
        </span>
      </div>
      <div className="as-dmg-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reviewed}>
        <i style={{ width: `${total ? (reviewed / total) * 100 : 100}%` }} />
      </div>
      <div className="as-dmg-keys">
        <span><kbd>J</kbd><kbd>K</kbd> next / previous</span>
        <span><kbd>C</kbd> confirm or accept</span>
        <span><kbd>X</kbd> not damage or dismiss</span>
        <span><kbd>E</kbd> correct</span>
        <span><kbd>Esc</kbd> clear</span>
      </div>
    </section>
  );
}

/**
 * Keyboard review (renders nothing): J/K or arrows move through the regions, C/A confirm or accept, X reject or
 * dismiss, E correct, Esc clears. Off while typing or while a dialog is open.
 */
function ReviewKeys({ disabled, order, selected, onMove, onDecide, onCorrect }: {
  disabled: boolean;
  order: number[];
  selected: number | null;
  onMove: (id: number | null) => void;
  onDecide: (decision: 'confirmed' | 'rejected') => void;
  onCorrect: () => void;
}) {
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const at = selected === null ? -1 : order.indexOf(selected);
      const key = e.key.toLowerCase();
      if ((key === 'j' || key === 'arrowdown') && order.length) onMove(order[Math.min(order.length - 1, at + 1)] ?? null);
      else if ((key === 'k' || key === 'arrowup') && order.length) onMove(order[Math.max(0, at - 1)] ?? null);
      else if (selected !== null && (key === 'c' || key === 'a')) onDecide('confirmed');
      else if (selected !== null && key === 'x') onDecide('rejected');
      else if (selected !== null && key === 'e') onCorrect();
      else if (key === 'escape') onMove(null);
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [disabled, order, selected, onMove, onDecide, onCorrect]);
  return null;
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

function RegionItem({ d, no, serviceName, on, editable, busy, onSelect, onHover, onConfirm, onReject, onRemove, onCorrect }: {
  d: Detection;
  no: string;
  serviceName: string | null;
  on: boolean;
  editable: boolean;
  busy: boolean;
  onSelect: () => void;
  onHover: (over: boolean) => void;
  onConfirm: () => void;
  onReject: () => void;
  onRemove: () => void;
  onCorrect: () => void;
}) {
  const added = d.source === 'technician';
  const open = isOpenSuggestion(d);
  // Possible damage shows the severity it would get if accepted
  const severity = open ? d.severity : finalSeverity(d);
  const tone = severity ? SEVERITY[severity].tone : 'muted';
  const relabelled = d.correctedLabel && d.correctedLabel !== d.label;
  // A brief flash when the decision changes while the page is open (not for decisions loaded with the page)
  const [flash, setFlash] = useState<string | null>(null);
  const shown = useRef(d.reviewStatus);
  useEffect(() => {
    if (shown.current === d.reviewStatus) return;
    shown.current = d.reviewStatus;
    if (d.reviewStatus === 'pending') return;
    setFlash(d.reviewStatus);
    const t = window.setTimeout(() => setFlash(null), 700);
    return () => window.clearTimeout(t);
  }, [d.reviewStatus]);
  return (
    <li
      className={`as-dmg-item st-${d.reviewStatus}${on ? ' on' : ''}${open ? ' possible' : ''}${flash ? ` flash-${flash}` : ''}`}
      data-detection={d.detectionId}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="as-dmg-item-head">
        <span className={`as-dmg-no as-tone-${tone}`} style={{ background: 'none' }}>{no}</span>
        <b>
          {relabelled && <span className="as-dmg-was me-1">{DAMAGE_LABELS[d.label]}</span>}
          {DAMAGE_LABELS[finalLabel(d)]}
        </b>
        {severity && <StatusPill tone={SEVERITY[severity].tone}>{open ? `${SEVERITY[severity].label} if accepted` : SEVERITY[severity].label}</StatusPill>}
        {open ? (
          <StatusPill tone="muted">Possible</StatusPill>
        ) : added ? (
          <StatusPill tone="brand">Added</StatusPill>
        ) : (
          <StatusPill tone={REVIEW[d.reviewStatus].tone}>{REVIEW[d.reviewStatus].label}</StatusPill>
        )}
      </div>
      {d.suggestion && !open && <p className="as-dmg-reason mb-0">Suggested by the model at low confidence, accepted by the technician.</p>}
      {added ? (
        <p className="as-dmg-reason">Missed by the model; added by {d.reviewedBy ?? 'a technician'}.</p>
      ) : (
        <>
          <div className="as-dmg-facts">
            <span>Confidence {percent(d.confidence)}</span>
            {d.areaRatioVehicle != null && <span>{percent(d.areaRatioVehicle, 1)} of vehicle</span>}
            {d.location && <span>{d.location}</span>}
          </div>
          {d.severityReason && <p className="as-dmg-reason">{d.severityReason}</p>}
          {d.repair && <RegionRepair repair={d.repair} serviceName={serviceName} />}
          {d.reviewedBy && d.reviewStatus !== 'pending' && (
            <p className="as-dmg-reason">{REVIEW[d.reviewStatus].label} by {d.reviewedBy}</p>
          )}
        </>
      )}
      {editable && added && (
        <div className="as-dmg-actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-sm btn-light" disabled={busy} onClick={onRemove}>
            <i className="bi bi-trash me-1" aria-hidden="true" />Remove
          </button>
        </div>
      )}
      {editable && !added && (
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

function AddRegionDialog({ inspectionId, imageId, bbox, onClose, onDone }: {
  inspectionId: number;
  imageId: number;
  bbox: [number, number, number, number];
  onClose: () => void;
  onDone: () => void;
}) {
  const [label, setLabel] = useState<DamageLabel>('dent');
  const [severity, setSeverity] = useState<Severity>('minor');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/inspections/${inspectionId}/images/${imageId}/detections`, { label, severity, bbox });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The damage could not be added.');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add missed damage"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-region-form" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add damage'}</button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <form id="add-region-form" onSubmit={submit} noValidate>
        <p className="small">
          It is recorded as damage the model missed. That is how the model's misses are measured, and it becomes a
          new example for retraining.
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

function ConfirmDialog({ inspection, onClose, onDone }: { inspection: InspectionDetail; onClose: () => void; onDone: (kept: number) => void }) {
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
      onDone(kept.length);
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
