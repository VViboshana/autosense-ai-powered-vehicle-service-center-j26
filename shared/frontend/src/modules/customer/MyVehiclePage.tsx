import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import { CarArt, PlateText } from './art';
import type { InspectionReport, MyVehicle } from './customer.types';
import { JOURNEY, ordinal, plural } from './customer.ui';
import { InspectionReportView } from './InspectionReportView';
import './customer.css';

type Tab = 'status' | 'inspections' | 'maintenance' | 'safety';
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
  // Opens on the report when the link asks for it (/my/vehicles/7#report), e.g. from the home page
  const [tab, setTab] = useState<Tab | null>(() => (window.location.hash === '#report' ? 'inspections' : null));
  const [pick, setPick] = useState<number | null>(null);
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
  const reports = sections.inspections.available ? sections.inspections.data : [];
  const report = reports.find((r) => r.inspectionId === pick) ?? reports[0];

  return (
    <>
      <Link to="/my" className="small text-decoration-none cp-rise">‹ My vehicles</Link>
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
          <div className="p-4"><StatusTab status={sections.status.data} latest={reports[0]} onReport={() => setTab('inspections')} /></div>
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
            <EmptyState icon="bi-wrench-adjustable" title="No recommendations yet">
              Maintenance work the technician recommends for this vehicle will appear here.
            </EmptyState>
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

function StatusTab({ status, latest, onReport }: { status: Status; latest: InspectionReport | undefined; onReport: () => void }) {
  if (!status) {
    return (
      <EmptyState icon="bi-calendar-check" title="Not at the service centre">
        When you bring the vehicle in, you can follow each step here.
      </EmptyState>
    );
  }
  const step = STAGES[status.stage].step;
  const headline =
    status.stage === 'waiting_for_bay' ? 'Waiting for a free bay'
    : status.stage === 'in_bay' ? `Being serviced${status.bay ? ` in ${status.bay}` : ''}`
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
      <ol className="cp-journey" style={{ '--p': Math.max(0, step - 1) / 4 } as CSSProperties} aria-label={`Progress, step ${step} of 5`}>
        <li className="cp-journey-fill" aria-hidden="true" />
        {JOURNEY.map((s, i) => {
          const state = i + 1 < step || step === 5 ? 'done' : i + 1 === step ? 'now' : '';
          const when = i === 0 ? formatTime(status.checkedInAt) : i === 3 && status.bayEnteredAt ? formatTime(status.bayEnteredAt) : i === 4 && status.readyAt ? formatTime(status.readyAt) : '';
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
    </div>
  );
}
