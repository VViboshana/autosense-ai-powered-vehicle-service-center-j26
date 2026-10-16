import { useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert, Field } from '@/components/ui/Form';
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
  reviewNote: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  customer: { customerId: number; name: string; mobile: string | null };
  vehicle: { vehicleId: number; registrationNo: string; description: string; ownerOnRecord: string | null; ownerMatches: boolean } | null;
};

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
                      <th>Customer</th>
                      <th>Vehicle on record</th>
                      <th>Customer's note</th>
                      <th>{status === 'pending' ? 'Waiting' : 'Decided'}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.loading || !list.data
                      ? Array.from({ length: 3 }, (_, i) => <tr key={i}>{['6rem', '8rem', '10rem', '8rem', '4rem', '6rem'].map((w, j) => <td key={j}><Skeleton width={w} /></td>)}</tr>)
                      : list.data.records.map((c) => (
                          <tr key={c.claimId}>
                            <td className="as-veh"><b>{c.registrationNo}</b></td>
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
                                <span className="text-body-secondary">Not on record yet: check the vehicle in first</span>
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
                                  <button type="button" className="btn btn-sm btn-primary me-1" disabled={!c.vehicle} onClick={() => setDialog({ claim: c, action: 'approve' })}>Approve</button>
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
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const approve = action === 'approve';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/vehicle-requests/${claim.claimId}/${action}`, { note });
      onDone(approve ? `${claim.registrationNo} now appears in ${claim.customer.name}'s account.` : `The request for ${claim.registrationNo} was rejected.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={approve ? `Approve ${claim.registrationNo}?` : `Reject ${claim.registrationNo}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="decision-form" className={`btn ${approve ? 'btn-primary' : 'btn-danger'}`} disabled={busy || (!approve && note.trim().length < 3)}>
            {busy ? 'Saving…' : approve ? 'Approve' : 'Reject'}
          </button>
        </>
      }
    >
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      <form id="decision-form" onSubmit={submit} noValidate>
        <p className="small">
          {approve
            ? `${claim.customer.name} will see this vehicle's status, confirmed inspections and recommendations. They become its owner on record.`
            : `Tell ${claim.customer.name} why, e.g. "Please bring the registration book to the counter."`}
        </p>
        <Field label={approve ? 'Note (optional)' : 'Reason'} value={note} onChange={(e) => setNote(e.target.value)} error={fieldErrors(error).note} required={!approve} />
      </form>
    </Modal>
  );
}
