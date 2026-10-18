import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert, Field } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import type { MyVehicles } from './customer.types';

/** The customer's home: their vehicles (approved by staff), and a form to ask for another one. */
export function MyVehiclesPage() {
  const { me } = useSession();
  const data = useApi<MyVehicles>('/my/vehicles', undefined, { refreshMs: 60_000 });
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'My vehicles · AutoSense';
  }, []);

  async function cancel(claimId: number) {
    await apiSend('DELETE', `/my/vehicle-requests/${claimId}`).catch(() => undefined);
    data.reload();
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <div>
          <h1 className="as-page-title">Hello, {me.displayName.split(' ')[0]}</h1>
          <p className="text-body-secondary mb-0">Your vehicles at the service centre.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />
          Add a vehicle
        </button>
      </div>
      {message && <Alert tone="success">{message}</Alert>}
      {adding && (
        <AddVehicle
          onCancel={() => setAdding(false)}
          onAdded={(plate) => {
            setAdding(false);
            setMessage(`We've asked the service centre to confirm ${plate}. It appears here once they do, usually when you next visit.`);
            data.reload();
          }}
        />
      )}

      <Card title="My vehicles" icon="bi-car-front" className="mb-3">
        {data.error && !data.data ? (
          <ErrorState inline error={data.error} onRetry={data.reload} />
        ) : data.loading || !data.data ? (
          <div className="p-4 d-grid gap-3"><Skeleton width="50%" /><Skeleton width="35%" /></div>
        ) : data.data.vehicles.length === 0 ? (
          <EmptyState icon="bi-car-front" title="No vehicles yet" action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>Add a vehicle</button>}>
            Add your vehicle's number plate. The service centre confirms it's yours, then you can follow its service here.
          </EmptyState>
        ) : (
          data.data.vehicles.map((v) => (
            <Link key={v.vehicleId} to={`/my/vehicles/${v.vehicleId}`} className="as-vehicle-card">
              <span className="as-vehicle-ic"><i className="bi bi-car-front" aria-hidden="true" /></span>
              <span className="flex-grow-1" style={{ minWidth: 0 }}>
                <b className="as-plate d-block">{v.registrationNo}</b>
                <span className="small text-body-secondary">{v.description}</span>
              </span>
              {v.visit ? (
                <StatusPill tone={STAGES[v.visit.stage].tone}>
                  {STAGES[v.visit.stage].label}
                  {v.visit.bay ? ` · ${v.visit.bay}` : ''}
                </StatusPill>
              ) : (
                <span className="small text-body-secondary">Not at the centre</span>
              )}
              <i className="bi bi-chevron-right as-chev" aria-hidden="true" />
            </Link>
          ))
        )}
      </Card>

      {data.data && data.data.requests.length > 0 && (
        <Card title="Waiting for the service centre" icon="bi-hourglass">
          <ul className="list-unstyled mb-0">
            {data.data.requests.map((r) => (
              <li key={r.claimId} className="as-vehicle-card">
                <span className="flex-grow-1">
                  <b className="as-plate d-block">{r.registrationNo}</b>
                  <span className="small text-body-secondary">
                    {r.status === 'pending' ? `Asked on ${formatDate(r.requestedAt)}` : `Not approved${r.reviewNote ? `: ${r.reviewNote}` : ''}`}
                  </span>
                </span>
                {r.status === 'pending' ? (
                  <>
                    <StatusPill tone="warning">Waiting</StatusPill>
                    <button type="button" className="btn btn-sm btn-light" onClick={() => void cancel(r.claimId)}>Cancel</button>
                  </>
                ) : (
                  <StatusPill tone="muted">Not approved</StatusPill>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function AddVehicle({ onCancel, onAdded }: { onCancel: () => void; onAdded: (plate: string) => void }) {
  const [plate, setPlate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/my/vehicle-requests', { registrationNo: plate, note });
      onAdded(plate.toUpperCase());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Card title="Add a vehicle" icon="bi-plus-circle" className="mb-3">
      <form className="px-4 pb-4" onSubmit={submit} noValidate>
        {error instanceof ApiError && <Alert>{error.message}</Alert>}
        <div className="row g-2">
          <div className="col-sm-5">
            <Field label="Number plate" value={plate} onChange={(e) => setPlate(e.target.value)} error={fieldErrors(error).registrationNo} placeholder="WP CAB-4521" autoFocus required />
          </div>
          <div className="col-sm-7">
            <Field label="Anything we should know? (optional)" value={note} onChange={(e) => setNote(e.target.value)} error={fieldErrors(error).note} placeholder="e.g. Bought it last month" />
          </div>
        </div>
        <div className="d-flex gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy || plate.trim().length < 4}>{busy ? 'Sending…' : 'Ask to add'}</button>
          <button type="button" className="btn btn-light" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}
