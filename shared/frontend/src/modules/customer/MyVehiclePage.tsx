import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate, formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import type { InspectionReport, MyVehicle } from './customer.types';
import { DamageMap } from './DamageMap';
import { ReportPhoto } from './ReportPhoto';
import { SEVERITY_TONE } from './severity';
import './report.css';

const JOURNEY = ['Checked in', 'Inspected', 'Waiting for a bay', 'In service', 'Ready for pickup'];
const LABELS: Record<string, string> = {
  dent: 'Dent', scratch: 'Scratch', crack: 'Crack', glass_shatter: 'Broken glass', lamp_broken: 'Broken lamp', tire_flat: 'Flat tyre',
};
const VIEWS: Record<string, string> = { front: 'Front', rear: 'Rear', left: 'Left side', right: 'Right side', other: 'Close-up' };

type Tab = 'status' | 'inspections' | 'maintenance' | 'safety';

/** One of my vehicles: status, confirmed inspection reports, recommendations, safety notices (tabs the admin allows). */
export function MyVehiclePage() {
  const { id } = useParams();
  const data = useApi<MyVehicle>(`/my/vehicles/${id}`, undefined, { refreshMs: 60_000 });
  const tabs = data.data
    ? ([
        ['status', 'Status'],
        ['inspections', 'Inspection reports'],
        ['maintenance', 'Recommendations'],
        ['safety', 'Safety notices'],
      ] as const).filter(([key]) => data.data!.sections[key].available)
    : [];
  const [tab, setTab] = useState<Tab | null>(null);
  const current = tab ?? tabs[0]?.[0] ?? null;

  useEffect(() => {
    if (data.data) document.title = `${data.data.vehicle.registrationNo} · AutoSense`;
  }, [data.data]);

  if (data.error && !data.data) {
    return (
      <>
        <Link to="/my" className="small">‹ My vehicles</Link>
        <ErrorState error={data.error} onRetry={data.reload} title="This vehicle couldn't be shown" />
      </>
    );
  }
  if (!data.data) return <div className="p-4"><Skeleton width="40%" /></div>;
  const { vehicle, sections } = data.data;

  return (
    <>
      <Link to="/my" className="small text-decoration-none">‹ My vehicles</Link>
      <div className="d-flex align-items-center gap-3 my-3">
        <span className="as-vehicle-ic"><i className="bi bi-car-front" aria-hidden="true" /></span>
        <div>
          <h1 className="as-page-title as-plate" style={{ fontSize: '1.5rem' }}>{vehicle.registrationNo}</h1>
          <div className="text-body-secondary small">{vehicle.description}{vehicle.colour ? ` · ${vehicle.colour}` : ''}</div>
        </div>
      </div>

      <Card>
        <div className="as-tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={current === key} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <div className="p-4">
          {current === 'status' && sections.status.available && <StatusTab status={sections.status.data} />}
          {current === 'inspections' && sections.inspections.available && <InspectionsTab vehicle={vehicle} inspections={sections.inspections.data} />}
          {current === 'maintenance' && (
            <EmptyState icon="bi-wrench-adjustable" title="No recommendations yet">
              Maintenance work the technician recommends for this vehicle will appear here.
            </EmptyState>
          )}
          {current === 'safety' && (
            <EmptyState icon="bi-shield-check" title="No safety notices">
              If the service centre raises a safety check involving your vehicle, you'll see it here.
            </EmptyState>
          )}
          {tabs.length === 0 && <EmptyState title="Nothing to show for this vehicle yet" />}
        </div>
      </Card>
    </>
  );
}

function StatusTab({ status }: { status: Extract<MyVehicle['sections']['status'], { available: true }>['data'] }) {
  if (!status) {
    return (
      <EmptyState icon="bi-calendar-check" title="Not at the service centre">
        When you bring the vehicle in, you can follow each step here.
      </EmptyState>
    );
  }
  const step = STAGES[status.stage].step;
  return (
    <div className="d-grid gap-4">
      <div className="d-flex justify-content-between flex-wrap gap-2">
        <div>
          <div className="small text-body-secondary">{status.service} · {status.jobNo}</div>
          <div className="fs-5 fw-semibold">{STAGES[status.stage].label}{status.bay ? ` · ${status.bay}` : ''}</div>
        </div>
        <StatusPill tone={STAGES[status.stage].tone}>{STAGES[status.stage].label}</StatusPill>
      </div>
      <ol className="as-journey" aria-label="Progress">
        {JOURNEY.map((label, i) => (
          <li key={label} className={`${i + 1 <= step ? 'done' : ''}${i + 1 === step ? ' now' : ''}`}>{label}</li>
        ))}
      </ol>
      <dl className="row small mb-0">
        <dt className="col-sm-4 text-body-secondary fw-normal">Checked in</dt>
        <dd className="col-sm-8">{formatDate(status.checkedInAt)} at {formatTime(status.checkedInAt)}</dd>
        {status.queuePosition !== null && (
          <>
            <dt className="col-sm-4 text-body-secondary fw-normal">Place in queue</dt>
            <dd className="col-sm-8">{status.queuePosition === 1 ? 'Next for a free bay' : `${status.queuePosition} in line for a bay`}</dd>
          </>
        )}
        {status.bayEnteredAt && (
          <>
            <dt className="col-sm-4 text-body-secondary fw-normal">In service for</dt>
            <dd className="col-sm-8">{formatDuration(minutesSince(status.bayEnteredAt))}</dd>
          </>
        )}
        <dt className="col-sm-4 text-body-secondary fw-normal">Estimated ready</dt>
        <dd className="col-sm-8 text-body-secondary">{status.estimatedReadyAt ? formatTime(status.estimatedReadyAt) : 'Not available yet'}</dd>
      </dl>
    </div>
  );
}

function InspectionsTab({ vehicle, inspections }: {
  vehicle: MyVehicle['vehicle'];
  inspections: Extract<MyVehicle['sections']['inspections'], { available: true }>['data'];
}) {
  if (inspections.length === 0) {
    return (
      <EmptyState icon="bi-clipboard-check" title="No inspection reports yet">
        After a technician confirms an inspection of your vehicle, the report appears here.
      </EmptyState>
    );
  }
  return (
    <div className="d-grid gap-3">
      {inspections.map((i) => <Report key={i.inspectionNo} vehicle={vehicle} i={i} />)}
      <p className="small text-body-secondary mb-0">Reports are checked by a technician. Severity is a guide, not a repair quote.</p>
    </div>
  );
}

/** Prints just this report (the browser's print dialog also saves it as a PDF); the rest of the page is hidden. */
function printReport(section: HTMLElement) {
  document.body.classList.add('as-printing');
  section.classList.add('as-print-target');
  const done = () => {
    document.body.classList.remove('as-printing');
    section.classList.remove('as-print-target');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

function Report({ vehicle, i }: { vehicle: MyVehicle['vehicle']; i: InspectionReport }) {
  const section = useRef<HTMLElement>(null);
  const bySeverity = (['severe', 'moderate', 'minor'] as const)
    .map((s) => [s, i.findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0);

  return (
    <section ref={section} className="as-card p-3">
      <div className="as-print-only mb-3">
        <div className="fs-5 fw-semibold">AutoSense · Vehicle inspection report</div>
        <div className="small text-body-secondary">
          {vehicle.registrationNo} · {vehicle.description}{vehicle.colour ? ` · ${vehicle.colour}` : ''} · printed {formatDate(new Date())}
        </div>
        <hr />
      </div>
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <b>Inspection {i.inspectionNo}</b>
        <span className="d-flex align-items-center gap-2 small text-body-secondary">
          Confirmed {formatDate(i.confirmedAt)}
          {i.overallSeverity ? (
            i.overallSeverity !== 'unavailable' && <StatusPill tone={SEVERITY_TONE[i.overallSeverity] ?? 'muted'}>Overall: {severityText(i.overallSeverity)}</StatusPill>
          ) : (
            <StatusPill tone="success">No damage</StatusPill>
          )}
          <button type="button" className="btn btn-sm btn-light" onClick={() => section.current && printReport(section.current)}>
            <i className="bi bi-printer me-1" aria-hidden="true" />Print / PDF
          </button>
        </span>
      </div>
      {i.notes && (
        <p className="small mb-3"><i className="bi bi-chat-left-text me-1 text-body-secondary" aria-hidden="true" />Technician's note: {i.notes}</p>
      )}
      {i.findings.length === 0 ? (
        <p className="small mb-0 text-body-secondary">No visible damage was recorded.</p>
      ) : (
        <div className="d-grid gap-3">
          <div className="row g-3 align-items-center">
            <div className="col-sm-5 col-md-4 d-flex justify-content-center">
              <DamageMap findings={i.findings} />
            </div>
            <div className="col-sm-7 col-md-8">
              <div className="small fw-semibold mb-2">
                {i.findings.length} {i.findings.length === 1 ? 'damaged area' : 'damaged areas'} found and checked by a technician
              </div>
              <div className="as-report-counts mb-2">
                {bySeverity.map(([s, n]) => (
                  <StatusPill key={s} tone={SEVERITY_TONE[s] ?? 'muted'}>{n} {s}</StatusPill>
                ))}
              </div>
              <p className="small text-body-secondary mb-0">
                The numbers on the drawing match the photos and the list below. Severity is a guide to how serious the damage
                looks, not a repair quote.
              </p>
            </div>
          </div>
          <div className="d-grid gap-3">
              {i.photos.filter((p) => p.findings.length > 0).map((p) => (
                <div key={p.imageId} className="row g-3 align-items-start">
                  <div className="col-md-7">
                    <ReportPhoto url={p.url} width={p.width} height={p.height} findings={p.findings} alt={`${VIEWS[p.viewAngle] ?? 'Vehicle'} photo`} />
                  </div>
                  <div className="col-md-5">
                    <div className="small fw-semibold mb-2">{VIEWS[p.viewAngle] ?? 'Photo'}</div>
                    <ol className="list-unstyled mb-0 d-grid gap-2">
                      {p.findings.map((f) => (
                        <li key={f.no} className="d-flex justify-content-between align-items-start gap-2 small">
                          <span>
                            <b className="me-1">{f.no}.</b>
                            {LABELS[f.label] ?? f.label}
                            {f.location && <span className="text-body-secondary"> · {f.location} of the photo</span>}
                          </span>
                          {f.severity && f.severity !== 'unavailable' && (
                            <StatusPill tone={SEVERITY_TONE[f.severity] ?? 'muted'}>{severityText(f.severity)}</StatusPill>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
      <p className="as-print-only small text-body-secondary mt-3 mb-0">
        Checked by a technician at the service centre. Severity is a guide, not a repair quote.
      </p>
    </section>
  );
}

const severityText = (s: string) => s[0]!.toUpperCase() + s.slice(1);
