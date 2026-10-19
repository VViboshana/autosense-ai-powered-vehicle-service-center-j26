import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/app/session';
import { PageHero } from './SiteLayout';

const STEPS = [
  { title: 'Create your account', text: 'Sign up with your name and mobile number. Your mobile number is how you sign in.', tag: 'About a minute', icon: 'bi-person-plus' },
  { title: 'Add your vehicle', text: 'Enter its number plate and add a photo. The service centre checks it\'s yours (usually at your next visit), then it appears in your account.', tag: 'Confirmed by staff', icon: 'bi-car-front' },
  { title: 'Book a service', text: 'Pick the vehicle, the service and a day and time. We confirm the booking, or suggest another time, and you see the answer in your portal.', tag: 'Up to 30 days ahead', icon: 'bi-calendar2-check' },
  { title: 'Follow the visit live', text: 'From check-in to pickup, your portal shows each step, your place in the queue and the bay your car is in.', tag: 'Updates as it happens', icon: 'bi-broadcast' },
  { title: 'Read the report, keep the record', text: 'See the inspection photos with the damage marked, and keep every visit on record for all your vehicles.', tag: 'Checked by a technician', icon: 'bi-journal-check' },
];

const PIPE = [
  { icon: 'bi-camera', title: 'Photos', text: 'The car is photographed from the front, back and both sides when it arrives.' },
  { icon: 'bi-cpu', title: 'AI detection', text: 'A computer-vision model outlines each dent, scratch, crack, broken lamp or flat tyre it finds.' },
  { icon: 'bi-speedometer2', title: 'Severity', text: 'Each area is graded minor, moderate or severe from its size and the part affected.' },
  { icon: 'bi-person-check', title: 'Technician check', text: 'A technician confirms, corrects or removes every mark. Only then do you see the report.' },
];

/** Public: the customer's journey, the AI inspection, and how their data is handled. */
export function HowItWorksPage() {
  const { session } = useAuth();
  const signedIn = session?.me.userType === 'customer';
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="Five steps from sign-up to a fully documented service"
        lead="AutoSense connects you to what happens in the workshop: bookings, live progress, inspection photos and a record of every visit."
      />
      <section className="st-section">
        <div className="st-wrap st-split">
          <div data-reveal>
            <div className="st-head mb-0">
              <div className="st-eyebrow">For you</div>
              <h2>What you do, and what you get</h2>
              <p>You only need a phone. Everything else is done by the service centre.</p>
            </div>
            <Link to={signedIn ? '/my' : '/register'} className="btn btn-primary rounded-pill px-4 mt-4">
              {signedIn ? 'Go to my portal' : 'Create a free account'}
            </Link>
          </div>
          <ol className="st-steps list-unstyled m-0">
            {STEPS.map((s, i) => (
              <li key={s.title} className="st-step" data-reveal style={{ '--d': i } as CSSProperties}>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                  <span className="st-tag"><i className={`bi ${s.icon}`} aria-hidden="true" />{s.tag}</span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="st-section st-dark">
        <div className="st-glow" aria-hidden="true" />
        <div className="st-wrap">
          <div className="st-head" data-reveal>
            <div className="st-eyebrow">The AI inspection</div>
            <h2>A second pair of eyes that never gets tired</h2>
            <p>The AI makes inspections faster and more consistent. People make the final call.</p>
          </div>
          <div className="st-pipe">
            {PIPE.map((p, i) => (
              <div key={p.title} data-reveal style={{ '--d': i } as CSSProperties}>
                <i className={`bi ${p.icon}`} aria-hidden="true" />
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="st-section alt">
        <div className="st-wrap">
          <div className="st-head center" data-reveal>
            <div className="st-eyebrow">Privacy</div>
            <h2>Built to share only what's yours</h2>
          </div>
          <div className="st-cards">
            {[
              { icon: 'bi-shield-check', title: 'Confirmed ownership', text: 'A vehicle appears in your account only after staff confirm it belongs to you.' },
              { icon: 'bi-person-vcard', title: 'Only what we need', text: 'Your name, mobile number and, if you like, your email. No NIC number, no home address.' },
              { icon: 'bi-lock', title: 'Secure sign-in', text: 'Passwords are stored scrambled, sessions end on their own, and repeated wrong passwords lock the account.' },
            ].map((c, i) => (
              <article key={c.title} className="st-card" data-reveal style={{ '--d': i } as CSSProperties}>
                <div className="st-ic"><i className={`bi ${c.icon}`} aria-hidden="true" /></div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </article>
            ))}
          </div>
          <p className="text-center mt-4 mb-0" data-reveal><Link to="/privacy">Read our privacy notice</Link></p>
        </div>
      </section>
    </>
  );
}
