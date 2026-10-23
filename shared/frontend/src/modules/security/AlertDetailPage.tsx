import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { formatDate, formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { AlertFrame, SeverityPill, ThreatCell } from './SecurityParts';
import type { AlertDetail, Resolution } from './security.types';
import { ACTION, alertStatus, classLabel, formatSeconds, PERSON_ROLE, percent, roleLabel, SEVERITY, ZONE_TYPE } from './security.ui';
import './security.css';

/** Who to call for a confirmed critical threat. */
const EMERGENCY: Partial<Record<AlertDetail['threatType'], string>> = {
  fire: 'the fire service (110)',
  smoke: 'the fire service (110)',
  weapon: 'the police (119)',
  tampering: 'the police (119)',
};

/**
 * One alert (SAFETY_ALERTS): what the camera saw, why it has this severity, what is affected and who is told, and
 * its timeline. With SAFETY_ALERT_ACK a guard acknowledges it, records what was done and resolves it.
 */
export function AlertDetailPage() {
  const { id } = useParams();
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<AlertDetail>(`/security/alerts/${id}`, undefined, { refreshMs: 30_000 });
  const [dialog, setDialog] = useState<'resolve' | 'action' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (error && !data) {
    return (
      <div className="app-content pt-4">
        <div className="container-fluid">
          <ErrorState error={error} onRetry={reload} title={error.status === 404 ? 'Alert not found' : undefined} />
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

  const status = alertStatus(data);
  const handling = can('SAFETY_ALERT_ACK') && data.status !== 'resolved';
  const emergency = EMERGENCY[data.threatType];

  async function acknowledge() {
    setBusy(true);
    setActionError(null);
    try {
      await apiSend('POST', `/security/alerts/${data!.alertId}/acknowledge`);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'The alert could not be acknowledged.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={
          <>
            <span className="as-mono">{data.alertNo}</span> <SeverityPill severity={data.severity} /> <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </>
        }
        documentTitle={data.alertNo}
        subtitle={
          <>
            <span className="fw-semibold">{data.threatName}</span>
            <span aria-hidden="true">·</span>
            <span>{data.camera ?? 'Unknown camera'}{data.zone && `, ${data.zone}`}</span>
            <span aria-hidden="true">·</span>
            <span>
              {formatDate(data.detectedAt)} {formatTime(data.detectedAt)}
              {data.status !== 'resolved' && ` (${formatDuration(minutesSince(data.detectedAt))} ago)`}
            </span>
          </>
        }
        actions={
          <>
            <Link className="btn btn-light" to="/safety/alerts">
              <i className="bi bi-arrow-left me-1" aria-hidden="true" />
              Back
            </Link>
            {handling && (
              <>
                <button type="button" className="btn btn-light" onClick={() => setDialog('action')}>
                  <i className="bi bi-journal-plus me-1" aria-hidden="true" />
                  Record action
                </button>
                {data.status === 'open' ? (
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={acknowledge}>
                    <i className="bi bi-person-check me-1" aria-hidden="true" />
                    {busy ? 'Acknowledging…' : 'Acknowledge'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => setDialog('resolve')}>
                    <i className="bi bi-check2-circle me-1" aria-hidden="true" />
                    Resolve
                  </button>
                )}
              </>
            )}
          </>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          {actionError && <Alert>{actionError}</Alert>}

          {data.isSynthetic && (
            <Alert tone="info">
              <b>Synthetic test video, not a real incident.</b> This alert was found in a test clip on the Model demo and is not part of the
              Alerts list or the alert figures.
            </Alert>
          )}
          {!data.isSynthetic && data.status !== 'resolved' && data.severity === 'critical' && (
            <Alert>
              <b>Critical: check the camera or the area now.</b>{' '}
              {emergency ? `If the threat is real, call ${emergency}, then record it here with Record action.` : 'If the threat is real, alert the centre manager.'}{' '}
              Nobody outside the centre is contacted automatically.
            </Alert>
          )}
          {data.status === 'resolved' && (
            <Alert tone={data.resolution === 'false_alarm' ? 'info' : 'success'}>
              {data.resolution === 'false_alarm' ? 'Marked as a false alarm' : 'Resolved'}
              {data.resolvedBy && ` by ${data.resolvedBy}`}
              {data.resolvedAt && ` on ${formatDate(data.resolvedAt)} at ${formatTime(data.resolvedAt)}`}.
              {data.resolutionNote && <div className="mt-1">{data.resolutionNote}</div>}
            </Alert>
          )}
          <Alert tone="info">
            This alert was raised by the AI security service. Confidence is the model's confidence, not a probability of being
            right, and a person is only treated as staff when the model sees a uniform. Check before acting: the system flags, a person decides.
          </Alert>

          <div className="row g-3">
            <div className="col-xl-7">
              <Card icon="bi-camera-video" title="What the camera saw" subtitle={data.summary || undefined}>
                <div className="as-sec-body">
                  {data.hasSnapshot ? (
                    <img className="as-sec-snapshot" src={`/api/security/alerts/${data.alertId}/snapshot`}
                      alt={`Evidence frame of ${data.alertNo}: ${data.threatName}`} />
                  ) : (
                    <AlertFrame detections={data.detections} cameraName={data.camera} />
                  )}
                  {data.video && (
                    <p className="small mt-2 mb-0">
                      <i className="bi bi-film me-1" aria-hidden="true" />
                      From recorded video <b>{data.video.fileName}</b> at {Math.floor(data.video.timeS / 60)}:{String(Math.floor(data.video.timeS % 60)).padStart(2, '0')}.{' '}
                      <Link to={`/safety/videos/${data.video.videoAnalysisId}?t=${Math.max(0, Math.floor(data.video.timeS) - 1)}`}>Watch this moment</Link>
                    </p>
                  )}
                  {data.detections.length > 0 && (
                  <div className="table-responsive mt-3">
                    <table className="table as-table mb-0">
                      <thead>
                        <tr>
                          <th>Detected</th>
                          <th className="text-end">Model confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.detections.map((d, i) => (
                          <tr key={i}>
                            <td>{classLabel(d.label)}</td>
                            <td className="text-end as-num">{percent(d.confidence)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              </Card>

              <Card icon="bi-clock-history" title="Timeline">
                <ol className="as-sec-timeline as-sec-body">
                  {data.actions.map((a, i) => (
                    <li key={i}>
                      <span className={`as-sec-threat-ic as-tone-${toneOf(a.action)}`}>
                        <i className={`bi ${ACTION[a.action].icon}`} aria-hidden="true" />
                      </span>
                      <div>
                        <b>{ACTION[a.action].label}</b>
                        <small className="as-num">
                          {formatDate(a.at)} {formatTime(a.at)}
                          {a.by ? ` · ${a.by}` : a.action === 'raised' || a.action === 'escalated' ? ' · security service' : ''}
                        </small>
                        {a.note && <p>{a.note}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>

            <div className="col-xl-5">
              <Card icon="bi-exclamation-diamond" title="Why this severity">
                <div className="as-sec-body">
                  <ThreatCell threat={data.threatType} severity={data.severity} name={`${data.threat.ref} · ${data.threatName}`} detail={data.threat.detectedBy} />
                  <dl className="as-sec-facts mt-3">
                    <dt>Base severity</dt>
                    <dd><SeverityPill severity={data.baseSeverity} /></dd>
                    <dt>Final severity</dt>
                    <dd><SeverityPill severity={data.severity} escalated={data.escalated} /></dd>
                    {data.escalationReasons.length > 0 && (
                      <>
                        <dt>Raised because</dt>
                        <dd className="as-sec-chips">
                          {data.escalationReasons.map((r) => (
                            <span key={r} className="as-sec-chip"><i className="bi bi-arrow-up" aria-hidden="true" />{r}</span>
                          ))}
                        </dd>
                      </>
                    )}
                    <dt>Rule</dt>
                    <dd className="small text-body-secondary">{data.threat.escalation || '—'}</dd>
                    <dt>Seen for</dt>
                    <dd className="as-num">{formatSeconds(data.durationS)}</dd>
                    <dt>Main detection</dt>
                    <dd className="as-num">{percent(data.confidence)} model confidence</dd>
                    <dt>Model</dt>
                    <dd className="as-mono small">{data.model ? `${data.model.name} ${data.model.version}` : '—'}</dd>
                  </dl>
                </div>
              </Card>

              <Card icon="bi-bullseye" title="Who and what is affected">
                <div className="as-sec-body">
                  <dl className="as-sec-facts">
                    <dt>Vehicle</dt>
                    <dd>
                      {data.affectedVehicle ? (
                        <>
                          <b className="as-mono">{data.affectedVehicle.registrationNo}</b> · {data.affectedVehicle.description}
                          <div className="small text-body-secondary">
                            {[data.affectedVehicle.bay, data.affectedVehicle.jobNo, data.affectedVehicle.owner && `Owner: ${data.affectedVehicle.owner}`]
                              .filter(Boolean)
                              .join(' · ') || 'Not linked to a job'}
                          </div>
                        </>
                      ) : (
                        <span className="text-body-secondary">No customer vehicle</span>
                      )}
                    </dd>
                    <dt>People involved</dt>
                    <dd>
                      {data.personsInvolved}
                      {data.personRole && data.personsInvolved > 0 && <span className="text-body-secondary"> · {PERSON_ROLE[data.personRole]}</span>}
                    </dd>
                    <dt>People nearby</dt>
                    <dd>{data.personsAffected > 0 ? `${data.personsAffected} at risk` : 'None'}</dd>
                    <dt>Zone</dt>
                    <dd>
                      {data.zoneInfo ? (
                        <>
                          {data.zoneInfo.name}{' '}
                          <StatusPill tone={ZONE_TYPE[data.zoneInfo.zoneType].tone}>{ZONE_TYPE[data.zoneInfo.zoneType].label}</StatusPill>
                          <div className="small text-body-secondary">{ZONE_TYPE[data.zoneInfo.zoneType].rule}</div>
                        </>
                      ) : '—'}
                    </dd>
                    <dt>Camera</dt>
                    <dd>
                      {data.cameraInfo ? (
                        <>
                          {data.cameraInfo.name} <span className="as-mono small">{data.cameraInfo.code}</span>{' '}
                          {data.cameraInfo.status === 'offline' && <StatusPill tone="danger">Offline</StatusPill>}
                          {data.cameraInfo.location && <div className="small text-body-secondary">{data.cameraInfo.location}</div>}
                        </>
                      ) : '—'}
                    </dd>
                  </dl>
                </div>
              </Card>

              <Card icon="bi-bell" title="Who is told" subtitle={`For ${SEVERITY[data.severity].label.toLowerCase()} ${data.threatName.toLowerCase()}`}>
                <div className="as-sec-body">
                  {data.notifyRoles.length === 0 ? (
                    <p className="small text-body-secondary mb-0">Logged on this screen only.</p>
                  ) : (
                    <div className="as-sec-chips">
                      {data.notifyRoles.map((r) => (
                        <span key={r} className="as-sec-chip"><i className="bi bi-person" aria-hidden="true" />{roleLabel(r)}</span>
                      ))}
                    </div>
                  )}
                  <p className="small text-body-secondary mt-2 mb-0">
                    The fire service, the police and the vehicle owner are contacted by staff, only after they confirm the threat.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>

      {dialog === 'resolve' && (
        <ResolveDialog alert={data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      )}
      {dialog === 'action' && (
        <ActionDialog alert={data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); reload(); }} />
      )}
    </>
  );
}

function toneOf(action: AlertDetail['actions'][number]['action']) {
  if (action === 'raised' || action === 'escalated' || action === 'emergency_called') return 'danger';
  if (action === 'resolved') return 'success';
  if (action === 'acknowledged') return 'brand';
  return 'muted';
}

function ResolveDialog({ alert, onClose, onDone }: { alert: AlertDetail; onClose: () => void; onDone: () => void }) {
  const [resolution, setResolution] = useState<Resolution>('handled');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/security/alerts/${alert.alertId}/resolve`, { resolution, note });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const noteError = fieldErrors(error).note;
  return (
    <Modal
      title={`Resolve ${alert.alertNo}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="resolve-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Resolve alert'}</button>
        </>
      }
    >
      {error instanceof ApiError && !noteError && <Alert>{error.message}</Alert>}
      <form id="resolve-form" onSubmit={submit} noValidate>
        <fieldset className="mb-3">
          <legend className="form-label fs-6">What was it?</legend>
          <div className="form-check">
            <input className="form-check-input" type="radio" id="res-handled" name="resolution" checked={resolution === 'handled'} onChange={() => setResolution('handled')} />
            <label className="form-check-label" htmlFor="res-handled">A real threat, and it has been dealt with</label>
          </div>
          <div className="form-check">
            <input className="form-check-input" type="radio" id="res-false" name="resolution" checked={resolution === 'false_alarm'} onChange={() => setResolution('false_alarm')} />
            <label className="form-check-label" htmlFor="res-false">A false alarm: the model was wrong</label>
          </div>
        </fieldset>
        <div className="mb-2">
          <label className="form-label" htmlFor="resolve-note">
            {resolution === 'false_alarm' ? 'What did the model get wrong?' : 'What was done? (optional)'}
          </label>
          <textarea id="resolve-note" className={`form-control${noteError ? ' is-invalid' : ''}`} rows={3} maxLength={500}
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={resolution === 'false_alarm' ? 'e.g. A mechanic carrying a tyre lever, not a weapon' : 'e.g. Spoke to the visitor; they were waiting for their car'} />
          {noteError && <div className="invalid-feedback">{noteError}</div>}
        </div>
        {resolution === 'false_alarm' && (
          <p className="small text-body-secondary mb-0">False alarms are counted to measure the model and tune the rules.</p>
        )}
      </form>
    </Modal>
  );
}

function ActionDialog({ alert, onClose, onDone }: { alert: AlertDetail; onClose: () => void; onDone: () => void }) {
  const canCall = alert.severity === 'high' || alert.severity === 'critical';
  const options = [
    canCall && { value: 'emergency_called', label: 'I called emergency services', hint: EMERGENCY[alert.threatType] ? `e.g. ${EMERGENCY[alert.threatType]}` : 'Fire service or police' },
    alert.affectedVehicle && { value: 'owner_informed', label: 'I informed the vehicle owner', hint: alert.affectedVehicle.owner ?? alert.affectedVehicle.registrationNo },
    { value: 'note', label: 'Add a note', hint: 'What you saw or did' },
  ].filter((o): o is { value: string; label: string; hint: string } => Boolean(o));

  const [action, setAction] = useState(options[0]!.value);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/security/alerts/${alert.alertId}/actions`, { action, note });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const noteError = fieldErrors(error).note;
  return (
    <Modal
      title="Record action"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="action-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      {error instanceof ApiError && !noteError && <Alert>{error.message}</Alert>}
      <form id="action-form" onSubmit={submit} noValidate>
        <fieldset className="mb-3">
          <legend className="visually-hidden">Action</legend>
          {options.map((o) => (
            <div className="form-check mb-1" key={o.value}>
              <input className="form-check-input" type="radio" id={`act-${o.value}`} name="action" checked={action === o.value} onChange={() => setAction(o.value)} />
              <label className="form-check-label" htmlFor={`act-${o.value}`}>
                {o.label}
                <div className="small text-body-secondary">{o.hint}</div>
              </label>
            </div>
          ))}
        </fieldset>
        <div className="mb-2">
          <label className="form-label" htmlFor="action-note">{action === 'note' ? 'Note' : 'Details (optional)'}</label>
          <textarea id="action-note" className={`form-control${noteError ? ' is-invalid' : ''}`} rows={3} maxLength={500}
            value={note} onChange={(e) => setNote(e.target.value)} />
          {noteError && <div className="invalid-feedback">{noteError}</div>}
        </div>
      </form>
    </Modal>
  );
}
