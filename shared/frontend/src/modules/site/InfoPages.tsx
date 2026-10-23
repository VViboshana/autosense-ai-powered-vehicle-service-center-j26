import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BUSINESS, mailUrl } from '@/site/business';
import { PageHero } from './SiteLayout';

const UPDATED = 'October 2026';

/** Public: what the customer portal stores and why (matches what the system actually keeps). */
export function PrivacyPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Privacy notice" lead="What we keep about you and your vehicles, why, and who can see it." />
      <section className="st-section">
        <div className="st-wrap st-prose">
          <p className="updated">Last updated {UPDATED}</p>
          <h2>Who we are</h2>
          <p>{BUSINESS.name}, {BUSINESS.address.line1}, {BUSINESS.address.line2}. Contact us about your data at <a href={mailUrl('My personal data')}>{BUSINESS.email}</a>.</p>
          <h2>What we keep</h2>
          <ul>
            <li>Your name, mobile number and, if you give it, your email address.</li>
            <li>Your vehicles: number plate, make, model, colour and the photos you or our staff add.</li>
            <li>Your visits and bookings: dates, services, progress and estimates.</li>
            <li>Inspection photos and the damage our technicians confirm on them.</li>
            <li>Records of when you sign in, to keep your account safe.</li>
          </ul>
          <p>We never ask for your national identity card number or your home address.</p>
          <h2>Why we keep it</h2>
          <p>To service your vehicle, to show you its progress and reports, to answer your bookings, and to keep a service record you can rely on. Inspection photos also help us check and improve the accuracy of our AI, without your name attached.</p>
          <h2>Who can see it</h2>
          <p>You, and our service centre staff who need it for their work. A vehicle appears in your account only after staff confirm it is yours. We do not sell or share your data with advertisers.</p>
          <h2>Cookies</h2>
          <p>We use one cookie, to keep you signed in. It is removed when you sign out or your session ends. We use no advertising or tracking cookies.</p>
          <h2>Your choices</h2>
          <p>You can ask us to correct your details, or to close your account and remove your personal details, by contacting the service centre. We may keep service records the law requires us to keep.</p>
        </div>
      </section>
    </>
  );
}

/** Public: the terms of using the customer portal. */
export function TermsPage() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Terms of use" lead="The rules for using the AutoSense customer portal." />
      <section className="st-section">
        <div className="st-wrap st-prose">
          <p className="updated">Last updated {UPDATED}</p>
          <h2>Your account</h2>
          <p>Keep your password to yourself. You are responsible for what is done with your account. Add only vehicles you own or are allowed to look after; we check before showing one in your account.</p>
          <h2>Bookings</h2>
          <p>A booking is a request until we confirm it. We may decline or suggest another time when the workshop is full. Please cancel in the portal if you can't come, so someone else can have the time.</p>
          <h2>Inspection reports</h2>
          <p>Reports show the damage visible on the photos taken at the visit, as checked by our technicians. They are not a valuation, and they may not show damage that can't be seen on a photo.</p>
          <h2>Estimates</h2>
          <p>Times and prices shown before or during a visit are estimates. We agree the work with you before we start it.</p>
          <h2>Changes</h2>
          <p>We may update these terms; the date above shows the latest version. Questions? <Link to="/contact">Contact us</Link>.</p>
        </div>
      </section>
    </>
  );
}

/** Public: an address that doesn't exist. */
export function SiteNotFound() {
  useEffect(() => {
    document.title = 'Page not found · AutoSense';
  }, []);
  return (
    <section className="st-404 st-dark">
      <div className="st-glow" aria-hidden="true" />
      <div>
        <b>404</b>
        <h1 className="h3 fw-bold mt-3">This page took a wrong turn</h1>
        <p className="text-white-50 mb-4">The address may be mistyped, or the page has moved.</p>
        <div className="d-flex gap-2 justify-content-center flex-wrap">
          <Link to="/" className="btn btn-primary rounded-pill px-4">Back to home</Link>
          <Link to="/contact" className="btn st-btn-glass rounded-pill px-4">Contact us</Link>
        </div>
      </div>
    </section>
  );
}
