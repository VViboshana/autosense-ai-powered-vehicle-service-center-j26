import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import { CarArt, PlateText } from './art';
import type { InspectionReport, MyVehicle } from './customer.types';
import { JOURNEY, JOURNEY_STEPS, journeyStep, ordinal, plural } from './customer.ui';
import { InspectionReportView } from './InspectionReportView';
import './customer.css';

type Tab = 'status' | 'inspections' | 'maintenance' | 'safety';
type Plan = NonNullable<Extract<MyVehicle['sections']['maintenance'], { available: true }>['data']>;
type Status = Extract<MyVehicle['sections']['status'], { available: true }>['data'];

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
  // Opens on the report or the maintenance plan when the link asks for it (/my/vehicles/7#report, #plan)
  const [tab, setTab] = useState<Tab | null>(() => (window.location.hash === '#report' ? 'inspections' : window.location.hash === '#plan' ? 'maintenance' : null));
  const [pick, setPick] = useState<number | null>(null);
  const { hash } = useLocation();
  useEffect(() => { if (hash === '#plan') setTab('maintenance'); else if (hash === '#report') setTab('inspections'); }, [hash]);
  const current = tab ?? tabs[0]?.[0] ?? null;

  useEffect(() => {
    if (data.data) document.title = `${data.data.vehicle.registrationNo} · AutoSense`;
  }, [data.data]);

  if (data.error && !data.data) {
    return (
      <>
        <Link to="/my/vehicles" className="small">‹ My vehicles</Link>
        <ErrorState error={data.error} onRetry={data.reload} title="This vehicle couldn't be shown" />
      </>
    );
  }
  if (!data.data) return <div className="p-4"><Skeleton width="40%" /></div>;
  const { vehicle, sections } = data.data;
  const reports = sections.inspections.available ? sections.inspections.data : [];
  const recommendation = sections.maintenance.available ? sections.maintenance.data : null;
  const report = reports.find((r) => r.inspectionId === pick) ?? reports[0];

  return (
    <>
      <Link to="/my/vehicles" className="pt-back cp-rise"><i className="bi bi-chevron-left" aria-hidden="true" />My vehicles</Link>
      <div className="cp-vhead cp-rise" style={{ '--i': 1 } as CSSProperties}>
        {vehicle.photoUrl ? <img className="cp-vthumb" src={vehicle.photoUrl} alt="" /> : <span className="cp-vthumb"><CarArt /></span>}
        <span className="cp-plate"><PlateText plate={vehicle.registrationNo} /></span>
        <div>
          <b className="fs-5">{vehicle.description.split(' · ')[0]}</b>
          <div className="text-body-secondary small">
            {[vehicle.description.split(' · ')[1], vehicle.colour, vehicle.fuelType && vehicle.fuelType[0]!.toUpperCase() + vehicle.fuelType.slice(1)].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>

      <Card className="mb-3">
        <div className="as-tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={current === key} onClick={() => setTab(key)}>
              {label}
              {key === 'inspections' && reports.length > 0 && <span className="cp-tabs-count">{reports.length}</span>}
            </button>
          ))}
        </div>
        {current === 'status' && sections.status.available && (
          <div className="p-4"><StatusTab status={sections.status.data} latest={reports[0]} plan={recommendation?.thisVisit ? recommendation : null} onReport={() => setTab('inspections')} onPlan={() => setTab('maintenance')} /></div>
        )}
        {current === 'inspections' && reports.length === 0 && (
          <div className="p-4">
            <EmptyState icon="bi-clipboard-check" title="No inspection reports yet">
              After a technician confirms an inspection of your vehicle, the report appears here.
            </EmptyState>
          </div>
        )}
        {current === 'maintenance' && (
          <div className="p-4">
            {recommendation ? <PlanView plan={recommendation} /> : <EmptyState icon="bi-wrench-adjustable" title="No maintenance plan yet">After the damage inspection, the technician confirms the maintenance work your vehicle needs. It appears here.</EmptyState>}
          </div>
        )}
        {current === 'safety' && (
          <div className="p-4">
            <EmptyState icon="bi-shield-check" title="No safety notices">
              If the service centre raises a safety check involving your vehicle, you'll see it here.
            </EmptyState>
          </div>
        )}
        {tabs.length === 0 && <div className="p-4"><EmptyState title="Nothing to show for this vehicle yet" /></div>}
      </Card>

      {current === 'inspections' && report && (
        <InspectionReportView key={report.inspectionId} vehicle={vehicle} report={report} history={reports} onPick={setPick} />
      )}
    </>
  );
}

function StatusTab({ status, latest, plan, onReport, onPlan }: { status: Status; latest: InspectionReport | undefined; plan: Plan | null; onReport: () => void; onPlan: () => void }) {
  if (!status) {
    return (
      <EmptyState icon="bi-calendar-check" title="Not at the service centre">
        When you bring the vehicle in, you can follow each step here.
      </EmptyState>
    );
  }
  const step = journeyStep(status.stage, status.planReady);
  const headline =
    status.stage === 'waiting_for_bay' ? 'Waiting for a free bay'
    : status.stage === 'in_bay' ? `Being serviced${status.bay ? ` in ${status.bay}` : ''}`
    : status.stage === 'inspecting' ? `Damage inspection${status.bay ? ` in ${status.bay}` : ''}`
    : status.stage === 'inspected' ? (status.planReady ? 'Maintenance plan ready, work in progress' : 'Inspection done, maintenance plan next')
    : status.stage === 'ready' ? 'Ready for pickup'
    : STAGES[status.stage].label;

  return (
    <div className="d-grid gap-4">
      <div className="d-flex justify-content-between flex-wrap gap-2 align-items-start">
        <div>
          <div className="small text-body-secondary">{status.service} · {status.jobNo}</div>
          <div className="fs-4 fw-bold">{headline}</div>
        </div>
        {status.queuePosition !== null && (
          <span className="cp-pill cp-tone-warning">{status.queuePosition === 1 ? 'Next in line' : `${ordinal(status.queuePosition)} in line`}</span>
        )}
      </div>
      <ol className="cp-journey" style={{ '--p': Math.max(0, step - 1) / (JOURNEY_STEPS - 1) } as CSSProperties} aria-label={`Progress, step ${step} of ${JOURNEY_STEPS}`}>
        <li className="cp-journey-fill" aria-hidden="true" />
        {JOURNEY.map((s, i) => {
          // With the plan confirmed the work is in progress: every step up to the plan is done, pickup is next (not current)
          const working = status.stage === 'inspected' && status.planReady;
          const state = i + 1 < step || (step === JOURNEY_STEPS && !working) ? 'done' : i + 1 === step && !working ? 'now' : '';
          const when = i === 0 ? formatTime(status.checkedInAt) : i === 2 && status.bayEnteredAt ? formatTime(status.bayEnteredAt) : i === 4 && plan ? formatTime(plan.confirmedAt) : i === 5 && status.readyAt ? formatTime(status.readyAt) : '';
          return (
            <li key={s.label} className={state} style={{ '--i': i } as CSSProperties} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="node"><i className={`bi ${state === 'done' ? 'bi-check-lg' : s.icon}`} aria-hidden="true" /></span>
              <span>{s.label}<span className="when">{when || ' '}</span></span>
            </li>
          );
        })}
      </ol>
      <div className="cp-stats">
        <div className="cp-stat cp-rise" style={{ '--i': 3 } as CSSProperties}><div className="k">Checked in</div><div className="v">{formatTime(status.checkedInAt)}</div></div>
        {status.queuePosition !== null && (
          <div className="cp-stat cp-rise" style={{ '--i': 4 } as CSSProperties}>
            <div className="k">Place in queue</div>
            <div className="v">{status.queuePosition === 1 ? 'Next for a bay' : `${ordinal(status.queuePosition)} for a bay`}</div>
          </div>
        )}
        {status.bayEnteredAt && (
          <div className="cp-stat cp-rise" style={{ '--i': 4 } as CSSProperties}><div className="k">In service for</div><div className="v">{formatDuration(minutesSince(status.bayEnteredAt))}</div></div>
        )}
        <div className="cp-stat cp-rise" style={{ '--i': 5 } as CSSProperties}>
          <div className="k">Estimated ready</div>
          <div className="v">{status.estimatedReadyAt ? formatTime(status.estimatedReadyAt) : <span className="text-body-secondary fs-6 fw-normal">Not available yet</span>}</div>
        </div>
      </div>
      {latest && (
        <div className="cp-cta cp-rise" style={{ '--i': 6 } as CSSProperties}>
          <i className="bi bi-clipboard-check fs-3" style={{ color: 'var(--as-primary)' }} aria-hidden="true" />
          <div className="t">
            <b>The inspection report is ready</b>
            <div className="small text-body-secondary">
              {latest.areas.length === 0 ? 'No damage found.' : `${plural(latest.areas.length, 'damaged area')} found in ${plural(latest.photos.length, 'photo')}, checked by a technician.`}
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={onReport}>
            See the report <i className="bi bi-arrow-right ms-1" aria-hidden="true" />
          </button>
        </div>
      )}
      {plan && (
        <div className="cp-cta cp-rise" style={{ '--i': 7 } as CSSProperties}>
          <i className="bi bi-wrench-adjustable fs-3" style={{ color: 'var(--as-primary)' }} aria-hidden="true" />
          <div className="t">
            <b>The maintenance plan is ready</b>
            <div className="small text-body-secondary">
              {plan.selectedTask ?? plan.category}{plan.estimatedMinutes != null ? `, about ${formatDuration(plan.estimatedMinutes)} of work` : ''}. Checked by a technician.
            </div>
          </div>
          <button type="button" className="btn btn-light" onClick={onPlan}>
            See the plan <i className="bi bi-arrow-right ms-1" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** The confirmed maintenance plan: what the technician decided after the damage inspection, in plain words. */
function PlanView({ plan }: { plan: Plan }) {
  return (
    <div className="d-grid gap-3">
      <div>
        <div className="small text-body-secondary">{plan.thisVisit ? `This visit${plan.jobNo ? ` · ${plan.jobNo}` : ''}` : 'From an earlier visit'} · confirmed {formatTime(plan.confirmedAt)}</div>
        <h2 className="h4 mb-0">{plan.selectedTask ?? `${plan.category} work`}</h2>
      </div>
      <div className="cp-stats">
        <div className="cp-stat"><div className="k">Type of work</div><div className="v">{plan.category}</div></div>
        <div className="cp-stat"><div className="k">Estimated work time</div><div className="v">{plan.estimatedMinutes != null ? formatDuration(plan.estimatedMinutes) : <span className="text-body-secondary fs-6 fw-normal">Not estimated</span>}</div></div>
        {plan.inspectionNo && <div className="cp-stat"><div className="k">Based on inspection</div><div className="v as-mono fs-6">{plan.inspectionNo}</div></div>}
      </div>
      <p className="small text-body-secondary mb-0">
        <i className="bi bi-info-circle me-1" aria-hidden="true" />
        An AI model suggested the type of work from your report, the service history and the damage inspection; a technician chose the task and confirmed it. The time is an estimate of the work itself, not a quote.
      </p>
    </div>
  );
}
