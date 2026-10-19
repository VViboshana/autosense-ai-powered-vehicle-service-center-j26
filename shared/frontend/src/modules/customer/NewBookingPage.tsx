import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert } from '@/components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { ApiError, apiSend } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { CarArt, PlateText } from './art';
import type { BookingOptions } from './customer.types';
import { dayParts, serviceIcon, shortDay } from './portal';

/**
 * Customer: book a service in four steps on one page (vehicle, service, day and time, a note), with a summary that
 * follows on wide screens. ?service=CODE and ?vehicle=ID pre-select a choice (from the services page or a vehicle).
 */
export function NewBookingPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const options = useApi<BookingOptions>('/my/bookings/options');
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [serviceId, setServiceId] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Book a service · AutoSense';
  }, []);

  // Pre-select from the address, or the only vehicle; then the first day with a free time
  const o = options.data;
  useEffect(() => {
    if (!o) return;
    const wanted = Number(params.get('vehicle'));
    setVehicleId((v) => v ?? (o.vehicles.find((x) => x.vehicleId === wanted)?.vehicleId ?? (o.vehicles.length === 1 ? o.vehicles[0]!.vehicleId : null)));
    const code = params.get('service');
    setServiceId((s) => s ?? o.services.find((x) => x.code === code)?.serviceTypeId ?? null);
    setDate((d) => d ?? o.days.find((x) => x.slots.some((s) => s.left > 0))?.date ?? null);
  }, [o, params]);

  const day = useMemo(() => o?.days.find((d) => d.date === date), [o, date]);
  const vehicle = o?.vehicles.find((v) => v.vehicleId === vehicleId);
  const service = o?.services.find((s) => s.serviceTypeId === serviceId);
  const ready = vehicle && service && date && time;

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ bookingNo: string }>('POST', '/my/bookings', { vehicleId, serviceTypeId: serviceId, date, time, notes });
      navigate(`/my/bookings?booked=${encodeURIComponent(r.bookingNo)}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The booking couldn't be sent. Try again.");
      if (err instanceof ApiError && (err.code === 'SLOT_FULL' || err.code === 'VALIDATION_FAILED')) {
        setTime(null);
        options.reload();
      }
      setBusy(false);
    }
  }

  const head = (
    <div className="pt-head cp-rise">
      <div>
        <Link to="/my/bookings" className="pt-back"><i className="bi bi-chevron-left" aria-hidden="true" />Bookings</Link>
        <h1 className="cp-title">Book a service</h1>
        <div className="text-body-secondary">Choose a time that suits you. We'll confirm it, usually the same working day.</div>
      </div>
    </div>
  );

  if (options.error && !o) return <>{head}<div className="cp-card"><ErrorState inline error={options.error} onRetry={options.reload} /></div></>;
  if (!o) return <>{head}<div className="cp-card p-4 d-grid gap-3"><Skeleton width="30%" /><Skeleton width="70%" /><Skeleton width="50%" /></div></>;
  if (o.vehicles.length === 0) {
    return (
      <>
        {head}
        <div className="cp-card">
          <EmptyState icon="bi-car-front" title="Add your vehicle first" action={<Link to="/my/vehicles?add=1" className="btn btn-primary btn-sm">Add a vehicle</Link>}>
            You can book once the service centre has confirmed a vehicle is yours. Waiting for them? Call us to book in the meantime.
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="pt-form">
        <div className="d-grid gap-3">
          <Step n={1} title="Which vehicle?" done={!!vehicle}>
            <div className="pt-choices" role="radiogroup" aria-label="Vehicle">
              {o.vehicles.map((v) => (
                <button key={v.vehicleId} type="button" role="radio" aria-checked={vehicleId === v.vehicleId} className="pt-choice" onClick={() => setVehicleId(v.vehicleId)}>
                  <span className="photo">{v.photoUrl ? <img src={v.photoUrl} alt="" /> : <CarArt />}</span>
                  <span className="cp-plate" style={{ justifySelf: 'start', fontSize: '0.85rem' }}><PlateText plate={v.registrationNo} /></span>
                  <small>{v.description}</small>
                </button>
              ))}
            </div>
          </Step>

          <Step n={2} title="What does it need?" done={!!service} locked={!vehicle}>
            <div className="pt-choices" role="radiogroup" aria-label="Service">
              {o.services.map((s) => (
                <button key={s.serviceTypeId} type="button" role="radio" aria-checked={serviceId === s.serviceTypeId} className="pt-choice" onClick={() => setServiceId(s.serviceTypeId)}>
                  <span className="svc">
                    <i className={`bi ${serviceIcon(s.code)}`} aria-hidden="true" />
                    <span><b className="d-block small">{s.name}</b><small>About {formatDuration(s.minutes)}</small></span>
                  </span>
                </button>
              ))}
            </div>
            <p className="small text-body-secondary mt-2 mb-0">Not sure? Pick the closest and tell us more in the note. <Link to="/services">What each service includes</Link></p>
          </Step>

          <Step n={3} title="When?" done={!!time} locked={!service}>
            <div className="pt-days" role="radiogroup" aria-label="Day">
              {o.days.map((d) => {
                const p = dayParts(d.date);
                const open = d.slots.some((s) => s.left > 0);
                return (
                  <button
                    key={d.date}
                    type="button"
                    role="radio"
                    aria-checked={date === d.date}
                    aria-label={`${shortDay(d.date)}${d.closed ? ', closed' : !open ? ', full' : ''}`}
                    className="pt-day"
                    disabled={!open}
                    onClick={() => { setDate(d.date); setTime(null); }}
                  >
                    <small>{p.weekday}</small>
                    <b>{p.day}</b>
                    <small>{p.month}</small>
                  </button>
                );
              })}
            </div>
            {day && (
              <div className="pt-slots" role="radiogroup" aria-label={`Times on ${shortDay(day.date)}`} key={day.date}>
                {day.slots.map((s, i) => (
                  <button key={s.time} type="button" role="radio" aria-checked={time === s.time} className="pt-slot" disabled={s.left === 0} onClick={() => setTime(s.time)} style={{ '--i': i } as CSSProperties}>
                    <b>{s.time}</b>
                    <small className={s.left > 0 && s.left <= 1 ? 'few' : ''}>{s.left === 0 ? 'Not available' : s.left === 1 ? 'Last place' : `${s.left} places`}</small>
                  </button>
                ))}
              </div>
            )}
            <p className="small text-body-secondary mt-3 mb-0">Book at least {o.minHoursAhead} hours ahead. For the same day, call us.</p>
          </Step>

          <Step n={4} title="Anything we should know?" done={notes.trim().length > 0} locked={!time}>
            <textarea
              className="form-control"
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. A squeak from the front brakes when stopping. (Optional)"
              aria-label="Note for the service centre"
            />
            <div className="form-text text-end">{notes.length}/500</div>
          </Step>
        </div>

        <aside className="cp-card pt-summary">
          <h2>Your booking</h2>
          <dl>
            <SummaryRow icon="bi-car-front" label="Vehicle" value={vehicle && `${vehicle.registrationNo} · ${vehicle.description}`} />
            <SummaryRow icon="bi-wrench-adjustable" label="Service" value={service && `${service.name} (about ${formatDuration(service.minutes)})`} />
            <SummaryRow icon="bi-calendar-event" label="Day" value={date && shortDay(date)} />
            <SummaryRow icon="bi-clock" label="Time" value={time} />
          </dl>
          {error && <Alert>{error}</Alert>}
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : 'Request booking'}
          </button>
          <p className="fine">You'll see the service centre's answer in your portal. You can cancel any time before the day.</p>
        </aside>
      </div>
    </>
  );
}

function Step({ n, title, done, locked, children }: { n: number; title: string; done: boolean; locked?: boolean; children: ReactNode }) {
  return (
    <section className={`cp-card pt-step cp-rise${done ? ' done' : ''}${locked ? ' locked' : ''}`} style={{ '--i': n } as CSSProperties} inert={locked}>
      <div className="pt-step-h">
        <span className="n">{done ? <i className="bi bi-check-lg" aria-hidden="true" /> : n}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SummaryRow({ icon, label, value }: { icon: string; label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt><i className={`bi ${icon}`} aria-label={label} /></dt>
      <dd className={value ? '' : 'empty'}>{value ?? `Choose a ${label.toLowerCase()}`}</dd>
    </div>
  );
}
