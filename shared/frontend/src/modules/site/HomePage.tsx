import { useEffect, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/session';
import { CountUp } from '@/components/ui/CountUp';
import { BUSINESS, SERVICES, telUrl } from '@/site/business';
import { ScanScene, SideCar } from './SiteArt';

const d = (n: number) => ({ '--d': n }) as CSSProperties;

const FEATURES = [
  { icon: 'bi-calendar2-check', title: 'Book online', text: 'Choose your vehicle, the service and a time that suits you. We confirm it and let you know in your portal.' },
  { icon: 'bi-broadcast', title: 'Follow it live', text: 'See the moment your car is checked in, waiting, in a bay and ready, so you only come back when it\'s done.' },
  { icon: 'bi-camera', title: 'Photo inspection report', text: 'Our AI marks dents, scratches and cracks on photos of your car. A technician checks every mark before you see it.' },
  { icon: 'bi-journal-text', title: 'Every visit on record', text: 'Each visit, service and report for all your vehicles, in one place. Handy when you sell the car.' },
];

const JOURNEY = [
  { icon: 'bi-box-arrow-in-right', title: 'Checked in', text: 'We log your car and what it needs.' },
  { icon: 'bi-camera', title: 'Inspected', text: 'Photos are checked for damage.' },
  { icon: 'bi-hourglass-split', title: 'Waiting for a bay', text: 'You see your place in the queue.' },
  { icon: 'bi-tools', title: 'In service', text: 'A technician works on your car.' },
  { icon: 'bi-key', title: 'Ready for pickup', text: 'Come and collect it.' },
];

const FAQ = [
  { q: 'Do I need to install an app?', a: 'No. AutoSense works in the browser on any phone or computer. Create an account with your mobile number and sign in.' },
  { q: 'How do I add my vehicle?', a: 'In your portal, add the number plate and a photo of the car. The service centre checks that it\'s yours (usually at your next visit) and it then appears in your account.' },
  { q: 'Is the AI inspection the final word?', a: 'No. The AI suggests where the damage is; a technician checks every mark, corrects or removes it, and only then is the report shown to you.' },
  { q: 'Who can see my vehicle\'s information?', a: 'Only you and the service centre staff. A vehicle is shown in your account only after staff confirm it belongs to you.' },
  { q: 'Can I book for today?', a: `Online bookings need a little notice. For the same day, call us on ${BUSINESS.phone}.` },
  { q: 'What does an account cost?', a: 'Nothing. The customer portal is free for everyone who services their vehicle with us.' },
];

/** The public home page: what AutoSense does for car owners, and the way in (create an account or sign in). */
export function HomePage() {
  const { session } = useAuth();
  const signedIn = session?.me.userType === 'customer';

  useEffect(() => {
    document.title = `${BUSINESS.name} · Book, follow and inspect your vehicle's service`;
  }, []);

  return (
    <>
      <section className="st-dark st-hero">
        <div className="st-grid-bg" aria-hidden="true" />
        <div className="st-glow" aria-hidden="true" />
        <div className="st-wrap st-hero-grid">
          <div>
            <div className="st-eyebrow st-in">{BUSINESS.tagline}</div>
            <h1 className="st-in" style={d(1)}>
              Know exactly what's happening to <em>your car.</em>
            </h1>
            <p className="st-lead st-in" style={d(2)}>
              Book a service online, follow your vehicle from check-in to pickup, and get a photo inspection report checked
              by a technician. All from your phone.
            </p>
            <div className="st-hero-ctas st-in" style={d(3)}>
              {signedIn ? (
                <Link to="/my" className="btn btn-primary st-cta">Go to my portal <i className="bi bi-arrow-right ms-1" aria-hidden="true" /></Link>
              ) : (
                <Link to="/register" className="btn btn-primary st-cta">Create a free account <i className="bi bi-arrow-right ms-1" aria-hidden="true" /></Link>
              )}
              <Link to="/how-it-works" className="btn st-btn-glass">See how it works</Link>
            </div>
            <ul className="st-ticks st-in" style={d(4)}>
              <li><i className="bi bi-check-circle-fill" aria-hidden="true" />No app to install</li>
              <li><i className="bi bi-check-circle-fill" aria-hidden="true" />Works on any phone</li>
              <li><i className="bi bi-check-circle-fill" aria-hidden="true" />Free for customers</li>
            </ul>
          </div>
          <div className="st-in" style={d(2)}>
            <ScanScene />
          </div>
        </div>
      </section>

      <section className="st-strip" aria-label="AutoSense at a glance">
        <div className="st-wrap st-strip-row">
          <div><i className="bi bi-signpost-split" aria-hidden="true" /><div><b><CountUp value={5} /></b><span>steps of each visit, shown live</span></div></div>
          <div><i className="bi bi-cpu" aria-hidden="true" /><div><b><CountUp value={4} /></b><span>AI systems helping the team</span></div></div>
          <div><i className="bi bi-person-check" aria-hidden="true" /><div><b><CountUp value={100} />%</b><span>of AI findings checked by a person</span></div></div>
          <div><i className="bi bi-phone" aria-hidden="true" /><div><b>24/7</b><span>access to your vehicle's record</span></div></div>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <div className="st-head" data-reveal>
            <div className="st-eyebrow">Your portal</div>
            <h2>Everything about your car's service, in one place</h2>
            <p>No more calling to ask whether it's ready. Your account shows what the service centre sees, as it happens.</p>
          </div>
          <div className="st-cards">
            {FEATURES.map((f, i) => (
              <article key={f.title} className="st-card" data-reveal style={d(i)}>
                <div className="st-ic"><i className={`bi ${f.icon}`} aria-hidden="true" /></div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="st-section alt">
        <div className="st-wrap">
          <div className="st-head center" data-reveal>
            <div className="st-eyebrow">A visit, step by step</div>
            <h2>From check-in to pickup, you always know where it is</h2>
          </div>
          <ol className="st-journey" data-reveal>
            {JOURNEY.map((s, i) => (
              <li key={s.title} style={{ '--i': i } as CSSProperties}>
                <span className="n"><i className={`bi ${s.icon}`} aria-hidden="true" /></span>
                <b>{s.title}</b>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="st-section st-dark">
        <div className="st-glow" aria-hidden="true" />
        <div className="st-wrap st-split">
          <div data-reveal>
            <div className="st-head mb-0">
              <div className="st-eyebrow">AI damage inspection</div>
              <h2>See what we see, with the photos to prove it</h2>
            </div>
            <ul className="st-list">
              <li><i className="bi bi-camera" aria-hidden="true" /><div><b>Photos from every side</b><span>The car is photographed at check-in, front, back and both sides.</span></div></li>
              <li><i className="bi bi-cpu" aria-hidden="true" /><div><b>AI marks the damage</b><span>A computer-vision model outlines dents, scratches, cracks and broken lamps, and grades how serious each is.</span></div></li>
              <li><i className="bi bi-person-check" aria-hidden="true" /><div><b>A technician confirms it</b><span>Nothing reaches you until a person has checked every mark.</span></div></li>
            </ul>
            <Link to="/how-it-works" className="btn st-btn-glass mt-4 rounded-pill px-4">How the inspection works</Link>
          </div>
          <div data-reveal style={d(2)}>
            <div className="st-report">
              <div className="st-report-head">
                <div>
                  <small>Inspection report · sample</small>
                  <b>Toyota Aqua · WP CAB-4521</b>
                </div>
                <div className="st-ring" style={{ '--p': 55 } as CSSProperties}><span>Mod.</span></div>
              </div>
              <div className="st-report-map">
                <SideCar />
                <span className="st-pin" style={{ left: '28%', top: '52%', '--t': 'var(--as-warning)', '--i': 0 } as CSSProperties}>1</span>
                <span className="st-pin" style={{ left: '58%', top: '40%', '--t': 'var(--as-info)', '--i': 1 } as CSSProperties}>2</span>
                <span className="st-pin" style={{ left: '88%', top: '62%', '--t': 'var(--as-danger)', '--i': 2 } as CSSProperties}>3</span>
              </div>
              <ul className="st-findings">
                <li style={{ '--t': 'var(--as-warning)' } as CSSProperties}><i>1</i>Dent · rear door, left<em>Moderate</em></li>
                <li style={{ '--t': 'var(--as-info)' } as CSSProperties}><i>2</i>Scratch · front door<em>Minor</em></li>
                <li style={{ '--t': 'var(--as-danger)' } as CSSProperties}><i>3</i>Broken lamp · headlight<em>Severe</em></li>
              </ul>
              <div className="st-verified"><i className="bi bi-patch-check-fill" aria-hidden="true" />Checked by a technician</div>
            </div>
          </div>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <div className="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-5" data-reveal>
            <div className="st-head mb-0">
              <div className="st-eyebrow">Services</div>
              <h2>Care for every part of your vehicle</h2>
            </div>
            <Link to="/services" className="btn btn-light rounded-pill px-4">All services <i className="bi bi-arrow-right ms-1" aria-hidden="true" /></Link>
          </div>
          <div className="st-cards three">
            {SERVICES.slice(0, 6).map((s, i) => (
              <article key={s.code} className="st-card" data-reveal style={d(i % 3)}>
                <div className="st-ic"><i className={`bi ${s.icon}`} aria-hidden="true" /></div>
                <h3>{s.name}</h3>
                <p>{s.summary}</p>
                <Link to={`/services#${s.code.toLowerCase()}`} className="st-more">Details <i className="bi bi-arrow-right" aria-hidden="true" /></Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="st-section st-dark">
        <div className="st-wrap">
          <div className="st-head" data-reveal>
            <div className="st-eyebrow">Our promise</div>
            <h2>Clear, honest and on time</h2>
          </div>
          <div className="st-promises" data-reveal>
            <div><i className="bi bi-eye" aria-hidden="true" /><h3>Nothing hidden</h3><p>You see the same progress and inspection photos the team works from.</p></div>
            <div><i className="bi bi-shield-lock" aria-hidden="true" /><h3>Your data stays yours</h3><p>Only you and our staff can see your vehicles. We never ask for your NIC or home address.</p></div>
            <div><i className="bi bi-stopwatch" aria-hidden="true" /><h3>Less waiting</h3><p>Cameras watch every service bay, so we know the moment one is free and your car moves on sooner.</p></div>
          </div>
        </div>
      </section>

      <section className="st-section alt">
        <div className="st-wrap">
          <div className="st-head center" data-reveal>
            <div className="st-eyebrow">Questions</div>
            <h2>Good to know</h2>
          </div>
          <div className="st-faq" data-reveal>
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="st-section">
        <div className="st-wrap">
          <div className="st-cta-band" data-reveal>
            <div>
              <h2>Ready when your car is</h2>
              <p>Create your free account in a minute, add your vehicle and book your next service.</p>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <Link to={signedIn ? '/my/bookings/new' : '/register'} className="btn st-btn-white">
                {signedIn ? 'Book a service' : 'Create account'}
              </Link>
              <a href={telUrl} className="btn st-btn-line"><i className="bi bi-telephone me-2" aria-hidden="true" />Call us</a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
