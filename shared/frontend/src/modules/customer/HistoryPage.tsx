import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { CountUp } from '@/components/ui/CountUp';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatDate, formatMoney } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import { CarArt } from './art';
import type { MyHistory, Visit } from './customer.types';
import { severityName, severityTone } from './customer.ui';

/** Customer: every visit of all their vehicles, newest first, grouped by year, with a filter per vehicle. */
export function HistoryPage() {
  const { config } = useSession();
  const data = useApi<MyHistory>('/my/history');
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const currency = typeof config.settings['app.currency'] === 'string' ? config.settings['app.currency'] : 'LKR';

  useEffect(() => {
    document.title = 'Service history · AutoSense';
  }, []);

  const vehicles = useMemo(() => {
    const seen = new Map<number, string>();
    data.data?.visits.forEach((v) => seen.set(v.vehicle.vehicleId, v.vehicle.registrationNo));
    return [...seen];
  }, [data.data]);
  const visits = (data.data?.visits ?? []).filter((v) => vehicleId === null || v.vehicle.vehicleId === vehicleId);
  const years = [...new Set(visits.map((v) => new Date(v.checkedInAt).getFullYear()))];
  const t = data.data?.totals;

  return (
    <>
      <div className="pt-head cp-rise">
        <div>
          <div className="cp-eyebrow">Service history</div>
          <h1 className="cp-title">Every visit, on record</h1>
          <div className="text-body-secondary">All services and inspection reports for your vehicles.</div>
        </div>
      </div>

      {data.error && !data.data ? (
        <div className="cp-card"><ErrorState inline error={data.error} onRetry={data.reload} /></div>
      ) : !data.data ? (
        <div className="cp-card p-4 d-grid gap-3"><Skeleton width="40%" /><Skeleton width="70%" /><Skeleton width="55%" /></div>
      ) : data.data.visits.length === 0 ? (
        <div className="cp-card">
          <EmptyState icon="bi-journal-text" title="No visits yet" action={<Link to="/my/bookings/new" className="btn btn-primary btn-sm">Book a service</Link>}>
            After your first visit, each service and inspection report of your vehicles is kept here.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="pt-kpis">
            {[
              { label: 'Visits', value: t!.visits, icon: 'bi-journal-text', tone: 'brand' },
              { label: 'Completed', value: t!.completed, icon: 'bi-flag', tone: 'success' },
              { label: 'Inspection reports', value: t!.reports, icon: 'bi-clipboard-check', tone: 'info' },
            ].map((k, i) => (
              <div key={k.label} className={`cp-card pt-kpi cp-tone-${k.tone} cp-rise`} style={{ '--i': i + 1 } as CSSProperties}>
                <span className="ic"><i className={`bi ${k.icon}`} aria-hidden="true" /></span>
                <div><b><CountUp value={k.value} /></b><span>{k.label}</span></div>
              </div>
            ))}
          </div>

          {vehicles.length > 1 && (
            <div className="pt-filter" role="group" aria-label="Show visits of">
              <button type="button" aria-pressed={vehicleId === null} onClick={() => setVehicleId(null)}>All vehicles</button>
              {vehicles.map(([id, plate]) => (
                <button key={id} type="button" aria-pressed={vehicleId === id} onClick={() => setVehicleId(id)}>{plate}</button>
              ))}
            </div>
          )}

          {years.map((year) => (
            <section key={year} aria-label={String(year)}>
              <div className="pt-year">{year}</div>
              <ol className="pt-timeline">
                {visits
                  .filter((v) => new Date(v.checkedInAt).getFullYear() === year)
                  .map((v, i) => <VisitRow key={v.jobId} v={v} i={i} currency={currency} />)}
              </ol>
            </section>
          ))}
        </>
      )}
    </>
  );
}

function VisitRow({ v, i, currency }: { v: Visit; i: number; currency: string }) {
  const stage = STAGES[v.stage];
  const tone = stage.tone === 'muted' && v.stage === 'completed' ? 'success' : stage.tone;
  return (
    <li className={`cp-tone-${tone}`} style={{ '--i': i } as CSSProperties}>
      <div className="cp-card pt-visit">
        <span className="pt-thumb">{v.vehicle.photoUrl ? <img src={v.vehicle.photoUrl} alt="" /> : <CarArt />}</span>
        <div className="min-w-0">
          <h3>{v.service}</h3>
          <div className="meta">
            <span><i className="bi bi-calendar3 me-1" aria-hidden="true" />{formatDate(v.checkedInAt)}</span>
            <span><i className="bi bi-car-front me-1" aria-hidden="true" />{v.vehicle.registrationNo}</span>
            <span className="as-mono">{v.jobNo}</span>
            {v.estimateLkr !== null && <span>Estimate {currency} {formatMoney(v.estimateLkr)}</span>}
          </div>
        </div>
        <div className="side">
          <span className={`cp-pill cp-tone-${tone}`}>{v.stage === 'completed' ? 'Completed' : stage.label}</span>
          {v.inspection && (
            <Link to={`/my/vehicles/${v.vehicle.vehicleId}#report`} className="text-decoration-none">
              <i className="bi bi-clipboard-check me-1" aria-hidden="true" />
              Report · <span className={`text-${severityTone(v.inspection.overallSeverity) === 'muted' ? 'body-secondary' : severityTone(v.inspection.overallSeverity)}`}>{severityName(v.inspection.overallSeverity)}</span>
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
