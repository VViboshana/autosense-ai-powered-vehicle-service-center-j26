import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/session';
import { bookingLink, SERVICES, telUrl } from '@/site/business';
import { PageHero } from './SiteLayout';

/** Public: every service with what's included and roughly how long it takes. */
export function ServicesPage() {
  const { session } = useAuth();
  const signedIn = session?.me.userType === 'customer';
  return (
    <>
      <PageHero
        eyebrow="Services"
        title="Servicing and repairs, done in the open"
        lead="Every service is logged in your portal: when it starts, which bay it's in and when it's ready. Times are typical; we confirm yours when you book."
      />
      <section className="st-section alt">
        <div className="st-wrap">
          <div className="st-services">
            {SERVICES.map((s, i) => (
              <article key={s.code} id={s.code.toLowerCase()} className="st-card st-service" data-reveal style={{ '--d': i % 3 } as CSSProperties}>
                <div className="meta">
                  <div className="st-ic"><i className={`bi ${s.icon}`} aria-hidden="true" /></div>
                  <span className="time"><i className="bi bi-clock me-1" aria-hidden="true" />{s.time}</span>
                </div>
                <h3>{s.name}</h3>
                <p>{s.summary}</p>
                <ul>
                  {s.points.map((p) => <li key={p}><i className="bi bi-check2" aria-hidden="true" />{p}</li>)}
                </ul>
                <Link to={bookingLink(signedIn, s.code)} className="btn btn-light">
                  Book this service <i className="bi bi-arrow-right ms-1" aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="st-section">
        <div className="st-wrap">
          <div className="st-cta-band" data-reveal>
            <div>
              <h2>Not sure what your car needs?</h2>
              <p>Tell us what you've noticed and we'll suggest the right service.</p>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <a href={telUrl} className="btn st-btn-white"><i className="bi bi-telephone me-2" aria-hidden="true" />Call us</a>
              <Link to="/contact" className="btn st-btn-line">Other ways to reach us</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
