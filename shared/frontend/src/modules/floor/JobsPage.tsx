import { useEffect, useState, type FormEvent } from 'react';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert, Field, SelectField } from '@/components/ui/Form';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { formatTime } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import type { JobListItem, JobStage } from '@/modules/dashboard/dashboard.types';
import { STAGES } from '@/modules/dashboard/stages';
import { JobActions } from './JobActions';
import './floor.css';

/**
 * Service floor › Vehicles & jobs (screen JOBS; check-in needs JOB_CHECK_IN).
 * Today's arrivals from bookings and walk-ins are checked in here: that creates the job and puts the vehicle in the
 * queue for a bay. The list below follows every vehicle at the centre through the service flow:
 *   waiting for a bay -> in a bay -> damage inspection -> ready -> collected.
 * Moving into a bay happens on the Bay monitor (the camera sees the vehicle; staff confirm which one it is).
 */
type Arrival = {
  bookingId: number; bookingNo: string; status: 'pending' | 'confirmed'; slotTime: string;
  vehicleId: number; registrationNo: string; vehicle: string; customer: string; mobile: string | null;
  serviceTypeId: number; service: string; customerNotes: string | null; openJobNo: string | null;
};
type ServiceType = { serviceTypeId: number; name: string; defaultMinutes: number };
type WalkInVehicle = { vehicleId: number; registrationNo: string; vehicle: string; customer: string | null; openJobNo: string | null };

const FILTERS: { key: string; label: string; stage?: JobStage }[] = [
  { key: 'all', label: 'All at the centre' },
  { key: 'waiting', label: 'Waiting for a bay', stage: 'waiting_for_bay' },
  { key: 'bay', label: 'In a bay', stage: 'in_bay' },
  { key: 'inspecting', label: 'Damage inspection', stage: 'inspecting' },
  { key: 'inspected', label: 'Inspected', stage: 'inspected' },
  { key: 'ready', label: 'Ready', stage: 'ready' },
];

export function JobsPage() {
  const { can } = useSession();
  const [tick, setTick] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const changed = (text?: string) => { setTick((t) => t + 1); if (text) setMessage(text); };

  return (
    <>
      <PageHeader title="Vehicles & jobs" subtitle="Check vehicles in and follow them from the queue to collection" />
      <div className="app-content"><div className="container-fluid">
        {message && <Alert tone="success">{message}</Alert>}
        {can('JOB_CHECK_IN') && (
          <div className="row g-3 mb-3">
            <div className="col-xl-7"><Arrivals tick={tick} onCheckedIn={changed} /></div>
            <div className="col-xl-5"><WalkIn onCheckedIn={changed} /></div>
          </div>
        )}
        <OpenJobs tick={tick} onChanged={() => changed()} />
      </div></div>
    </>
  );
}

function useServiceTypes() {
  return useApi<ServiceType[]>('/jobs/service-types');
}

function Arrivals({ tick, onCheckedIn }: { tick: number; onCheckedIn: (msg: string) => void }) {
  const { data, error, loading, reload } = useApi<{ today: string; arrivals: Arrival[] }>('/jobs/arrivals', { tick }, { refreshMs: 60_000 });
  const types = useServiceTypes();
  return (
    <Card icon="bi-calendar-check" title="Today's bookings" subtitle="Check the vehicle in when it arrives; it joins the queue for a bay">
      {error && !data ? <ErrorState inline error={error} onRetry={reload} title="Today's bookings couldn't be loaded" />
        : loading || !data ? <><Skeleton width="90%" /><div className="mt-2"><Skeleton width="70%" /></div></>
        : data.arrivals.length === 0 ? <EmptyState icon="bi-calendar" title="No bookings left to check in today">Walk-ins can be checked in on the right.</EmptyState>
        : (
          <ul className="as-arrivals">
            {data.arrivals.map((a) => (
              <ArrivalRow key={a.bookingId} a={a} types={types.data ?? []} onDone={(jobNo) => { reload(); onCheckedIn(`${a.registrationNo} is checked in (${jobNo}) and waiting for a bay.`); }} />
            ))}
          </ul>
        )}
    </Card>
  );
}

function ArrivalRow({ a, types, onDone }: { a: Arrival; types: ServiceType[]; onDone: (jobNo: string) => void }) {
  const [open, setOpen] = useState(false);
  const [serviceTypeId, setServiceTypeId] = useState(a.serviceTypeId);
  const [notes, setNotes] = useState(a.customerNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      const job = await apiSend<{ jobId: number; jobNo: string }>('POST', '/jobs/check-in', { bookingId: a.bookingId, serviceTypeId, customerNotes: notes });
      onDone(job.jobNo);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="as-arrival">
      <div className="as-arrival-main">
        <span className="as-arrival-time as-num">{a.slotTime}</span>
        <span>
          <b className="as-mono">{a.registrationNo}</b> · {a.vehicle}
          <span className="d-block small text-body-secondary">{a.customer}{a.mobile ? ` · ${a.mobile}` : ''} · {a.service} · {a.bookingNo}</span>
        </span>
        <span className="ms-auto d-flex align-items-center gap-2">
          {a.status === 'pending' && <StatusPill tone="warning">Not confirmed</StatusPill>}
          {a.openJobNo ? <span className="small text-body-secondary">At the centre ({a.openJobNo})</span>
            : <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Check in</button>}
        </span>
      </div>
      {open && !a.openJobNo && (
        <div className="as-arrival-form">
          <div className="row">
            <SelectField className="col-md-6" label="Service" value={serviceTypeId} onChange={(e) => setServiceTypeId(Number(e.target.value))}>
              {types.length === 0 && <option value={a.serviceTypeId}>{a.service}</option>}
              {types.map((t) => <option key={t.serviceTypeId} value={t.serviceTypeId}>{t.name} (about {t.defaultMinutes} min)</option>)}
            </SelectField>
            <Field className="col-md-6" label="Customer notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {a.status === 'pending' && <p className="small text-body-secondary">Checking in also confirms this booking.</p>}
          {error && <Alert>{error}</Alert>}
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void checkIn()}>{busy ? 'Checking in…' : 'Check in and add to the queue'}</button>
        </div>
      )}
    </li>
  );
}

function WalkIn({ onCheckedIn }: { onCheckedIn: (msg: string) => void }) {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<WalkInVehicle | null>(null);
  const [serviceTypeId, setServiceTypeId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const types = useServiceTypes();
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(draft.trim()), 300);
    return () => window.clearTimeout(t);
  }, [draft]);
  const found = useApi<WalkInVehicle[]>(search.length >= 2 && !picked ? '/jobs/vehicles' : null, { search });
  const fields = fieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const job = await apiSend<{ jobNo: string }>('POST', '/jobs/check-in', { vehicleId: picked.vehicleId, serviceTypeId: serviceTypeId === '' ? undefined : serviceTypeId, customerNotes: notes });
      onCheckedIn(`${picked.registrationNo} is checked in (${job.jobNo}) and waiting for a bay.`);
      setPicked(null); setDraft(''); setSearch(''); setServiceTypeId(''); setNotes('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card icon="bi-person-walking" title="Walk-in" subtitle="A vehicle on record without a booking">
      <form className="as-card-body" onSubmit={(e) => void submit(e)} noValidate>
        {!picked ? (
          <>
            <Field label="Vehicle number or owner" type="search" placeholder="e.g. KP 0683" value={draft} onChange={(e) => setDraft(e.target.value)}
              hint="Vehicles are added when staff approve a customer's vehicle request." />
            {search.length >= 2 && (
              found.error && !found.data ? <ErrorState inline error={found.error} onRetry={found.reload} />
                : found.loading || !found.data ? <Skeleton width="80%" />
                : found.data.length === 0 ? <p className="small text-body-secondary mb-0">No vehicle on record matches "{search}".</p>
                : (
                  <ul className="as-pick-list">
                    {found.data.map((v) => (
                      <li key={v.vehicleId}>
                        <button type="button" className="as-pick" disabled={!!v.openJobNo} onClick={() => setPicked(v)}>
                          <b className="as-mono">{v.registrationNo}</b> · {v.vehicle}
                          <span className="d-block small text-body-secondary">{v.customer ?? 'No owner on record'}{v.openJobNo ? ` · already at the centre (${v.openJobNo})` : ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
            )}
          </>
        ) : (
          <>
            <div className="as-picked mb-3">
              <span><b className="as-mono">{picked.registrationNo}</b> · {picked.vehicle}<span className="d-block small text-body-secondary">{picked.customer ?? 'No owner on record'}</span></span>
              <button type="button" className="btn btn-link btn-sm" onClick={() => setPicked(null)}>Change</button>
            </div>
            <SelectField label="Service" required value={serviceTypeId} error={fields.serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Choose…</option>
              {(types.data ?? []).map((t) => <option key={t.serviceTypeId} value={t.serviceTypeId}>{t.name} (about {t.defaultMinutes} min)</option>)}
            </SelectField>
            <Field label="Customer notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {error instanceof ApiError && !Object.keys(fields).length && <Alert>{error.message}</Alert>}
            <button type="submit" className="btn btn-primary" disabled={busy || serviceTypeId === ''}>{busy ? 'Checking in…' : 'Check in and add to the queue'}</button>
          </>
        )}
      </form>
    </Card>
  );
}

function OpenJobs({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const stage = FILTERS.find((f) => f.key === filter)?.stage;
  const { data, error, loading, reload } = useApi<Page<JobListItem>>('/jobs', { scope: 'open', stage, page, pageSize, tick }, { refreshMs: 15_000 });

  return (
    <Card icon="bi-car-front" title="At the centre" subtitle="Every open job, in check-in order (the queue for a bay is first come, first served)">
      <div className="as-tabs" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => { setFilter(f.key); setPage(1); }}>{f.label}</button>
        ))}
      </div>
      {error && !data ? <ErrorState inline error={error} onRetry={reload} title="Jobs couldn't be loaded" />
        : loading || !data ? <><Skeleton width="90%" /><div className="mt-2"><Skeleton width="80%" /></div></>
        : data.records.length === 0 ? <EmptyState icon="bi-car-front" title="No vehicles here">Checked-in vehicles appear here.</EmptyState>
        : (
          <>
            <div className="table-responsive">
              <table className="table as-table mb-0">
                <thead><tr><th>Vehicle</th><th>Service</th><th>Stage</th><th>Bay</th><th>Checked in</th><th aria-label="Actions" /></tr></thead>
                <tbody>
                  {data.records.map((j) => (
                    <tr key={j.jobId}>
                      <td><b className="as-mono">{j.registrationNo}</b><div className="small text-body-secondary">{j.vehicle} · {j.jobNo}{j.customer ? ` · ${j.customer}` : ''}</div></td>
                      <td className="small">{j.service}{j.estimatedMinutes ? <div className="text-body-secondary">about {j.estimatedMinutes} min</div> : null}</td>
                      <td><StatusPill tone={STAGES[j.stage].tone}>{STAGES[j.stage].label}</StatusPill></td>
                      <td className="small">{j.bay ?? '—'}</td>
                      <td className="small as-num">{formatTime(j.checkedInAt)}</td>
                      <td className="text-end"><JobActions job={j} onDone={() => { reload(); onChanged(); }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        )}
    </Card>
  );
}
