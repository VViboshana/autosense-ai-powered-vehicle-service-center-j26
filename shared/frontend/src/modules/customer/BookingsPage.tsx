import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ApiError, apiSend } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Toasts } from '@/modules/inspections/Toasts';
import { useToasts } from '@/modules/inspections/useToasts';
import { Alert } from '@/components/ui/Form';
import { PlateText } from './art';
import type { Booking, MyBookings } from './customer.types';
import { BOOKING_STATUS, dayParts, shortDay } from './portal';

/** Customer: my bookings, still to come (soonest first) or past and closed; cancel one that's still to come. */
export function BookingsPage() {
  const data = useApi<MyBookings>('/my/bookings', undefined, { refreshMs: 60_000 });
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [params, setParams] = useSearchParams();
  const { toasts, show } = useToasts();
  const booked = params.get('booked');

  useEffect(() => {
    document.title = 'Bookings · AutoSense';
  }, []);

  const list = data.data?.[tab] ?? [];

  return (
    <>
      <div className="pt-head cp-rise">
        <div>
          <div className="cp-eyebrow">Bookings</div>
          <h1 className="cp-title">Your service bookings</h1>
          <div className="text-body-secondary">Book a time, and we'll confirm it here.</div>
        </div>
        <Link to="/my/bookings/new" className="btn btn-primary"><i className="bi bi-calendar-plus me-2" aria-hidden="true" />Book a service</Link>
      </div>

      {booked && (
        <div className="cp-rise">
          <Alert tone="success">
            Booking <b>{booked}</b> is sent. The service centre will confirm it soon, and you'll see the answer here and in your
            notifications.{' '}
            <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setParams({}, { replace: true })}>Dismiss</button>
          </Alert>
        </div>
      )}

      <div className="pt-tabs" role="tablist">
        {(['upcoming', 'past'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'upcoming' ? 'Upcoming' : 'Past & cancelled'}
            {t === 'upcoming' && !!data.data?.upcoming.length && <span className="n">{data.data.upcoming.length}</span>}
          </button>
        ))}
      </div>

      {data.error && !data.data ? (
        <div className="cp-card"><ErrorState inline error={data.error} onRetry={data.reload} /></div>
      ) : !data.data ? (
        <div className="pt-bookings">{[0, 1].map((i) => <div key={i} className="cp-card pt-booking"><Skeleton width="64px" /><Skeleton width="60%" /><span /></div>)}</div>
      ) : list.length === 0 ? (
        <div className="cp-card">
          <EmptyState
            icon={tab === 'upcoming' ? 'bi-calendar-plus' : 'bi-calendar'}
            title={tab === 'upcoming' ? 'No upcoming bookings' : 'Nothing here yet'}
            action={tab === 'upcoming' ? <Link to="/my/bookings/new" className="btn btn-primary btn-sm">Book a service</Link> : undefined}
          >
            {tab === 'upcoming' ? 'Choose a vehicle, a service and a time that suits you.' : 'Past, declined and cancelled bookings appear here.'}
          </EmptyState>
        </div>
      ) : (
        <div className="pt-bookings">
          {list.map((b, i) => (
            <BookingCard key={b.bookingId} b={b} past={tab === 'past'} i={i} onCancel={() => setCancelling(b)} />
          ))}
        </div>
      )}

      {cancelling && (
        <CancelDialog
          b={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            show(`Booking ${cancelling.bookingNo} cancelled`);
            data.reload();
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}

function BookingCard({ b, past, i, onCancel }: { b: Booking; past: boolean; i: number; onCancel: () => void }) {
  const d = dayParts(b.date);
  const status = BOOKING_STATUS[b.status];
  return (
    <article className={`cp-card pt-booking${past ? ' is-past' : ''}`} style={{ '--i': i } as CSSProperties}>
      <div className="pt-date"><small>{d.month}</small><b>{d.day}</b><span>{d.weekday}</span></div>
      <div className="min-w-0">
        <h3>{b.service}</h3>
        <div className="meta">
          <span><i className="bi bi-clock me-1" aria-hidden="true" />{b.time} · about {formatDuration(b.minutes)}</span>
          <span><span className="cp-plate" style={{ fontSize: '0.75rem' }}><PlateText plate={b.vehicle.registrationNo} /></span> {b.vehicle.description}</span>
        </div>
        {b.notes && <div className="small text-body-secondary mt-1"><i className="bi bi-chat-left-text me-1" aria-hidden="true" />{b.notes}</div>}
        {b.staffNote && <div className={`note cp-tone-${status.tone}`}><b>Service centre:</b> {b.staffNote}</div>}
      </div>
      <div className="side">
        <span className={`cp-pill cp-tone-${status.tone}`}>{status.label}</span>
        <span className="no">{b.bookingNo}</span>
        {!past && <button type="button" className="cp-link" onClick={onCancel}>Cancel booking</button>}
      </div>
    </article>
  );
}

function CancelDialog({ b, onClose, onDone }: { b: Booking; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    setBusy(true);
    try {
      await apiSend('POST', `/my/bookings/${b.bookingId}/cancel`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The booking couldn't be cancelled.");
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Cancel this booking?"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Keep it</button>
          <button type="button" className="btn btn-danger" onClick={() => void cancel()} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p className="mb-0">
        {b.service} for <b>{b.vehicle.registrationNo}</b> on {shortDay(b.date)} at {b.time}. The time is freed for someone else.
      </p>
    </Modal>
  );
}
