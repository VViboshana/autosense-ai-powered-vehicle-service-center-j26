import { useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { formatDate, formatDuration, formatTime } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';

type StaffBooking = {
  bookingId: number;
  bookingNo: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'checked_in';
  date: string;
  time: string;
  service: string;
  minutes: number;
  notes: string | null;
  staffNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  vehicle: { vehicleId: number; registrationNo: string; description: string };
  customer: { name: string; mobile: string | null };
};
type BookingPage = Page<StaffBooking> & { today: string; waiting: number; confirmed: number };

const TABS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'declined', label: 'Declined' },
  { key: 'cancelled', label: 'Cancelled by customer' },
  { key: 'checked_in', label: 'Checked in' },
] as const;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Tue 21/10/2026", read as a calendar day (no time zone shift). */
function day(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/**
 * Service floor › Service bookings. Customers book a day and time online; confirm the ones the workshop can take
 * (the customer is told in their portal) or decline with a reason. Waiting and confirmed show coming days only.
 */
export function BookingsPage() {
  const [status, setStatus] = useState<(typeof TABS)[number]['key']>('pending');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dialog, setDialog] = useState<{ booking: StaffBooking; action: 'confirm' | 'decline' } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const list = useApi<BookingPage>('/bookings', { status, page, pageSize }, { refreshMs: 60_000 });

  return (
    <>
      <PageHeader title="Service bookings" subtitle="Customers book online; confirm the times the workshop can take." />
      <div className="app-content">
        <div className="container-fluid">
          {message && <Alert tone="success">{message}</Alert>}
          <Card>
            <div className="as-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={status === t.key} onClick={() => { setStatus(t.key); setPage(1); }}>
                  {t.label}
                  {t.key === 'pending' && !!list.data?.waiting && <span className="badge text-bg-warning ms-2">{list.data.waiting}</span>}
                  {t.key === 'confirmed' && !!list.data?.confirmed && <span className="badge text-bg-light ms-2">{list.data.confirmed}</span>}
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
                      <th>Day & time</th>
                      <th>Booking</th>
                      <th>Vehicle</th>
                      <th>Customer</th>
                      <th>Service</th>
                      <th>Customer's note</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.loading || !list.data
                      ? Array.from({ length: 3 }, (_, i) => <tr key={i}>{['7rem', '6rem', '8rem', '8rem', '7rem', '8rem', '6rem'].map((w, j) => <td key={j}><Skeleton width={w} /></td>)}</tr>)
                      : list.data.records.map((b) => (
                          <tr key={b.bookingId}>
                            <td className="as-num text-nowrap">
                              <b>{day(b.date)}</b>
                              <div className="small">{b.time}{b.date === list.data!.today && <span className="badge text-bg-primary ms-2">Today</span>}</div>
                            </td>
                            <td className="as-mono small">{b.bookingNo}</td>
                            <td className="as-veh"><b>{b.vehicle.registrationNo}</b><div className="small text-body-secondary">{b.vehicle.description}</div></td>
                            <td>{b.customer.name}<div className="small text-body-secondary as-mono">{b.customer.mobile}</div></td>
                            <td>{b.service}<div className="small text-body-secondary">About {formatDuration(b.minutes)}</div></td>
                            <td className="small">
                              {b.notes ?? '—'}
                              {b.staffNote && <div className="text-body-secondary">Reply: {b.staffNote}</div>}
                              {b.reviewedAt && <div className="text-body-secondary">{formatDate(b.reviewedAt)} {formatTime(b.reviewedAt)}{b.reviewedBy && ` · ${b.reviewedBy}`}</div>}
                            </td>
                            <td className="text-end text-nowrap">
                              {b.status === 'pending' && (
                                <>
                                  <button type="button" className="btn btn-sm btn-primary me-1" onClick={() => setDialog({ booking: b, action: 'confirm' })}>Confirm</button>
                                  <button type="button" className="btn btn-sm btn-light" onClick={() => setDialog({ booking: b, action: 'decline' })}>Decline</button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
                {list.data && list.data.records.length === 0 && (
                  <EmptyState icon="bi-calendar-check" title={status === 'pending' ? 'No bookings waiting' : 'Nothing here'}>
                    {status === 'pending' ? 'When customers book a service online, their bookings appear here.' : undefined}
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

function DecisionDialog({ booking, action, onClose, onDone }: { booking: StaffBooking; action: 'confirm' | 'decline'; onClose: () => void; onDone: (text: string) => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const confirm = action === 'confirm';
  const fields = fieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/bookings/${booking.bookingId}/${action}`, { note });
      onDone(confirm ? `${booking.bookingNo} is confirmed. ${booking.customer.name} sees it in their portal.` : `${booking.bookingNo} was declined.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={confirm ? `Confirm ${booking.bookingNo}?` : `Decline ${booking.bookingNo}?`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="booking-decision" className={`btn ${confirm ? 'btn-primary' : 'btn-danger'}`} disabled={busy}>
            {busy ? 'Saving…' : confirm ? 'Confirm booking' : 'Decline booking'}
          </button>
        </>
      }
    >
      <form id="booking-decision" onSubmit={submit} noValidate>
        {error instanceof ApiError && !fields.note && <Alert>{error.message}</Alert>}
        <p className="small mb-3">
          <b>{booking.vehicle.registrationNo}</b> · {booking.service}
          <br />
          {day(booking.date)} at {booking.time} · {booking.customer.name}
        </p>
        <label className="form-label" htmlFor="booking-note">{confirm ? 'Message to the customer (optional)' : 'Reason, shown to the customer'}</label>
        <textarea
          id="booking-note"
          className={`form-control${fields.note ? ' is-invalid' : ''}`}
          rows={3}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={confirm ? 'e.g. Please bring the service book.' : 'e.g. Fully booked that morning; 13:30 is free.'}
        />
        {fields.note && <div className="invalid-feedback">{fields.note}</div>}
      </form>
    </Modal>
  );
}
