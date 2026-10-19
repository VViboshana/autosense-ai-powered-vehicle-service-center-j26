import { useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert, Field, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { formatDate, formatDuration, formatTime, minutesSince } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';

type Claim = {
  claimId: number;
  registrationNo: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  customerNote: string | null;
  photoUrl: string | null;
  reviewNote: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  customer: { customerId: number; name: string; mobile: string | null };
  vehicle: { vehicleId: number; registrationNo: string; description: string; ownerOnRecord: string | null; ownerMatches: boolean } | null;
};

const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'other'] as const;
type NewVehicle = { make: string; model: string; year: string; colour: string; fuelType: string };

const TABS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
] as const;

/**
 * Service floor › Customer vehicle requests. A customer asks to follow a vehicle; check that it's theirs
 * (e.g. the registration book or the mobile number on the job card) before approving.
 */
export function VehicleRequestsPage() {
  const [status, setStatus] = useState<(typeof TABS)[number]['key']>('pending');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dialog, setDialog] = useState<{ claim: Claim; action: 'approve' | 'reject' } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Claim | null>(null);
  const list = useApi<Page<Claim>>('/vehicle-requests', { status, page, pageSize }, { refreshMs: 60_000 });

  return (
    <>
      <PageHeader title="Customer vehicle requests" subtitle="Customers see a vehicle in their account only after you approve it." />
      <div className="app-content">
        <div className="container-fluid">
          {message && <Alert tone="success">{message}</Alert>}
          <Card>
            <div className="as-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={status === t.key} onClick={() => { setStatus(t.key); setPage(1); }}>
                  {t.label}
                </button>
              ))}
            </div>
            {list.error && !list.data ? (
              <ErrorState inline error={list.error} onRetry={list.reload} />
            ) : (
              <div className="table-responsive">
                <table className="table as-table">
                  <thead>
                    <tr>
                      <th>Plate</th>
                      <th>Photo</th>
                      <th>Customer</th>
                      <th>Vehicle on record</th>
                      <th>Customer's note</th>
                      <th>{status === 'pending' ? 'Waiting' : 'Decided'}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.loading || !list.data
                      ? Array.from({ length: 3 }, (_, i) => <tr key={i}>{['6rem', '4.5rem', '8rem', '10rem', '8rem', '4rem', '6rem'].map((w, j) => <td key={j}><Skeleton width={w} /></td>)}</tr>)
                      : list.data.records.map((c) => (
                          <tr key={c.claimId}>
                            <td className="as-veh"><b>{c.registrationNo}</b></td>
                            <td>
                              {c.photoUrl ? (
                                <button type="button" className="as-claim-thumb" onClick={() => setPhoto(c)} aria-label={`See the photo ${c.customer.name} sent of ${c.registrationNo}`}>
                                  <img src={c.photoUrl} alt="" />
                                </button>
                              ) : (
                                <span className="small text-body-secondary">None</span>
                              )}
                            </td>
                            <td>
                              {c.customer.name}
                              <div className="small text-body-secondary as-mono">{c.customer.mobile}</div>
                            </td>
                            <td>
                              {c.vehicle ? (
                                <>
                                  {c.vehicle.description}
                                  <div className="small">
                                    {c.vehicle.ownerMatches ? (
                                      <span className="text-success"><i className="bi bi-check-circle me-1" aria-hidden="true" />Same customer on record</span>
                                    ) : c.vehicle.ownerOnRecord ? (
                                      <span className="text-warning"><i className="bi bi-exclamation-circle me-1" aria-hidden="true" />On record for {c.vehicle.ownerOnRecord}</span>
                                    ) : (
                                      <span className="text-body-secondary">No owner on record</span>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <span className="text-body-secondary">Not on record yet: you add its details when approving</span>
                              )}
                            </td>
                            <td className="small">{c.customerNote ?? '—'}{c.reviewNote && <div className="text-body-secondary">Reply: {c.reviewNote}</div>}</td>
                            <td className="as-num small text-nowrap">
                              {status === 'pending' ? formatDuration(minutesSince(c.requestedAt)) : c.reviewedAt ? `${formatDate(c.reviewedAt)} ${formatTime(c.reviewedAt)}` : '—'}
                              {c.reviewedBy && <div className="text-body-secondary">{c.reviewedBy}</div>}
                            </td>
                            <td className="text-end text-nowrap">
                              {c.status === 'pending' && (
                                <>
                                  <button type="button" className="btn btn-sm btn-primary me-1" onClick={() => setDialog({ claim: c, action: 'approve' })}>Approve</button>
                                  <button type="button" className="btn btn-sm btn-light" onClick={() => setDialog({ claim: c, action: 'reject' })}>Reject</button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
                {list.data && list.data.records.length === 0 && (
                  <EmptyState icon="bi-person-check" title={status === 'pending' ? 'No requests waiting' : 'Nothing here yet'}>
                    {status === 'pending' ? 'When customers ask to follow a vehicle, their requests appear here.' : undefined}
                  </EmptyState>
                )}
              </div>
            )}
            {list.data && <Pagination page={list.data} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
          </Card>
        </div>
      </div>
      {photo?.photoUrl && (
        <Modal title={`${photo.registrationNo} · photo from ${photo.customer.name}`} size="lg" onClose={() => setPhoto(null)}>
          <img src={photo.photoUrl} alt={`The vehicle ${photo.registrationNo}, as photographed by the customer`} className="w-100 rounded" />
          <p className="small text-body-secondary mt-2 mb-0">Check that the car and its plate match before approving.</p>
        </Modal>
      )}
      {dialog && (
        <DecisionDialog
          {...dialog}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function DecisionDialog({ claim, action, onClose, onDone }: { claim: Claim; action: 'approve' | 'reject'; onClose: () => void; onDone: (text: string) => void }) {
  const [note, setNote] = useState('');
  const [vehicle, setVehicle] = useState<NewVehicle>({ make: '', model: '', year: '', colour: '', fuelType: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const approve = action === 'approve';
  // A plate that is not on record yet: staff add the vehicle (from the vehicle or its papers) as they approve
  const addingVehicle = approve && !claim.vehicle;
  const fields = fieldErrors(error);
  const set = (key: keyof NewVehicle) => (e: { target: { value: string } }) => setVehicle((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/vehicle-requests/${claim.claimId}/${action}`, addingVehicle ? { note, vehicle } : { note });
      onDone(approve ? `${claim.registrationNo} now appears in ${claim.customer.name}'s account.` : `The request for ${claim.registrationNo} was rejected.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={approve ? `Approve ${claim.registrationNo}?` : `Reject ${claim.registrationNo}?`}
      size={addingVehicle ? undefined : 'sm'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button
            type="submit"
            form="decision-form"
            className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`}
            disabled={busy || (!approve && note.trim().length < 3) || (addingVehicle && (!vehicle.make.trim() || !vehicle.model.trim()))}
          >
            {busy ? 'Saving…' : addingVehicle ? 'Add vehicle and approve' : approve ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      <form id="decision-form" onSubmit={submit} noValidate>
        {approve && claim.photoUrl && <img src={claim.photoUrl} alt={`The vehicle ${claim.registrationNo}, as photographed by the customer`} className="w-100 rounded mb-3" style={{ maxHeight: 220, objectFit: 'cover' }} />}
        <p className="small">
          {approve
            ? `${claim.customer.name} will see this vehicle's status, confirmed inspections and recommendations. They become its owner on record.`
            : `Tell ${claim.customer.name} why, e.g. "Please bring the registration book to the counter."`}
        </p>
        {addingVehicle && (
          <fieldset className="mb-2">
            <legend className="form-label fw-semibold mb-2">{claim.registrationNo} is not on record yet: add it from the vehicle or its registration book</legend>
            <div className="row g-2">
              <div className="col-sm-6"><Field label="Make" placeholder="Toyota" value={vehicle.make} onChange={set('make')} error={fields['vehicle.make']} required maxLength={40} /></div>
              <div className="col-sm-6"><Field label="Model" placeholder="Aqua" value={vehicle.model} onChange={set('model')} error={fields['vehicle.model']} required maxLength={60} /></div>
              <div className="col-sm-4"><Field label="Year" inputMode="numeric" placeholder="2015" value={vehicle.year} onChange={set('year')} error={fields['vehicle.year']} maxLength={4} /></div>
              <div className="col-sm-4"><Field label="Colour" placeholder="White" value={vehicle.colour} onChange={set('colour')} error={fields['vehicle.colour']} maxLength={30} /></div>
              <div className="col-sm-4">
                <SelectField label="Fuel" value={vehicle.fuelType} onChange={set('fuelType')} error={fields['vehicle.fuelType']}>
                  <option value="">Not known</option>
                  {FUEL_TYPES.map((f) => <option key={f} value={f}>{f[0]!.toUpperCase() + f.slice(1)}</option>)}
                </SelectField>
              </div>
            </div>
          </fieldset>
        )}
        <Field label={approve ? 'Note (optional)' : 'Reason'} value={note} onChange={(e) => setNote(e.target.value)} error={fields.note} required={!approve} />
      </form>
    </Modal>
  );
}
