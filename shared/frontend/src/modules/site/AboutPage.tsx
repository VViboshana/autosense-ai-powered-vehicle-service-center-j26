import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BUSINESS } from '@/site/business';
import { PageHero } from './SiteLayout';

const PILLARS = [
  { tag: 'Service floor', icon: 'bi-p-square', title: 'Bay occupancy', text: 'Cameras detect when a service bay is taken or free, so the queue moves and waiting times can be predicted.' },
  { tag: 'Inspection', icon: 'bi-clipboard-check', title: 'Damage assessment', text: 'Finds, outlines and grades vehicle damage on photos, for a quicker and more consistent inspection.' },
  { tag: 'Maintenance', icon: 'bi-wrench-adjustable', title: 'Predictive maintenance', text: 'Learns from service history to suggest what a vehicle is likely to need next, before it breaks down.' },
  { tag: 'Safety', icon: 'bi-shield-check', title: 'Anomaly detection', text: 'Watches for unusual activity in the workshop, so the team can keep vehicles and people safe.' },
];

/** Public: who we are and the four AI systems behind AutoSense. */
export function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About us"
        title="A service centre that shows its work"
        lead={`${BUSINESS.name} brings artificial intelligence into the everyday work of a vehicle service centre, to make each visit faster, clearer and fairer for the owner.`}
      />
      <section className="st-section">
        <div className="st-wrap st-split">
          <div data-reveal>
            <div className="st-head mb-0">
              <div className="st-eyebrow">Why we built it</div>
              <h2>Owners deserve to see what happens to their car</h2>
            </div>
          </div>
          <div data-reveal style={{ '--d': 1 } as CSSProperties}>
            <p className="fs-5 lh-base text-body-secondary">
              Most service visits are a black box: you hand over the keys, wait for a call, and take the workshop's word for
              what it found.
            </p>
            <p className="lh-lg text-body-secondary mb-0">
              AutoSense opens that box. The same system our technicians use shows you the progress of your visit, the photos
              and findings of the inspection, and the history of every service. Artificial intelligence does the repetitive
              watching and measuring; experienced people make every decision.
            </p>
          </div>
        </div>
      </section>
      <section className="st-section alt">
        <div className="st-wrap">
          <div className="st-head" data-reveal>
            <div className="st-eyebrow">What powers AutoSense</div>
            <h2>Four AI systems, one service centre</h2>
            <p>Each one takes on a different part of the work, and they share one record of your vehicle.</p>
          </div>
          <div className="st-pillars">
            {PILLARS.map((p, i) => (
              <article key={p.title} className="st-pillar" data-reveal style={{ '--d': i } as CSSProperties}>
                <span className="tag">{p.tag}</span>
                <div className="st-ic mt-3"><i className={`bi ${p.icon}`} aria-hidden="true" /></div>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="st-section">
        <div className="st-wrap">
          <div className="st-cta-band" data-reveal>
            <div>
              <h2>Come and see it for yourself</h2>
              <p>Book your next service online, or drop in during opening hours.</p>
            </div>
            <div className="d-flex flex-wrap gap-2">
              <Link to="/register" className="btn st-btn-white">Create account</Link>
              <Link to="/contact" className="btn st-btn-line">Find us</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
