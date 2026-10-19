import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { CountUp } from '@/components/ui/CountUp';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { apiUpload } from '@/lib/api';
import { formatLongDate, localHour } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import { Toasts } from '@/modules/inspections/Toasts';
import { useToasts } from '@/modules/inspections/useToasts';
import { BUSINESS, mailUrl, telUrl, whatsappUrl } from '@/site/business';
import { AddVehicleDialog } from './AddVehicleDialog';
import { CarArt, PlateText } from './art';
import { NoticeRow } from './CustomerLayout';
import type { Booking, MyBookings, MyVehicles } from './customer.types';
import { shrinkPhoto } from './customer.ui';
import { BOOKING_STATUS, dayParts, usePortal } from './portal';
import { VehicleHero } from './VehicleHero';
import '@/modules/inspections/inspections.css';

const greeting = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
const rise = (i: number) => ({ '--i': i }) as CSSProperties;

/**
 * The customer's home: a greeting, key figures, the vehicle that's at the service centre now (or an invitation to
 * book), quick actions, the next booking, their vehicles and the latest news. New customers see a "get started"
 * checklist instead: account, vehicle, first booking.
 */
export function PortalHomePage() {
  const { me } = useSession();
  const navigate = useNavigate();
  const { notifications } = usePortal();
  const vehicles = useApi<MyVehicles>('/my/vehicles', undefined, { refreshMs: 60_000 });
  const bookings = useApi<MyBookings>('/my/bookings');
  const [adding, setAdding] = useState(false);
  const { toasts, show } = useToasts();

  useEffect(() => {
    document.title = 'Home · AutoSense';
  }, []);

  async function changePhoto(vehicleId: number, file: File) {
    try {
      const form = new FormData();
      form.append('photo', await shrinkPhoto(file), 'vehicle.jpg');
      await apiUpload(`/my/vehicles/${vehicleId}/photo`, form);
      vehicles.reload();
      show('Photo updated');
    } catch {
      show("The photo couldn't be changed. Try a JPEG or PNG.", 'info');
    }
  }

  const list = vehicles.data?.vehicles ?? [];
  const pending = vehicles.data?.requests.filter((r) => r.status === 'pending') ?? [];
  const atCentre = list.filter((v) => v.visit);
  const upcoming = bookings.data?.upcoming ?? [];
  const next = upcoming[0];
  const reports = list.filter((v) => v.latestInspection).length;
  const news = notifications.data?.items.slice(0, 4) ?? [];
  const loading = !vehicles.data && !vehicles.error;
  const newcomer = vehicles.data && list.length === 0;

  return (
    <>
      <div className="pt-head cp-rise">
        <div>
          <div className="cp-eyebrow">{formatLongDate(new Date())}</div>
          <h1 className="cp-title">{greeting(localHour())}, {me.displayName.split(' ')[0]}</h1>
          <div className="text-body-secondary">
            {atCentre.length > 0
              ? `${atCentre.length === 1 ? 'Your vehicle is' : `${atCentre.length} of your vehicles are`} at the service centre now.`
              : 'Here is everything about your vehicles, in one place.'}
          </div>
        </div>
        <Link to="/my/bookings/new" className="btn btn-primary"><i className="bi bi-calendar-plus me-2" aria-hidden="true" />Book a service</Link>
      </div>

      {vehicles.error && !vehicles.data ? (
        <div className="cp-card mb-3"><ErrorState inline error={vehicles.error} onRetry={vehicles.reload} /></div>
      ) : (
        <div className="pt-kpis">
          <Link to="/my/vehicles" className="cp-card pt-kpi cp-tone-brand cp-rise" style={rise(1)}>
            <span className="ic"><i className="bi bi-car-front" aria-hidden="true" /></span>
            <div><b>{loading ? '–' : <CountUp value={list.length} />}</b><span>{list.length === 1 ? 'Vehicle' : 'Vehicles'}</span></div>
          </Link>
          <Link to="/my/bookings" className="cp-card pt-kpi cp-tone-success cp-rise" style={rise(2)}>
            <span className="ic"><i className="bi bi-calendar-check" aria-hidden="true" /></span>
            <div><b>{bookings.data ? <CountUp value={upcoming.length} /> : '–'}</b><span>Upcoming {upcoming.length === 1 ? 'booking' : 'bookings'}</span></div>
          </Link>
          <Link to="/my/history" className="cp-card pt-kpi cp-tone-info cp-rise" style={rise(3)}>
            <span className="ic"><i className="bi bi-clipboard-check" aria-hidden="true" /></span>
            <div><b>{loading ? '–' : <CountUp value={reports} />}</b><span>Inspection {reports === 1 ? 'report' : 'reports'}</span></div>
          </Link>
        </div>
      )}

      <div className="pt-dash">
        <div>
          {loading ? (
            <div className="cp-hero d-grid align-content-end p-4 gap-2"><Skeleton width="40%" /><Skeleton width="60%" /></div>
          ) : newcomer ? (
            <GettingStarted waiting={pending.length > 0} onAdd={() => setAdding(true)} />
          ) : atCentre.length > 0 ? (
            atCentre.map((v, i) => (
              <div key={v.vehicleId} className="cp-rise" style={rise(i + 2)}>
                <VehicleHero v={v} big={i === 0} onChangePhoto={(f) => changePhoto(v.vehicleId, f)} />
              </div>
            ))
          ) : (
            <section className="pt-idle cp-rise" style={rise(2)}>
              <div>
                <div className="cp-eyebrow" style={{ color: 'var(--as-brand)' }}>Nothing in for service</div>
                <h2>{next ? `See you on ${dayParts(next.date).weekday} ${dayParts(next.date).day} ${dayParts(next.date).month}` : 'Time for a check-up?'}</h2>
                <p>
                  {next
                    ? `${next.vehicle.registrationNo} ${next.status === 'confirmed' ? 'is booked' : 'has a booking request'} for ${next.service.toLowerCase()} at ${next.time}${next.status === 'confirmed' ? '' : ', waiting for the service centre to confirm'}. You'll follow it here from check-in to pickup.`
                    : 'Book a service and follow your vehicle here, step by step, from check-in to pickup.'}
                </p>
                <Link to={next ? '/my/bookings' : '/my/bookings/new'} className="btn btn-primary">{next ? 'View booking' : 'Book a service'}</Link>
              </div>
              <CarArt />
            </section>
          )}

          <nav className="pt-quick cp-rise" style={rise(3)} aria-label="Quick actions">
            <Link to="/my/bookings/new"><i className="bi bi-calendar-plus" aria-hidden="true" />Book a service</Link>
            <button type="button" onClick={() => setAdding(true)}><i className="bi bi-plus-lg" aria-hidden="true" />Add a vehicle</button>
            <Link to="/my/history"><i className="bi bi-journal-text" aria-hidden="true" />Service history</Link>
            <Link to="/contact"><i className="bi bi-chat-dots" aria-hidden="true" />Contact us</Link>
          </nav>

          <section className="cp-card cp-rise" style={rise(4)}>
            <div className="cp-card-h justify-content-between">
              <span><i className="bi bi-bell me-2" aria-hidden="true" />Latest news</span>
              <Link to="/my/notifications" className="small fw-normal text-decoration-none">See all</Link>
            </div>
            <div className="cp-card-b pt-2">
              {!notifications.data ? (
                <div className="d-grid gap-2"><Skeleton width="70%" /><Skeleton width="55%" /></div>
              ) : news.length === 0 ? (
                <p className="small text-body-secondary mb-0">No news yet. Updates about your vehicles, reports and bookings will appear here.</p>
              ) : (
                <ul className="list-unstyled m-0 d-grid gap-1">
                  {news.map((n) => <li key={n.id}><NoticeRow n={n} onClick={() => n.link && navigate(n.link)} /></li>)}
                </ul>
              )}
            </div>
          </section>
        </div>

        <div>
          <section className="cp-card cp-rise" style={rise(2)}>
            <div className="cp-card-h justify-content-between">
              <span><i className="bi bi-calendar-event me-2" aria-hidden="true" />Next booking</span>
              {upcoming.length > 1 && <Link to="/my/bookings" className="small fw-normal text-decoration-none">{upcoming.length} upcoming</Link>}
            </div>
            <div className="cp-card-b">
              {!bookings.data ? <Skeleton width="80%" /> : next ? <NextBooking b={next} /> : (
                <div className="small text-body-secondary">
                  No upcoming bookings.
                  <Link to="/my/bookings/new" className="d-block mt-2 fw-semibold text-decoration-none">Book a service <i className="bi bi-arrow-right" aria-hidden="true" /></Link>
                </div>
              )}
            </div>
          </section>

          <section className="cp-card cp-rise" style={rise(3)}>
            <div className="cp-card-h justify-content-between">
              <span><i className="bi bi-car-front me-2" aria-hidden="true" />My vehicles</span>
              <Link to="/my/vehicles" className="small fw-normal text-decoration-none">Manage</Link>
            </div>
            <div className="cp-card-b">
              {loading ? <Skeleton width="70%" /> : list.length === 0 ? (
                <p className="small text-body-secondary mb-0">
                  {pending.length ? `${pending.length === 1 ? 'Your vehicle is' : 'Your vehicles are'} waiting for the service centre to confirm.` : 'No vehicles yet.'}
                </p>
              ) : (
                <ul className="pt-mini">
                  {list.map((v) => (
                    <li key={v.vehicleId}>
                      <Link to={`/my/vehicles/${v.vehicleId}`}>
                        <span className="pt-thumb">{v.photoUrl ? <img src={v.photoUrl} alt="" /> : <CarArt />}</span>
                        <span className="min-w-0">
                          <b className="d-block small">{v.registrationNo}</b>
                          <span className="small text-body-secondary text-truncate d-block">{v.description}</span>
                        </span>
                        {v.visit ? (
                          <span className={`cp-pill cp-tone-${STAGES[v.visit.stage].tone}`}>{STAGES[v.visit.stage].label}</span>
                        ) : <i className="bi bi-chevron-right text-body-secondary" aria-hidden="true" />}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="cp-card cp-rise" style={rise(4)}>
            <div className="cp-card-h"><i className="bi bi-life-preserver" aria-hidden="true" />Need help?</div>
            <div className="cp-card-b pt-help">
              <a href={telUrl}><i className="bi bi-telephone" aria-hidden="true" />Call {BUSINESS.phone}</a>
              <a href={whatsappUrl} target="_blank" rel="noreferrer"><i className="bi bi-whatsapp" aria-hidden="true" />Message us on WhatsApp</a>
              <a href={mailUrl('Question from the customer portal')}><i className="bi bi-envelope" aria-hidden="true" />{BUSINESS.email}</a>
            </div>
          </section>
        </div>
      </div>

      {adding && (
        <AddVehicleDialog
          onClose={() => setAdding(false)}
          onAdded={(plate) => {
            setAdding(false);
            show(`Sent. The service centre will confirm ${plate} is yours.`);
            vehicles.reload();
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}

/** New customers: three steps to get going, ticked off as they're done. */
function GettingStarted({ waiting, onAdd }: { waiting: boolean; onAdd: () => void }) {
  const done = 1 + (waiting ? 0.5 : 0);
  return (
    <section className="cp-card pt-start cp-rise" style={rise(2)}>
      <div className="cp-eyebrow">Get started</div>
      <h2>Welcome to AutoSense</h2>
      <p className="text-body-secondary small mb-0">Three quick steps and you can follow your vehicle's service from your phone.</p>
      <div className="pt-start-bar" role="progressbar" aria-valuenow={Math.round((done / 3) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Getting started">
        <i style={{ width: `${(done / 3) * 100}%` }} />
      </div>
      <ol>
        <li className="done">
          <span className="tick"><i className="bi bi-check-lg" aria-hidden="true" /></span>
          <div><b>Create your account</b><span>Done. You sign in with your mobile number.</span></div>
        </li>
        <li className={waiting ? 'wait' : ''}>
          <span className="tick">{waiting ? <i className="bi bi-hourglass-split" aria-hidden="true" /> : 2}</span>
          <div>
            <b>Add your vehicle</b>
            <span>{waiting ? 'Sent. The service centre will confirm it, usually at your next visit.' : 'Its number plate and a photo. The service centre confirms it\'s yours.'}</span>
          </div>
          {!waiting && <button type="button" className="btn btn-primary btn-sm" onClick={onAdd}>Add vehicle</button>}
        </li>
        <li>
          <span className="tick">3</span>
          <div><b>Book your first service</b><span>Once your vehicle is confirmed, pick a day and time that suits you.</span></div>
          <Link to="/services" className="btn btn-light btn-sm">See services</Link>
        </li>
      </ol>
    </section>
  );
}

function NextBooking({ b }: { b: Booking }) {
  const d = dayParts(b.date);
  const status = BOOKING_STATUS[b.status];
  return (
    <Link to="/my/bookings" className="pt-next text-reset text-decoration-none">
      <div className="pt-date"><small>{d.month}</small><b>{d.day}</b><span>{d.weekday}</span></div>
      <div className="min-w-0">
        <b className="d-block">{b.service}</b>
        <div className="small text-body-secondary mb-2">
          <i className="bi bi-clock me-1" aria-hidden="true" />{b.time} · <span className="cp-plate" style={{ fontSize: '0.75rem' }}><PlateText plate={b.vehicle.registrationNo} /></span>
        </div>
        <span className={`cp-pill cp-tone-${status.tone}`}>{status.label}</span>
      </div>
    </Link>
  );
}
