import type { CSSProperties } from 'react';
import { BUSINESS, mailUrl, mapsUrl, telUrl, whatsappUrl } from '@/site/business';
import { PageHero } from './SiteLayout';

/** Today's row in the opening hours: Sunday is the last row, Saturday the second, weekdays the first. */
function todayRow(timeZone = 'Asia/Colombo') {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }).format(new Date());
  return day === 'Sun' ? 2 : day === 'Sat' ? 1 : 0;
}

/** Public: ways to reach the centre, opening hours and the map. */
export function ContactPage() {
  const today = todayRow();
  const closedToday = BUSINESS.hours[today]?.time === 'Closed';
  const ways = [
    { href: telUrl, icon: 'bi-telephone', label: 'Call us', value: BUSINESS.phone, note: 'During opening hours' },
    { href: whatsappUrl, icon: 'bi-whatsapp', label: 'WhatsApp', value: 'Message us', note: 'We reply in working hours', external: true },
    { href: mailUrl('Question about my vehicle'), icon: 'bi-envelope', label: 'Email', value: BUSINESS.email, note: 'We reply within a working day' },
    { href: mapsUrl, icon: 'bi-geo-alt', label: 'Visit', value: BUSINESS.address.line1, note: BUSINESS.address.line2, external: true },
  ];
  return (
    <>
      <PageHero eyebrow="Contact" title="We're here to help" lead="Questions about a booking, your vehicle or a report? Reach us whichever way suits you." />
      <section className="st-section alt pt-0">
        <div className="st-wrap">
          <div className="st-contact">
            {ways.map((w, i) => (
              <a key={w.label} href={w.href} {...(w.external ? { target: '_blank', rel: 'noreferrer' } : {})} data-reveal style={{ '--d': i } as CSSProperties}>
                <div className="st-card">
                  <div className="st-ic"><i className={`bi ${w.icon}`} aria-hidden="true" /></div>
                  <h3 className="mb-1">{w.label}</h3>
                  <b>{w.value}</b>
                  <small>{w.note}</small>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>
      <section className="st-section">
        <div className="st-wrap st-visit">
          <div data-reveal>
            <div className="st-head mb-4">
              <div className="st-eyebrow">Opening hours</div>
              <h2>When to find us</h2>
            </div>
            <span className="st-open" style={{ '--t': closedToday ? 'var(--as-muted)' : 'var(--as-success)', '--t-soft': closedToday ? 'var(--as-neutral-soft)' : 'var(--as-success-soft)' } as CSSProperties}>
              {closedToday ? 'Closed today' : `Open today, ${BUSINESS.hours[today]?.time}`}
            </span>
            <table className="st-hours-table mt-3">
              <tbody>
                {BUSINESS.hours.map((h, i) => (
                  <tr key={h.days} className={i === today ? 'today' : ''}>
                    <td>{h.days}</td>
                    <td>{h.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <address className="mt-4 mb-3 lh-lg">
              <b>{BUSINESS.name}</b><br />
              {BUSINESS.address.line1}<br />
              {BUSINESS.address.line2}, {BUSINESS.address.country}
            </address>
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="btn btn-primary rounded-pill px-4">
              <i className="bi bi-signpost-2 me-2" aria-hidden="true" />Get directions
            </a>
          </div>
          <div className="st-map" data-reveal style={{ '--d': 1 } as CSSProperties}>
            <iframe
              title={`Map showing ${BUSINESS.name}`}
              src={`https://www.google.com/maps?q=${encodeURIComponent(BUSINESS.mapsQuery)}&output=embed`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </section>
    </>
  );
}
